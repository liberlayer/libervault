/**
 * Transaction Building & Broadcasting — LiberVault
 * Pure noble/curves for BTC signing — no WASM, no ecpair, no tiny-secp256k1.
 */

export interface SendParams {
  to:      string;
  amount:  string;
  memo?:   string;
}

export interface SendResult {
  txHash:   string;
  explorer: string;
}

// ─── EVM ──────────────────────────────────────────────────────────────────────

export async function sendEvm(
  privateKey: string,
  rpcUrl:     string,
  chainId:    number,
  params:     SendParams
): Promise<SendResult> {
  const { ethers } = await import("ethers");
  const provider   = new ethers.JsonRpcProvider(rpcUrl);
  const wallet     = new ethers.Wallet(privateKey, provider);
  const tx = await wallet.sendTransaction({
    to:    params.to,
    value: ethers.parseEther(params.amount),
    ...(params.memo ? { data: ethers.hexlify(new TextEncoder().encode(params.memo)) } : {}),
  });
  await tx.wait(1);
  const explorers: Record<number, string> = {
    1: "https://etherscan.io/tx/", 137: "https://polygonscan.com/tx/",
    56: "https://bscscan.com/tx/", 42161: "https://arbiscan.io/tx/",
    8453: "https://basescan.org/tx/",
  };
  return { txHash: tx.hash, explorer: (explorers[chainId] ?? "https://etherscan.io/tx/") + tx.hash };
}

export async function estimateEvmFee(
  rpcUrl: string, _from: string, _to: string, _amount: string
): Promise<{ gasLimit: string; maxFeePerGas: string; totalFeeEth: string }> {
  const { ethers } = await import("ethers");
  const provider   = new ethers.JsonRpcProvider(rpcUrl);
  const feeData    = await provider.getFeeData();
  const gasLimit   = 21000n;
  const maxFee     = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
  return {
    gasLimit:     gasLimit.toString(),
    maxFeePerGas: ethers.formatUnits(maxFee, "gwei") + " gwei",
    totalFeeEth:  ethers.formatEther(gasLimit * maxFee),
  };
}

// ─── Bitcoin — pure @noble/curves/secp256k1 (no WASM) ─────────────────────────

interface Utxo {
  txid: string; vout: number; value: number;
  status: { confirmed: boolean };
}

/** Build a P2WPKH (SegWit v0) input witness from a DER signature + pubkey */
function encodeWitness(sigDer: Uint8Array, hashType: number, pubkey: Uint8Array): Uint8Array[] {
  const sig = new Uint8Array(sigDer.length + 1);
  sig.set(sigDer); sig[sigDer.length] = hashType;
  return [sig, pubkey];
}

