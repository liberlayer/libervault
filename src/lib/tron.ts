/**
 * Tron (TRX) — LiberVault
 * -----------------------
 * PURE-TypeScript implementation — NO tronweb in the bundle.
 *
 * Why not tronweb: tronweb pulls in a large dependency graph (elliptic, a full
 * ethers fork, bn.js, axios, etc.) that bloats and can break the MV3 bundle.
 * Tron uses the SAME secp256k1 curve as EVM, so we reuse the wallet's existing
 * @noble/curves + @noble/hashes primitives — exactly the philosophy used for
 * Bitcoin (send.ts) and Cardano (cardano.ts): light, no WASM, no Node shims.
 *
 * Derivation: BIP-44  m/44'/195'/0'/0/0  secp256k1  (coin type 195 = TRX)
 * Address:    base58check( 0x41 || keccak256(uncompressedPubkey[1:])[-20:] )
 *             -> "T..." (34 chars)
 * Balance:    TronGrid wallet/getaccount (HTTP, keyless)
 * Send:       wallet/createtransaction -> sign txID with secp256k1 (recoverable,
 *             65-byte sig) -> wallet/broadcasttransaction. This mirrors what
 *             tronweb does internally, but keeps the bundle light.
 */

import { HDKey }      from "@scure/bip32";
import * as bip39     from "@scure/bip39";
import { secp256k1 }  from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 }     from "@noble/hashes/sha256";

// --- Endpoints --------------------------------------------------------------
// TronGrid REST. Nile is Tron's primary public testnet.
export const TRON_MAINNET = "https://api.trongrid.io";
export const TRON_NILE    = "https://nile.trongrid.io";

const PATH_TRON = "m/44'/195'/0'/0/0";

// --- base58check (Bitcoin alphabet + double-sha256 checksum) ----------------
// Self-contained -- mirrors the inline base58 helper in keyring.ts so we add no
// new dependency. Tron uses standard base58check (NOT Monero's block base58).

const B58_ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) { out = B58_ALPHA[Number(n % 58n)] + out; n /= 58n; }
  // Preserve leading-zero bytes as leading '1's.
  for (const b of bytes) { if (b !== 0) break; out = "1" + out; }
  return out;
}

function base58Decode(str: string): Uint8Array {
  let n = 0n;
  for (const ch of str) {
    const v = B58_ALPHA.indexOf(ch);
    if (v < 0) throw new Error("Invalid base58 character");
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  // Restore leading zeros.
  for (const ch of str) { if (ch !== "1") break; bytes.unshift(0); }
  return new Uint8Array(bytes);
}

/** base58check encode: payload || dsha256(payload)[:4] */
function base58CheckEncode(payload: Uint8Array): string {
  const checksum = sha256(sha256(payload)).slice(0, 4);
  const full = new Uint8Array(payload.length + 4);
  full.set(payload);
  full.set(checksum, payload.length);
  return base58Encode(full);
}

/** base58check decode -> 21-byte payload (0x41 || 20-byte hash), checksum-verified */
function base58CheckDecode(addr: string): Uint8Array {
  const full = base58Decode(addr);
  if (full.length < 5) throw new Error("Invalid Tron address (too short)");
  const payload  = full.slice(0, -4);
  const checksum = full.slice(-4);
  const expected = sha256(sha256(payload)).slice(0, 4);
  for (let i = 0; i < 4; i++) if (checksum[i] !== expected[i]) throw new Error("Bad Tron address checksum");
  return payload;
}

const toHex   = (b: Uint8Array) => Buffer.from(b).toString("hex");
const fromHex = (h: string) => Uint8Array.from(Buffer.from(h.replace(/^0x/, ""), "hex"));

// --- Address helpers --------------------------------------------------------

/** secp256k1 private key (hex) -> 21-byte address bytes (0x41 || keccak[-20:]) */
function privKeyToAddressBytes(privKeyHex: string): Uint8Array {
  const priv = fromHex(privKeyHex);
  // Uncompressed pubkey = 0x04 || X(32) || Y(32). Drop the 0x04 prefix.
  const pub  = secp256k1.getPublicKey(priv, false).slice(1);
  const hash = keccak_256(pub);          // 32 bytes
  const addr = new Uint8Array(21);
  addr[0] = 0x41;                        // Tron mainnet address prefix
  addr.set(hash.slice(-20), 1);          // last 20 bytes of keccak256
  return addr;
}

/** secp256k1 private key (hex) -> base58check "T..." address */
export function privKeyToTronAddress(privKeyHex: string): string {
  return base58CheckEncode(privKeyToAddressBytes(privKeyHex));
}

/** base58 "T..." -> 21-byte hex address (with 41 prefix), as the node's `hex` form */
export function tronAddressToHex(base58: string): string {
  return toHex(base58CheckDecode(base58));
}

export interface TronKeys {
  address:    string;  // base58 "T..."
  hexAddress: string;  // 41-prefixed hex
  privateKey: string;  // hex -- GUARD like the mnemonic
}

// --- Derivation -------------------------------------------------------------

/** Derive the Tron account (BIP-44 coin type 195) from the wallet mnemonic. */
export function deriveTronAccount(mnemonic: string): TronKeys {
  const seed  = bip39.mnemonicToSeedSync(mnemonic.trim());
  const root  = HDKey.fromMasterSeed(seed);
  const child = root.derive(PATH_TRON);
  if (!child.privateKey) throw new Error("Tron derivation failed");
  const privHex = toHex(child.privateKey);
  return {
    address:    privKeyToTronAddress(privHex),
    hexAddress: toHex(privKeyToAddressBytes(privHex)),
    privateKey: privHex,
  };
}

// --- Balance ----------------------------------------------------------------

export interface TronBalance { sun: string; formatted: string; }

/**
 * Fetch TRX balance via TronGrid wallet/getaccount.
 * Returns balance in sun (1 TRX = 1e6 sun); an empty `{}` response means 0.
 */
export async function getTronBalance(
  address: string,
  host: string = TRON_MAINNET
): Promise<TronBalance> {
  const res = await fetch(`${host}/wallet/getaccount`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, visible: true }),
  });
  if (!res.ok) throw new Error(`TronGrid getaccount ${res.status}`);
  const data = await res.json();
  // A fresh (never-activated) account returns {} -> balance 0.
  const sun = BigInt(data?.balance ?? 0);
  return { sun: sun.toString(), formatted: (Number(sun) / 1e6).toFixed(6) };
}

