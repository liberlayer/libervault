/**
 * HD Keyring — LiberVault
 * -----------------------
 * One BIP-39 mnemonic → all chains:
 *
 *  EVM       m/44'/60'/0'/0/0    secp256k1
 *  Bitcoin   m/84'/0'/0'/0/0     secp256k1  (native SegWit / P2WPKH)
 *  Solana    m/44'/501'/0'/0'    ed25519    (SLIP-0010)
 *  Polkadot  substrate scheme    sr25519    (Schnorrkel)
 *  Liberland same sr25519 key, SS58 prefix 56
 *
 * Noble crypto family for EVM/BTC/SOL — audited, no Node shims.
 * @polkadot/util-crypto for sr25519 — official Substrate library.
 */

import * as bip39    from "@scure/bip39";
import { wordlist }  from "@scure/bip39/wordlists/english";
import { HDKey }     from "@scure/bip32";
import { secp256k1 } from "@noble/curves/secp256k1";
import { ed25519 }   from "@noble/curves/ed25519";
import { sha256 }    from "@noble/hashes/sha256";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { hmac }      from "@noble/hashes/hmac";
import { sha512 }    from "@noble/hashes/sha512";
import type { AccountSet } from "./messages";
import { deriveCardanoAccount } from "./cardano";

// ─── BIP-44 Paths ──────────────────────────────────────────────────────────────
const PATH_EVM = "m/44'/60'/0'/0/0";
const PATH_BTC = "m/84'/0'/0'/0/0";
const PATH_SOL = "m/44'/501'/0'/0'";
// Polkadot uses Substrate's own derivation — not BIP-44

// ─── SS58 Prefixes ─────────────────────────────────────────────────────────────
export const SS58 = {
  polkadot:  0,
  kusama:    2,
  substrate: 42, // generic
  liberland: 56,
} as const;

// ─── Mnemonic ──────────────────────────────────────────────────────────────────

export function generateMnemonic(): string {
  return bip39.generateMnemonic(wordlist, 128); // 128 bits = 12 words
}

export function validateMnemonic(m: string): boolean {
  return bip39.validateMnemonic(m.trim().toLowerCase(), wordlist);
}

function mnemonicToSeed(mnemonic: string): Uint8Array {
  return bip39.mnemonicToSeedSync(mnemonic.trim());
}

// ─── EVM ───────────────────────────────────────────────────────────────────────

export async function deriveEvmAccount(mnemonic: string): Promise<{ address: string; privateKey: string }> {
  const { ethers } = await import("ethers");
  const seed   = mnemonicToSeed(mnemonic);
  const root   = HDKey.fromMasterSeed(seed);
  const child  = root.derive(PATH_EVM);
  if (!child.privateKey) throw new Error("EVM derivation failed");
  const wallet = new ethers.Wallet("0x" + Buffer.from(child.privateKey).toString("hex"));
  return { address: wallet.address, privateKey: wallet.privateKey };
}

// ─── Bitcoin (P2WPKH native SegWit) ───────────────────────────────────────────

function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_GEN     = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function bech32Polymod(v: number[]): number {
  let c = 1;
  for (const d of v) {
    const b = c >> 25;
    c = ((c & 0x1ffffff) << 5) ^ d;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) c ^= BECH32_GEN[i];
  }
  return c;
}

function bech32HrpExpand(hrp: string): number[] {
  const r: number[] = [];
  for (let i = 0; i < hrp.length; i++) r.push(hrp.charCodeAt(i) >> 5);
  r.push(0);
  for (let i = 0; i < hrp.length; i++) r.push(hrp.charCodeAt(i) & 31);
  return r;
}

function bech32Encode(hrp: string, data: number[]): string {
  const combined = [...data, 0, 0, 0, 0, 0, 0];
  const mod = bech32Polymod([...bech32HrpExpand(hrp), ...combined]) ^ 1;
  const cs: number[] = [];
  for (let p = 0; p < 6; p++) cs.push((mod >> (5 * (5 - p))) & 31);
  return hrp + "1" + [...data, ...cs].map(d => BECH32_CHARSET[d]).join("");
}

