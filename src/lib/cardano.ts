/**
 * Cardano (ADA) — LiberVault
 * --------------------------
 * PURE-TypeScript implementation:
 *   - @stricahq/bip32ed25519  — CIP-1852 Ed25519-BIP32 key derivation
 *   - @stricahq/typhonjs      — Shelley address + transaction builder
 *
 * Why not CSL: EMURGO's cardano-serialization-lib cannot bundle into an MV3
 * browser extension — the WASM build needs top-level await (forbidden in the
 * extension's iife script output) and the asm.js build is ~15 MB and crashes
 * the bundler. The @stricahq stack is pure JS (no WASM), tiny, and is the
 * derivation/tx stack used by Typhon- / Eternl-class light wallets.
 *
 * Derivation: CIP-1852  m/1852'/1815'/0'/{0/0 payment, 2/0 stake}
 * Address:    Shelley base address (addr1...) = payment keyhash + stake keyhash
 * Balance:    Koios (free, keyless REST)
 * Send:       typhonjs paymentTransaction + Koios /address_utxos + /submittx
 *             ⚠️ Implemented but NOT yet preprod-verified (moves real funds —
 *             same caveat as every other chain's send path). Test on preprod
 *             (NETWORK_ID = 0) with throwaway ADA before relying on mainnet.
 */

import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";

// mainnet = 1, preprod/preview testnet = 0
const NETWORK_ID = 1;
const KOIOS = NETWORK_ID === 1
  ? "https://api.koios.rest/api/v1"
  : "https://preprod.koios.rest/api/v1";

export interface CardanoKeys {
  address:        string;  // addr1... (or addr_test1... on testnet)
  paymentXprvHex: string;  // GUARD like the mnemonic (Bip32 xprv, 96 bytes hex)
  stakeXprvHex:   string;
}

/** Derive the CIP-1852 account keys + Shelley base address from the mnemonic. */
export async function deriveCardanoAccount(mnemonic: string): Promise<CardanoKeys> {
  const { Bip32PrivateKey } = await import("@stricahq/bip32ed25519");
  const typhon = await import("@stricahq/typhonjs");
  const { HashType, NetworkId } = typhon.types;

  const entropy = bip39.mnemonicToEntropy(mnemonic.trim(), wordlist);
  const root = await Bip32PrivateKey.fromEntropy(Buffer.from(entropy));

  const account = root.deriveHardened(1852).deriveHardened(1815).deriveHardened(0);
  const paymentKey = account.derive(0).derive(0);   // external chain, index 0
  const stakeKey   = account.derive(2).derive(0);   // staking chain, index 0

  const paymentHash = paymentKey.toPrivateKey().toPublicKey().hash();
  const stakeHash   = stakeKey.toPrivateKey().toPublicKey().hash();

  const addr = new typhon.address.BaseAddress(
    NETWORK_ID === 1 ? NetworkId.MAINNET : NetworkId.TESTNET,
    { hash: paymentHash, type: HashType.ADDRESS },
    { hash: stakeHash,   type: HashType.ADDRESS },
  );

  return {
    address:        addr.getBech32(),
    paymentXprvHex: paymentKey.toBytes().toString("hex"),
    stakeXprvHex:   stakeKey.toBytes().toString("hex"),
  };
}