/** Minimal PSBT-free SegWit transaction builder using noble secp256k1 */
export async function sendBtc(
  privateKeyHex: string,
  fromAddress:   string,
  params:        SendParams,
  network:       "mainnet" | "signet" | "testnet" = "mainnet"
): Promise<SendResult> {
  // Network-aware endpoints + recipient prefix (signet & testnet share the "tb" HRP).
  const apiBase      = network === "mainnet" ? "https://blockstream.info/api" : `https://blockstream.info/${network}/api`;
  const explorerBase = network === "mainnet" ? "https://blockstream.info/tx/" : `https://blockstream.info/${network}/tx/`;
  const recipHrp     = network === "mainnet" ? "bc1q" : "tb1q";

  const { secp256k1 }  = await import("@noble/curves/secp256k1");
  const { sha256 }     = await import("@noble/hashes/sha256");
  const { ripemd160 }  = await import("@noble/hashes/ripemd160");

  // Helpers
  const dbl256 = (b: Uint8Array) => sha256(sha256(b));
  const hash160 = (b: Uint8Array) => ripemd160(sha256(b));
  const le32 = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
  const le64 = (n: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, n, true); return b; };
  const concat = (...arrs: Uint8Array[]) => { const r = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0)); let o = 0; for (const a of arrs) { r.set(a, o); o += a.length; } return r; };
  const fromHex = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));
  const toHex   = (b: Uint8Array) => Buffer.from(b).toString("hex");

  function varint(n: number): Uint8Array {
    if (n < 0xfd) return new Uint8Array([n]);
    if (n < 0xffff) { const b = new Uint8Array(3); b[0] = 0xfd; new DataView(b.buffer).setUint16(1, n, true); return b; }
    const b = new Uint8Array(5); b[0] = 0xfe; new DataView(b.buffer).setUint32(1, n, true); return b;
  }

  function decodeBech32Address(addr: string): Uint8Array {
    // Decode bc1... native SegWit address → 20-byte pubkey hash
    const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
    const lower   = addr.toLowerCase();
    const sep     = lower.lastIndexOf("1");
    const data    = lower.slice(sep + 1).split("").map(c => CHARSET.indexOf(c));
    // Drop version byte and convert 5-bit groups to 8-bit
    const prog    = data.slice(1, -6); // strip witness version + 6 checksum chars
    const bytes: number[] = [];
    let acc = 0, bits = 0;
    for (const v of prog) {
      acc = (acc << 5) | v; bits += 5;
      if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 0xff); }
    }
    return new Uint8Array(bytes);
  }

  // Fetch UTXOs + fee rate
  const [utxoRes, feeRes] = await Promise.all([
    fetch(`${apiBase}/address/${fromAddress}/utxo`),
    fetch(`${apiBase}/fee-estimates`),
  ]);
  if (!utxoRes.ok) throw new Error("Failed to fetch UTXOs");
  const utxos: Utxo[] = await utxoRes.json();
  const feeRates = await feeRes.json();
  const feeRate  = Math.ceil(feeRates["6"] ?? 5); // sat/vbyte, 6-block target

  const confirmed = utxos.filter(u => u.status.confirmed);
  if (!confirmed.length) throw new Error("No confirmed UTXOs. Wait for confirmations.");

  const privKey  = fromHex(privateKeyHex);
  const pubKey   = secp256k1.getPublicKey(privKey, true); // compressed
  const pkHash   = hash160(pubKey);

  // P2WPKH scriptPubKey: OP_0 <20-byte-hash>
  const scriptPubKey = concat(new Uint8Array([0x00, 0x14]), pkHash);

  const targetSats = BigInt(Math.round(parseFloat(params.amount) * 1e8));

  // Coin selection — greedy
  let inputTotal = 0n;
  const selected: Utxo[] = [];
  for (const utxo of confirmed) {
    selected.push(utxo);
    inputTotal += BigInt(utxo.value);
    const estSize = selected.length * 68 + 2 * 31 + 11;
    if (inputTotal >= targetSats + BigInt(feeRate * estSize)) break;
  }

  const estSize = selected.length * 68 + 2 * 31 + 11;
  const fee     = BigInt(feeRate * estSize);
  const change  = inputTotal - targetSats - fee;
  if (change < 0n) throw new Error(`Insufficient funds: have ${inputTotal} sats, need ${targetSats + fee}`);

  // Decode recipient address → scriptPubKey.
  // Only native SegWit v0 (bc1q…, 20-byte P2WPKH) is supported. We explicitly
  // reject anything else — critically, Taproot (bc1p…, 32-byte) must NOT be
  // encoded as a 20-byte P2WPKH script, which would send funds to a wrong/
  // unspendable output.
  let recipientScript: Uint8Array;
  if (params.to.startsWith(recipHrp)) {
    const recipHash = decodeBech32Address(params.to);
    if (recipHash.length !== 20) throw new Error(`Unsupported Bitcoin address (expected a native SegWit v0 '${recipHrp}…' address)`);
    recipientScript = concat(new Uint8Array([0x00, 0x14]), recipHash);
  } else {
    throw new Error(`Only native SegWit v0 (${recipHrp}…) recipient addresses are supported right now (no legacy/P2SH/Taproot yet)`);
  }

  // Fetch raw txs for inputs
  const rawTxs = await Promise.all(
    selected.map(u => fetch(`${apiBase}/tx/${u.txid}/hex`).then(r => r.text()))
  );

  // BIP-143 sighash preimage for each input
  // hashPrevouts = dSHA256( all outpoints )
  const prevouts = concat(...selected.map(u => concat(fromHex(u.txid).reverse(), le32(u.vout))));
  const hashPrevouts = dbl256(prevouts);

  // hashSequence = dSHA256( all sequences = 0xFFFFFFFE )
  const sequences = concat(...selected.map(() => new Uint8Array([0xfe, 0xff, 0xff, 0xff])));
  const hashSequence = dbl256(sequences);

  // Build outputs
  const outputs: Uint8Array[] = [];
  outputs.push(concat(le64(targetSats), varint(recipientScript.length), recipientScript));
  if (change > 546n) {
    outputs.push(concat(le64(change), varint(scriptPubKey.length), scriptPubKey));
  }
  const hashOutputs = dbl256(concat(...outputs));

  // Sign each input
  const witnesses: Uint8Array[][] = [];
  for (let i = 0; i < selected.length; i++) {
    const utxo = selected[i];
    // scriptCode for P2WPKH: OP_DUP OP_HASH160 <pkHash> OP_EQUALVERIFY OP_CHECKSIG
    const scriptCode = concat(new Uint8Array([0x19, 0x76, 0xa9, 0x14]), pkHash, new Uint8Array([0x88, 0xac]));

    const preimage = concat(
      new Uint8Array([0x01, 0x00, 0x00, 0x00]),   // version LE
      hashPrevouts,
      hashSequence,
      fromHex(utxo.txid).reverse(), le32(utxo.vout), // outpoint
      scriptCode,
      le64(BigInt(utxo.value)),                        // value
      new Uint8Array([0xfe, 0xff, 0xff, 0xff]),         // sequence
      hashOutputs,
      new Uint8Array([0x00, 0x00, 0x00, 0x00]),         // locktime
      new Uint8Array([0x01, 0x00, 0x00, 0x00]),         // sighash SIGHASH_ALL
    );

    const sigHash = dbl256(preimage);
    const sig     = secp256k1.sign(sigHash, privKey, { lowS: true });
    witnesses.push(encodeWitness(sig.toDERRawBytes(), 0x01, pubKey));
  }

  // Serialize segwit transaction
  const inputsSer = selected.map((u, i) =>
    concat(fromHex(u.txid).reverse(), le32(u.vout), new Uint8Array([0x00]), new Uint8Array([0xfe, 0xff, 0xff, 0xff]))
  );

  const witnessSer = witnesses.map(w =>
    concat(varint(w.length), ...w.map(item => concat(varint(item.length), item)))
  );

  const rawTx = concat(
    new Uint8Array([0x01, 0x00, 0x00, 0x00]),              // version
    new Uint8Array([0x00, 0x01]),                            // segwit marker + flag
    varint(selected.length), ...inputsSer,
    varint(outputs.length), ...outputs,
    ...witnessSer,
    new Uint8Array([0x00, 0x00, 0x00, 0x00]),               // locktime
  );

  const broadcastRes = await fetch(`${apiBase}/tx`, {
    method: "POST", body: toHex(rawTx),
  });
  if (!broadcastRes.ok) throw new Error(`Broadcast failed: ${await broadcastRes.text()}`);
  const txid = await broadcastRes.text();

  return { txHash: txid, explorer: `${explorerBase}${txid}` };
}