function convertBits(data: Uint8Array, from: number, to: number, pad: boolean): number[] {
  let acc = 0, bits = 0;
  const result: number[] = [], maxv = (1 << to) - 1;
  for (const v of data) {
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) { bits -= to; result.push((acc >> bits) & maxv); }
  }
  if (pad && bits > 0) result.push((acc << (to - bits)) & maxv);
  return result;
}

export function deriveBtcAccount(mnemonic: string): { address: string; privateKey: string } {
  const seed  = mnemonicToSeed(mnemonic);
  const root  = HDKey.fromMasterSeed(seed);
  const child = root.derive(PATH_BTC);
  if (!child.privateKey || !child.publicKey) throw new Error("BTC derivation failed");
  const address = bech32Encode("bc", [0, ...convertBits(hash160(child.publicKey), 8, 5, true)]);
  return { address, privateKey: Buffer.from(child.privateKey).toString("hex") };
}

// ─── Solana (ed25519 / SLIP-0010) ─────────────────────────────────────────────

function slip10Ed25519(seed: Uint8Array, path: string): Uint8Array {
  const segments = path.replace(/^m\//i, "").split("/").map(s => {
    const h = s.endsWith("'");
    return parseInt(s.replace("'", "")) + (h ? 0x80000000 : 0);
  });
  let k = hmac(sha512, Buffer.from("ed25519 seed"), seed);
  let Il = k.slice(0, 32), Ir = k.slice(32);
  for (const idx of segments) {
    const ib = new Uint8Array(4);
    new DataView(ib.buffer).setUint32(0, idx, false);
    const d = hmac(sha512, Ir, new Uint8Array([0x00, ...Il, ...ib]));
    Il = d.slice(0, 32); Ir = d.slice(32);
  }
  return Il;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
  let n = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let r = "";
  while (n > 0n) { r = B58[Number(n % 58n)] + r; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; r = "1" + r; }
  return r;
}

export function deriveSolanaAccount(mnemonic: string): { address: string; privateKey: string } {
  const seed    = mnemonicToSeed(mnemonic);
  const privkey = slip10Ed25519(seed, PATH_SOL);
  const pubkey  = ed25519.getPublicKey(privkey);
  return { address: base58Encode(pubkey), privateKey: Buffer.from(privkey).toString("hex") };
}

// ─── Polkadot / Substrate (sr25519) ───────────────────────────────────────────
// Uses @polkadot/util-crypto which handles the WASM sr25519 (Schnorrkel) implementation
// and SS58 encoding. Must call cryptoWaitReady() before first use.

export async function waitForCrypto(): Promise<void> {
  const { cryptoWaitReady } = await import("@polkadot/util-crypto");
  await cryptoWaitReady();
}

export async function deriveSubstrateAccount(
  mnemonic: string,
  ss58Prefix: number = 42
): Promise<{ address: string; publicKey: string; privateKey: string }> {
  const { mnemonicToMiniSecret, sr25519PairFromSeed, encodeAddress } =
    await import("@polkadot/util-crypto");

  const miniSecret = mnemonicToMiniSecret(mnemonic.trim());
  const pair       = sr25519PairFromSeed(miniSecret);
  const address    = encodeAddress(pair.publicKey, ss58Prefix);

  return {
    address,
    publicKey:  Buffer.from(pair.publicKey).toString("hex"),
    // Store the 32-byte mini-secret (seed), NOT the 64-byte sr25519 secret key:
    // send.ts re-creates the signing pair with keyring.addFromSeed(), which
    // requires a 32-byte seed (passing the 64-byte secretKey throws).
    privateKey: Buffer.from(miniSecret).toString("hex"),
  };
}

/** Re-encode an existing sr25519 public key with a different SS58 prefix */
export async function reencodeAddress(publicKeyHex: string, ss58Prefix: number): Promise<string> {
  const { encodeAddress } = await import("@polkadot/util-crypto");
  return encodeAddress(Buffer.from(publicKeyHex, "hex"), ss58Prefix);
}