/** Balance in lovelace + formatted ADA, via Koios (keyless). */
export async function getCardanoBalance(address: string): Promise<{ lovelace: string; formatted: string }> {
  const res = await fetch(`${KOIOS}/address_info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ _addresses: [address] }),
  });
  if (!res.ok) throw new Error(`Koios address_info ${res.status}`);
  const data = await res.json();
  const lovelace = (Array.isArray(data) && data[0]?.balance) ? String(data[0].balance) : "0";
  return { lovelace, formatted: `${(Number(lovelace) / 1e6).toFixed(6)} ADA` };
}

export interface CardanoSendResult { txHash: string; explorer: string; }

/**
 * Send ADA via typhonjs.  ⚠️ NOT preprod-verified yet — test before mainnet use.
 * Pulls UTXOs + protocol params + tip from Koios, builds/balances a payment tx,
 * signs with the payment key, submits the CBOR to Koios /submittx.
 */
export async function sendCardano(
  paymentXprvHex: string,
  fromAddress:    string,
  to:             string,
  amountAda:      string,
): Promise<CardanoSendResult> {
  const { Bip32PrivateKey } = await import("@stricahq/bip32ed25519");
  const typhon = await import("@stricahq/typhonjs");
  const BigNumber = (await import("bignumber.js")).default;

  // 1. protocol params (Koios /epoch_params, current epoch) — only ADA-payment fields matter here
  const ep = (await (await fetch(`${KOIOS}/epoch_params`)).json())[0];
  const protocolParams = {
    minFeeA:            new BigNumber(ep.min_fee_a),
    minFeeB:            new BigNumber(ep.min_fee_b),
    stakeKeyDeposit:    new BigNumber(ep.key_deposit),
    lovelacePerUtxoWord: new BigNumber(34482),
    utxoCostPerByte:    new BigNumber(ep.coins_per_utxo_size ?? 4310),
    collateralPercent:  new BigNumber(ep.collateral_percent ?? 150),
    priceSteps:         new BigNumber(ep.price_step ?? 0.0000721),
    priceMem:           new BigNumber(ep.price_mem ?? 0.0577),
    languageView:       {},                       // no Plutus for a simple payment
    maxTxSize:          Number(ep.max_tx_size ?? 16384),
    maxValueSize:       Number(ep.max_val_size ?? 5000),
  };

  // 2. UTXOs for the from-address
  const utxosRaw = await (await fetch(`${KOIOS}/address_utxos`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ _addresses: [fromAddress], _extended: false }),
  })).json();
  if (!Array.isArray(utxosRaw) || !utxosRaw.length) throw new Error("No UTXOs at address");

  // 3. current tip → TTL (current slot + ~2h)
  const tip = (await (await fetch(`${KOIOS}/tip`)).json())[0];
  const ttl = Number(tip.abs_slot) + 7200;

  const fromAddr = typhon.utils.getAddressFromString(fromAddress);
  const toAddr   = typhon.utils.getAddressFromString(to);

  const inputs = utxosRaw.map((u: any) => ({
    txId:    u.tx_hash,
    index:   u.tx_index,
    amount:  new BigNumber(u.value),
    tokens:  [],
    address: fromAddr,
  }));

  const lovelace = new BigNumber(amountAda).times(1e6).integerValue();
  const output = { address: toAddr, amount: lovelace, tokens: [] };

  // 4. build + balance the payment tx (typhonjs picks inputs, computes fee + change)
  const tx = new typhon.Transaction({ protocolParams });
  tx.paymentTransaction({ inputs, outputs: [output], changeAddress: fromAddr, ttl });

  // 5. sign the tx hash with the payment key
  const payKey  = new Bip32PrivateKey(Buffer.from(paymentXprvHex, "hex")).toPrivateKey();
  const txHash  = tx.getTransactionHash();
  tx.addWitness({ publicKey: payKey.toPublicKey().toBytes(), signature: payKey.sign(txHash) });

  // 6. submit CBOR to Koios /submittx
  const { payload } = tx.buildTransaction();
  const subRes = await fetch(`${KOIOS}/submittx`, {
    method: "POST",
    headers: { "Content-Type": "application/cbor" },
    body: Buffer.from(payload, "hex"),
  });
  if (!subRes.ok) throw new Error(`submittx ${subRes.status}: ${await subRes.text()}`);
  const txHashHex = (await subRes.text()).replace(/"/g, "");

  return {
    txHash:   txHashHex,
    explorer: NETWORK_ID === 1
      ? `https://cardanoscan.io/transaction/${txHashHex}`
      : `https://preprod.cardanoscan.io/transaction/${txHashHex}`,
  };
}