export async function estimateBtcFee(
  fromAddress: string, _amount: string
): Promise<{ feeRate: string; estimatedFeeSats: string; estimatedFeeBtc: string }> {
  const [utxoRes, feeRes] = await Promise.all([
    fetch(`https://blockstream.info/api/address/${fromAddress}/utxo`),
    fetch("https://blockstream.info/api/fee-estimates"),
  ]);
  const utxos: Utxo[] = await utxoRes.json();
  const fees           = await feeRes.json();
  const feeRate        = Math.ceil(fees["6"] ?? 5);
  const inputCount     = Math.min(utxos.filter(u => u.status.confirmed).length, 3);
  const estSize        = inputCount * 68 + 2 * 31 + 11;
  const feeSats        = feeRate * estSize;
  return {
    feeRate:          `${feeRate} sat/vbyte`,
    estimatedFeeSats: feeSats.toString(),
    estimatedFeeBtc:  (feeSats / 1e8).toFixed(8),
  };
}

// ─── Solana ───────────────────────────────────────────────────────────────────

export async function sendSol(
  privateKeyHex: string,
  params:        SendParams,
  rpcUrl:        string = "https://api.mainnet-beta.solana.com"
): Promise<SendResult> {
  const {
    Connection, Keypair, PublicKey,
    SystemProgram, Transaction, LAMPORTS_PER_SOL, sendAndConfirmTransaction,
  } = await import("@solana/web3.js");
  const conn    = new Connection(rpcUrl, "confirmed");
  const privBuf = Buffer.from(privateKeyHex, "hex").slice(0, 32);
  const keypair = Keypair.fromSeed(privBuf);
  const lamports = Math.round(parseFloat(params.amount) * LAMPORTS_PER_SOL);
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: new PublicKey(params.to), lamports })
  );
  const sig = await sendAndConfirmTransaction(conn, tx, [keypair]);
  const cluster = /devnet/.test(rpcUrl) ? "?cluster=devnet" : /testnet/.test(rpcUrl) ? "?cluster=testnet" : "";
  return { txHash: sig, explorer: `https://solscan.io/tx/${sig}${cluster}` };
}

export async function estimateSolFee(): Promise<{ fee: string }> {
  return { fee: "~0.000005 SOL" };
}

// ─── Substrate (Polkadot / Liberland) ─────────────────────────────────────────