// ─── Unified Derivation ────────────────────────────────────────────────────────

export interface DerivedAccounts extends AccountSet {
  evmPrivkey:       string;
  btcPrivkey:       string;
  solPrivkey:       string;
  substratePrivkey: string;
  substratePubkey:  string;
  xmrSpendPrivkey:  string;
  xmrViewPrivkey:   string;
  xmrSpendPubkey:   string;
  xmrViewPubkey:    string;
  cardanoPaymentXprv: string;
  cardanoStakeXprv:   string;
}

export async function deriveAllAccounts(mnemonic: string): Promise<DerivedAccounts> {
  await waitForCrypto();

  const [evm, btc, sol, dot, lib, xmr] = await Promise.all([
    deriveEvmAccount(mnemonic),
    Promise.resolve(deriveBtcAccount(mnemonic)),
    Promise.resolve(deriveSolanaAccount(mnemonic)),
    deriveSubstrateAccount(mnemonic, SS58.polkadot),
    deriveSubstrateAccount(mnemonic, SS58.liberland),
    deriveMoneroAccount(mnemonic),
  ]);

  // Cardano (CIP-1852) — in a try/catch so an ADA failure never blocks the other chains.
  let cardano = "", cardanoPaymentXprv = "", cardanoStakeXprv = "";
  try {
    const ada = await deriveCardanoAccount(mnemonic);
    cardano = ada.address;
    cardanoPaymentXprv = ada.paymentXprvHex;
    cardanoStakeXprv = ada.stakeXprvHex;
  } catch (e) {
    console.error("Cardano derivation failed (non-fatal):", e);
  }

  return {
    evm:              evm.address,
    bitcoin:          btc.address,
    solana:           sol.address,
    polkadot:         dot.address,
    liberland:        lib.address,
    monero:           xmr.address,
    evmPrivkey:       evm.privateKey,
    btcPrivkey:       btc.privateKey,
    solPrivkey:       sol.privateKey,
    substratePrivkey: dot.privateKey,
    substratePubkey:  dot.publicKey,
    xmrSpendPrivkey:  xmr.privateSpendKey,
    xmrViewPrivkey:   xmr.privateViewKey,
    xmrSpendPubkey:   xmr.publicSpendKey,
    xmrViewPubkey:    xmr.publicViewKey,
    cardano,
    cardanoPaymentXprv,
    cardanoStakeXprv,
  };
}

// ─── Monero (ed25519 + Keccak, MyMonero-style BIP-44) ─────────────────────────
//
// Derivation: SLIP-0010 ed25519 @ m/44'/128'/0'/0/0  (same as MyMonero, Cake Wallet)
//
// Key structure (unique to Monero — two keypairs):
//   private spend key  = SLIP-0010 derived scalar, reduced mod l
//   private view key   = keccak256(private spend key), reduced mod l
//   public spend key   = Ed25519 point from private spend key
//   public view key    = Ed25519 point from private view key
//
// Address = MoneroBase58( 0x12 || pubSpend || pubView || keccak256(...)[:4] )
//
// The ed25519 group order l:
const XMR_L = 2n ** 252n + 27742317777372353535851937790883648493n;

// Monero base58: same alphabet as Bitcoin base58, but encodes in fixed 8-byte
// blocks → 11 chars each. Last block uses a shorter mapping.
const XMR_B58_ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const XMR_FULL_BLOCK  = 8;  // input bytes per full block
const XMR_FULL_CHARS  = 11; // output chars per full block

const XMR_LAST_BLOCK_TABLE: Record<number, number> = {
  1: 2, 2: 3, 3: 5, 4: 6, 5: 7, 6: 9, 7: 10,
};

function xmrBase58EncodeBlock(block: Uint8Array, outLen: number): string {
  let num = 0n;
  for (const b of block) num = (num << 8n) | BigInt(b);
  let result = "";
  for (let i = 0; i < outLen; i++) {
    result = XMR_B58_ALPHA[Number(num % 58n)] + result;
    num /= 58n;
  }
  return result;
}

