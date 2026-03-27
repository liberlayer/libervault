/**
 * Monero Wallet — LiberVault
 * --------------------------
 * Uses monero-javascript (WASM) to create an in-memory wallet from
 * existing spend/view keys and connect to a remote daemon for:
 *   - Output scanning (balance)
 *   - Ring signature construction (send)
 *
 * The wallet is cached in the background service worker session.
 * First use after unlock triggers a partial sync from restoreHeight.
 *
 * Privacy note: the view key is shared with the remote daemon during
 * scanning. Use a self-hosted node for maximum privacy.
 */

export interface XmrWalletSession {
  wallet:      any;   // MoneroWalletFull instance
  synced:      boolean;
  syncHeight:  number;
}

let xmrSession: XmrWalletSession | null = null;

// The public node we use by default. Can be overridden in settings (Phase 3).
const DEFAULT_DAEMON = "https://xmr.node.community:18089";

/**
 * Initialise (or return cached) Monero wallet from spend + view keys.
 * restoreHeight should be set to the block where the wallet was first used.
 * Use 0 to scan from genesis (slow!). For new wallets, use current height.
 */
export async function getXmrWallet(
  address:        string,
  privateSpendKey: string,   // hex LE
  privateViewKey:  string,   // hex LE
  restoreHeight:   number = 0
): Promise<XmrWalletSession> {
  if (xmrSession?.wallet) return xmrSession;

  // Dynamic import keeps this out of the initial bundle
  const xmr = await import("monero-javascript");

  // Tell the library where to find WASM + worker in extension context
  const extBase = typeof chrome !== "undefined" && chrome.runtime
    ? chrome.runtime.getURL("src/assets/")
    : "./";

  xmr.LibraryUtils.setWorkerDistPath(extBase);

  // Create an in-memory wallet (no file I/O) from existing keys
  const wallet = await xmr.createWalletFull(
    new xmr.MoneroWalletConfig()
      .setPrimaryAddress(address)
      .setPrivateSpendKey(privateSpendKey)   // monero-javascript expects LE hex
      .setPrivateViewKey(privateViewKey)
      .setNetworkType(xmr.MoneroNetworkType.MAINNET)
      .setServerUri(DEFAULT_DAEMON)
      .setRestoreHeight(restoreHeight)
      .setProxyToWorker(false)               // required: no dedicated worker in MV3
  );

  xmrSession = { wallet, synced: false, syncHeight: restoreHeight };
  return xmrSession;
}

/**
 * Sync the wallet up to the current chain height.
 * Resolves when caught up. Can take seconds→minutes depending on history.
 */
export async function syncXmrWallet(session: XmrWalletSession): Promise<void> {
  if (session.synced) return;
  await session.wallet.sync();
  session.synced = true;
  session.syncHeight = await session.wallet.getHeight();
}

/**
 * Get the current balance. Syncs first if not yet synced.
 */
export async function getXmrBalance(session: XmrWalletSession): Promise<{
  balance:    string;   // total (including locked) in atomic units
  unlocked:   string;   // spendable now
  formatted:  string;   // human-readable XMR
}> {
  await syncXmrWallet(session);
  const balance   = await session.wallet.getBalance();
  const unlocked  = await session.wallet.getUnlockedBalance();
  const toXmr = (n: bigint) => (Number(n) / 1e12).toFixed(6);
  return {
    balance:   balance.toString(),
    unlocked:  unlocked.toString(),
    formatted: `${toXmr(BigInt(unlocked.toString()))} XMR`,
  };
}

/**
 * Send XMR. Constructs ring signatures via WASM and broadcasts.
 * Requires the wallet to be synced (outputs known).
 */
export async function sendXmr(
  session:  XmrWalletSession,
  to:       string,
  amount:   string,           // human-readable XMR, e.g. "0.5"
  priority: number = 1        // 1=normal, 2=elevated, 3=priority, 4=unimportant
): Promise<{ txHash: string; fee: string; explorer: string }> {
  const xmr = await import("monero-javascript");

  if (!session.synced) {
    // Partial sync — get latest outputs before sending
    await syncXmrWallet(session);
  }

  // Convert human-readable XMR to piconero (1 XMR = 1e12 piconero)
  const piconero = BigInt(Math.round(parseFloat(amount) * 1e12));

  const txConfig = new xmr.MoneroTxConfig()
    .setAddress(to)
    .setAmount(piconero)
    .setPriority(priority);

  // createTx builds + signs the ring signature transaction
  const tx = await session.wallet.createTx(txConfig);

  // relayTx broadcasts to the network via the connected daemon
  await session.wallet.relayTx(tx);

  const txHash = await tx.getHash();
  const feePico = await tx.getFee();
  const feeXmr  = (Number(BigInt(feePico.toString())) / 1e12).toFixed(6);

  return {
    txHash,
    fee:      `${feeXmr} XMR`,
    explorer: `https://xmrchain.net/tx/${txHash}`,
  };
}

/**
 * Estimate fee for a potential send (does not broadcast).
 */
export async function estimateXmrFee(
  session: XmrWalletSession,
  to:      string,
  amount:  string
): Promise<string> {
  try {
    const xmr = await import("monero-javascript");
    const piconero = BigInt(Math.round(parseFloat(amount || "0.001") * 1e12));
    const txConfig = new xmr.MoneroTxConfig()
      .setAddress(to || session.wallet.getPrimaryAddress())
      .setAmount(piconero);
    const tx  = await session.wallet.createTx(txConfig);
    const fee = await tx.getFee();
    const xmrFee = (Number(BigInt(fee.toString())) / 1e12).toFixed(6);
    return `~${xmrFee} XMR`;
  } catch {
    return "~0.000016 XMR (typical)";
  }
}

/** Clear cached wallet session on lock */
export function clearXmrSession(): void {
  if (xmrSession?.wallet) {
    try { xmrSession.wallet.close(); } catch { /* ignore */ }
  }
  xmrSession = null;
}