export async function sendSubstrate(
  privateKeyHex: string,
  rpcUrl:        string,
  symbol:        string,
  decimals:      number,
  params:        SendParams
): Promise<SendResult> {
  const { ApiPromise, WsProvider }   = await import("@polkadot/api");
  const { Keyring }                  = await import("@polkadot/keyring");
  const { cryptoWaitReady }          = await import("@polkadot/util-crypto");
  await cryptoWaitReady();
  // WsProvider, not HttpProvider: nearly all Substrate RPCs are WSS-only, and the
  // signAndSend status subscription (isInBlock/isFinalized) requires a WS connection.
  const api      = await ApiPromise.create({ provider: new WsProvider(rpcUrl), noInitWarn: true });
  const keyring  = new Keyring({ type: "sr25519" });
  const account  = keyring.addFromSeed(Buffer.from(privateKeyHex, "hex"));
  const rawAmt   = BigInt(Math.round(parseFloat(params.amount) * 10 ** decimals));
  const ext      = api.tx.balances.transferAllowDeath
    ? api.tx.balances.transferAllowDeath(params.to, rawAmt)
    : api.tx.balances.transfer(params.to, rawAmt);
  const txHash = await new Promise<string>((resolve, reject) => {
    ext.signAndSend(account, ({ status, dispatchError }: any) => {
      if (dispatchError) {
        const msg = dispatchError.isModule
          ? (() => { const d = api.registry.findMetaError(dispatchError.asModule); return `${d.section}.${d.name}`; })()
          : dispatchError.toString();
        reject(new Error(msg));
      }
      if (status.isInBlock || status.isFinalized)
        resolve((status.isInBlock ? status.asInBlock : status.asFinalized).toString());
    });
  });
  await api.disconnect();
  const explorers: Record<string, string> = {
    DOT: `https://polkadot.subscan.io/extrinsic/${txHash}`,
    LLD: `https://liberland.subscan.io/extrinsic/${txHash}`,
  };
  return { txHash, explorer: explorers[symbol] ?? `https://polkadot.subscan.io/extrinsic/${txHash}` };
}

export async function estimateSubstrateFee(
  rpcUrl: string, from: string, to: string, amount: string, decimals: number
): Promise<{ fee: string; symbol: string }> {
  try {
    const { ApiPromise, WsProvider } = await import("@polkadot/api");
    const api      = await ApiPromise.create({ provider: new WsProvider(rpcUrl), noInitWarn: true });
    const rawAmt   = BigInt(Math.round(parseFloat(amount || "0") * 10 ** decimals));
    const info: any = await api.tx.balances.transferAllowDeath(to || from, rawAmt).paymentInfo(from);
    const fee = (Number(BigInt(info.partialFee.toString())) / 10 ** decimals).toFixed(6);
    const sym = api.registry.chainTokens?.[0] ?? "DOT";
    await api.disconnect();
    return { fee, symbol: sym };
  } catch { return { fee: "~0.01", symbol: "DOT" }; }
}

// ─── Monero ───────────────────────────────────────────────────────────────────

export async function sendXmrTx(
  address:        string,
  privateSpendKey: string,
  privateViewKey:  string,
  params:          SendParams,
  restoreHeight:   number = 0,
  network:         "mainnet" | "stagenet" | "testnet" = "mainnet",
  daemonUri?:      string
): Promise<SendResult> {
  const { getXmrWallet, sendXmr } = await import("./xmr-wallet");
  const session = await getXmrWallet(address, privateSpendKey, privateViewKey, restoreHeight, network, daemonUri);
  const result  = await sendXmr(session, params.to, params.amount);
  return { txHash: result.txHash, explorer: result.explorer };
}

export async function estimateXmrFeeForSend(
  address:        string,
  privateSpendKey: string,
  privateViewKey:  string,
  to:             string,
  amount:         string,
  restoreHeight:   number = 0
): Promise<string> {
  try {
    const { getXmrWallet, estimateXmrFee } = await import("./xmr-wallet");
    const session = await getXmrWallet(address, privateSpendKey, privateViewKey, restoreHeight);
    return estimateXmrFee(session, to, amount);
  } catch { return "~0.000016 XMR (typical)"; }
}

// ─── Tron ───────────────────────────────────────────────────────────────────────
// Pure secp256k1 (reuses the EVM curve) + TronGrid REST — no tronweb in the bundle.

export async function sendTronTx(
  privateKeyHex: string,
  fromAddress:   string,
  params:        SendParams,
  host:          string = "https://api.trongrid.io"
): Promise<SendResult> {
  const { sendTron } = await import("./tron");
  return sendTron(privateKeyHex, fromAddress, params.to, params.amount, host);
}

export async function estimateTronFee(): Promise<{ fee: string }> {
  // A plain TRX transfer consumes bandwidth; with a free daily bandwidth
  // allowance it is typically free, otherwise ~0.267 TRX is burned.
  return { fee: "~0.267 TRX (or free w/ bandwidth)" };
}