// --- Send -------------------------------------------------------------------

export interface TronSendResult { txHash: string; explorer: string; }

/**
 * Sign the 32-byte Tron txID with secp256k1 -> 65-byte recoverable signature hex
 * (r||s||v) where v = recovery id (0/1), matching tronweb's signature format.
 */
function signTxID(txIDHex: string, privKeyHex: string): string {
  const msgHash = fromHex(txIDHex);
  const priv    = fromHex(privKeyHex);
  const sig     = secp256k1.sign(msgHash, priv, { lowS: false });
  const compact = sig.toCompactRawBytes();          // r(32) || s(32)
  const out = new Uint8Array(65);
  out.set(compact, 0);
  out[64] = sig.recovery!;                            // recovery id (0 or 1)
  return toHex(out);
}

/**
 * Send TRX. Three-step TronGrid flow (the same path tronweb walks internally):
 *   1. wallet/createtransaction -> unsigned raw tx incl txID
 *   2. sign txID with secp256k1 (65-byte recoverable sig)
 *   3. wallet/broadcasttransaction -> { result, txid }
 */
export async function sendTron(
  privateKeyHex: string,
  fromAddress:   string,   // base58 "T..."
  toAddress:     string,   // base58 "T..."
  amount:        string,   // TRX (decimal string)
  host:          string = TRON_MAINNET
): Promise<TronSendResult> {
  const sun = BigInt(Math.round(parseFloat(amount) * 1e6));
  if (sun <= 0n) throw new Error("Amount must be greater than 0");

  // 1. Build the unsigned transaction.
  const createRes = await fetch(`${host}/wallet/createtransaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to_address:    toAddress,
      owner_address: fromAddress,
      amount:        Number(sun),
      visible:       true,
    }),
  });
  if (!createRes.ok) throw new Error(`createtransaction ${createRes.status}`);
  const tx: any = await createRes.json();
  if (tx.Error || !tx.txID) {
    throw new Error(`createtransaction failed: ${tx.Error ?? JSON.stringify(tx)}`);
  }

  // 2. Sign the txID and attach the signature.
  tx.signature = [signTxID(tx.txID, privateKeyHex)];

  // 3. Broadcast.
  const bcRes = await fetch(`${host}/wallet/broadcasttransaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tx),
  });
  if (!bcRes.ok) throw new Error(`broadcast ${bcRes.status}`);
  const bc: any = await bcRes.json();
  if (!bc.result) {
    const reason = bc.message ? Buffer.from(bc.message, "hex").toString("utf8") : JSON.stringify(bc);
    throw new Error(`Broadcast rejected: ${reason}`);
  }

  const txid = bc.txid ?? tx.txID;
  const explorerBase = host === TRON_MAINNET
    ? "https://tronscan.org/#/transaction/"
    : "https://nile.tronscan.org/#/transaction/";
  return { txHash: txid, explorer: `${explorerBase}${txid}` };
}