function xmrBase58Encode(bytes: Uint8Array): string {
  let result = "";
  let offset  = 0;
  while (offset < bytes.length) {
    const remaining = bytes.length - offset;
    const blockSize = Math.min(XMR_FULL_BLOCK, remaining);
    const outLen    = blockSize === XMR_FULL_BLOCK
      ? XMR_FULL_CHARS
      : XMR_LAST_BLOCK_TABLE[blockSize] ?? XMR_FULL_CHARS;
    result += xmrBase58EncodeBlock(bytes.slice(offset, offset + blockSize), outLen);
    offset  += blockSize;
  }
  return result;
}

/** Reduce a 32-byte LE scalar mod the ed25519 group order l */
function scReduce32(scalar: Uint8Array): Uint8Array {
  // Monero stores scalars little-endian
  const le  = Buffer.from(scalar).reverse(); // flip to BE for BigInt
  const n   = BigInt("0x" + le.toString("hex")) % XMR_L;
  const hex = n.toString(16).padStart(64, "0");
  return Buffer.from(hex, "hex").reverse(); // back to LE
}

/** ed25519 scalar → compressed public key (32 bytes): Monero pubkey = scalar·G */
function xmrPublicKey(privateScalarLE: Uint8Array): Uint8Array {
  // Monero public keys are a DIRECT scalar multiplication of the ed25519 base
  // point. ed25519.getPublicKey() is WRONG here — it SHA-512-hashes and clamps
  // its input as a signing seed (RFC 8032), yielding an unrelated point, so
  // every derived address embedded wrong keys (funds unspendable / sends fail
  // with "spend key does not match address").
  const s = BigInt("0x" + Buffer.from(privateScalarLE).reverse().toString("hex"));
  // @noble/curves exposes the Edwards point class as `Point` (newer 1.x) or
  // `ExtendedPoint` (older); support both across the ^1.x range.
  const Pt = (ed25519 as any).Point ?? (ed25519 as any).ExtendedPoint;
  return Pt.BASE.multiply(s).toRawBytes();
}

export interface MoneroKeys {
  address:          string;
  privateSpendKey:  string; // hex LE — GUARD THIS like the mnemonic
  privateViewKey:   string; // hex LE — needed for wallet scanning
  publicSpendKey:   string; // hex
  publicViewKey:    string; // hex
}

export async function deriveMoneroAccount(mnemonic: string): Promise<MoneroKeys> {
  const { keccak_256 } = await import("@noble/hashes/sha3");

  // 1. SLIP-0010 ed25519 derivation — same path used by MyMonero / Cake Wallet
  const seed           = mnemonicToSeed(mnemonic);
  const rawPriv        = slip10Ed25519(seed, "m/44'/128'/0'/0/0");

  // 2. Private spend key = derived scalar reduced mod l (little-endian)
  const privSpendLE    = scReduce32(rawPriv);

  // 3. Private view key = keccak256(privSpend) reduced mod l
  //    keccak_256 input/output is bytes; we pass the LE bytes as-is (Monero convention)
  const privViewLE     = scReduce32(keccak_256(privSpendLE));

  // 4. Public keys — ed25519 points
  const pubSpend       = xmrPublicKey(privSpendLE);
  const pubView        = xmrPublicKey(privViewLE);

  // 5. Build raw address: network_byte || pub_spend || pub_view || checksum(4)
  //    Network byte 0x12 = Monero mainnet standard address
  const payload        = new Uint8Array(65);
  payload[0]           = 0x12;
  payload.set(pubSpend, 1);
  payload.set(pubView,  33);

  const checksum       = keccak_256(payload).slice(0, 4);
  const full           = new Uint8Array(69);
  full.set(payload);
  full.set(checksum, 65);

  // 6. Monero-specific base58 encode
  const address = xmrBase58Encode(full);

  return {
    address,
    privateSpendKey:  Buffer.from(privSpendLE).toString("hex"),
    privateViewKey:   Buffer.from(privViewLE).toString("hex"),
    publicSpendKey:   Buffer.from(pubSpend).toString("hex"),
    publicViewKey:    Buffer.from(pubView).toString("hex"),
  };
}
