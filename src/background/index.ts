/**
 * Background Service Worker — LiberVault
 * Secure key store + signing + broadcasting.
 * Popup communicates via chrome.runtime.sendMessage.
 */

import { MSG, VaultRequest, VaultResponse, WalletStatus, AccountSet } from "../lib/messages";
import { vaultExists, saveVault, loadVault }    from "../lib/storage";
import { generateMnemonic, validateMnemonic, deriveAllAccounts, DerivedAccounts, waitForCrypto } from "../lib/keyring";
import { fetchAllBalances, AllBalances }         from "../lib/balance";
import { sendEvm, sendBtc, sendSol, sendSubstrate, sendXmrTx, sendTronTx, estimateEvmFee, estimateBtcFee, estimateSolFee, estimateSubstrateFee, estimateXmrFeeForSend, estimateTronFee } from "../lib/send";
import { sendCardano } from "../lib/cardano";

interface Session {
  accounts: DerivedAccounts | null;
  unlocked: boolean;
  balances: AllBalances | null;
}

let session: Session = { accounts: null, unlocked: false, balances: null };

waitForCrypto().catch(console.error);

// Auto-lock: wipe the decrypted in-memory session (keys) after this much inactivity.
const AUTO_LOCK_MS = 15 * 60 * 1000; // 15 minutes
let lastActivity = Date.now();
function lockSession() {
  import("../lib/xmr-wallet").then(m => m.clearXmrSession()).catch(() => {});
  session = { accounts: null, unlocked: false, balances: null };
}

chrome.alarms.create("keepAlive", { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(() => {
  if (session.unlocked && Date.now() - lastActivity > AUTO_LOCK_MS) lockSession();
});

chrome.runtime.onMessage.addListener((msg: VaultRequest, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then(sendResponse)
    .catch(err => sendResponse({ type: msg.type, error: (err as Error).message } as VaultResponse));
  return true;
});

// ─── dApp approval flow ───────────────────────────────────────────────────────
// Sensitive dApp requests (connect / sign) must be explicitly approved by the user
// in a popup window. Origins that approve a connection are remembered for the session.
type ApprovalDetail = { origin: string; kind: "connect" | "sign"; chain?: string; message?: string };
const pendingApprovals = new Map<string, { resolve: (ok: boolean) => void; detail: ApprovalDetail }>();
const connectedOrigins = new Set<string>();
let approvalSeq = 0;

function requestApproval(detail: ApprovalDetail): Promise<boolean> {
  return new Promise((resolve) => {
    const id = `apv_${++approvalSeq}_${Date.now()}`;
    pendingApprovals.set(id, { resolve, detail });
    chrome.windows.create({
      url: chrome.runtime.getURL(`src/approve/index.html?id=${id}`),
      type: "popup", width: 380, height: 600, focused: true,
    }).catch(() => { pendingApprovals.delete(id); resolve(false); });
    // Safety: if the window is closed without a choice, auto-reject after 2 minutes.
    setTimeout(() => { const p = pendingApprovals.get(id); if (p) { pendingApprovals.delete(id); p.resolve(false); } }, 120_000);
  });
}
function originOf(sender?: chrome.runtime.MessageSender): string {
  try { return (sender && (sender.origin || (sender.url ? new URL(sender.url).origin : ""))) || "unknown site"; }
  catch { return "unknown site"; }
}

function toAccountSet(a: DerivedAccounts): AccountSet {
  return {
    evm: a.evm, bitcoin: a.bitcoin, solana: a.solana,
    polkadot: a.polkadot, liberland: a.liberland, monero: a.monero, cardano: a.cardano, tron: a.tron,
  };
}

async function handleMessage(msg: VaultRequest, sender?: chrome.runtime.MessageSender): Promise<VaultResponse> {
  lastActivity = Date.now();   // any message counts as activity → defers auto-lock
  switch (msg.type) {

    // ── Approval popup ↔ background ──────────────────────────────────────────────
    case MSG.GET_PENDING_APPROVAL: {
      const id = (msg.payload as { id?: string })?.id || "";
      const p = pendingApprovals.get(id);
      return { type: msg.type, payload: p ? p.detail : null };
    }
    case MSG.TX_APPROVE: {
      const id = (msg.payload as { id?: string })?.id || "";
      const p = pendingApprovals.get(id);
      if (p) { pendingApprovals.delete(id); p.resolve(true); }
      return { type: msg.type };
    }
    case MSG.TX_REJECT: {
      const id = (msg.payload as { id?: string })?.id || "";
      const p = pendingApprovals.get(id);
      if (p) { pendingApprovals.delete(id); p.resolve(false); }
      return { type: msg.type };
    }

    case MSG.WALLET_STATUS: {
      const initialized = await vaultExists();
      return { type: msg.type, payload: { initialized, unlocked: session.unlocked } as WalletStatus };
    }

    case MSG.WALLET_CREATE: {
      const { password } = msg.payload as { password: string };
      if (!password || password.length < 8) throw new Error("Password must be at least 8 characters");
      const mnemonic = generateMnemonic();
      await saveVault({ mnemonic }, password);
      const accounts = await deriveAllAccounts(mnemonic);
      session = { accounts, unlocked: true, balances: null };
      return { type: msg.type, payload: { mnemonic, accounts: toAccountSet(accounts) } };
    }

    case MSG.WALLET_IMPORT: {
      const { mnemonic, password } = msg.payload as { mnemonic: string; password: string };
      if (!validateMnemonic(mnemonic))      throw new Error("Invalid mnemonic phrase");
      if (!password || password.length < 8) throw new Error("Password must be at least 8 characters");
      await saveVault({ mnemonic: mnemonic.trim() }, password);
      const accounts = await deriveAllAccounts(mnemonic.trim());
      session = { accounts, unlocked: true, balances: null };
      return { type: msg.type, payload: { accounts: toAccountSet(accounts) } };
    }

    case MSG.WALLET_UNLOCK: {
      const { password } = msg.payload as { password: string };
      const vault    = await loadVault(password);
      const accounts = await deriveAllAccounts(vault.mnemonic);
      session = { accounts, unlocked: true, balances: null };
      return { type: msg.type, payload: { accounts: toAccountSet(accounts) } };
    }

    case MSG.WALLET_LOCK: {
      const { clearXmrSession } = await import('../lib/xmr-wallet');
      clearXmrSession();
      session = { accounts: null, unlocked: false, balances: null };
      return { type: msg.type };
    }

    case MSG.GET_ACCOUNTS: {
      if (!session.unlocked || !session.accounts) throw new Error("Wallet locked");
      return { type: msg.type, payload: toAccountSet(session.accounts) };
    }

    case MSG.GET_BALANCES: {
      if (!session.unlocked || !session.accounts) throw new Error("Wallet locked");
      const balances = await fetchAllBalances(
        toAccountSet(session.accounts),
        { privateViewKey: session.accounts.xmrViewPrivkey, publicSpendKey: session.accounts.xmrSpendPubkey }
      );
      session.balances = balances;
      return { type: msg.type, payload: balances };
    }

    case MSG.ETH_REQUEST: {
      const { method, params } = msg.payload as { method: string; params: unknown[] };
      return { type: msg.type, payload: await handleEthRequest(method, params, originOf(sender)) };
    }

    case MSG.DOT_REQUEST: {
      const { method, params } = msg.payload as { method: string; params: unknown[] };
      return { type: msg.type, payload: await handleDotRequest(method, params) };
    }

    case MSG.XMR_REQUEST: {
      const { method, params } = msg.payload as { method: string; params: unknown[] };
      return { type: msg.type, payload: await handleXmrRequest(method, params, originOf(sender)) };
    }

    case MSG.TRX_REQUEST: {
      const { method, params } = msg.payload as { method: string; params: unknown[] };
      return { type: msg.type, payload: await handleTrxRequest(method, params, originOf(sender)) };
    }

    // ── Send Transaction ────────────────────────────────────────────────────────
    case "VAULT_SEND_TX" as any: {
      if (!session.unlocked || !session.accounts) throw new Error("Wallet locked");
      const req = msg.payload as { chain: string; to: string; amount: string; memo?: string; chainId?: number; restoreHeight?: number };
      const result = await dispatchSend(session.accounts, req);
      return { type: msg.type, payload: result };
    }

    // ── Fee Estimate ────────────────────────────────────────────────────────────
    case "VAULT_ESTIMATE_FEE" as any: {
      if (!session.unlocked || !session.accounts) throw new Error("Wallet locked");
      const req = msg.payload as { chain: string; to?: string; amount?: string };
      const fee = await dispatchFeeEstimate(session.accounts, req);
      return { type: msg.type, payload: fee };
    }

    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}

// ─── Send dispatcher ──────────────────────────────────────────────────────────

async function dispatchSend(
  accounts: DerivedAccounts,
  req: { chain: string; to: string; amount: string; memo?: string; chainId?: number; restoreHeight?: number }
) {
  const params = { to: req.to, amount: req.amount, memo: req.memo };

  switch (req.chain) {
    case "evm":
      return sendEvm(
        accounts.evmPrivkey,
        "https://cloudflare-eth.com",
        req.chainId ?? 1,
        params
      );
    case "bitcoin":
      return sendBtc(accounts.btcPrivkey, accounts.bitcoin, params);
    case "solana":
      return sendSol(accounts.solPrivkey, params);
    case "polkadot":
      return sendSubstrate(accounts.substratePrivkey, "https://rpc.polkadot.io", "DOT", 10, params);
    case "liberland":
      return sendSubstrate(accounts.substratePrivkey, "https://mainnet.liberland.org", "LLD", 12, params);
    case "cardano":
      return sendCardano(accounts.cardanoPaymentXprv, accounts.cardano, req.to, req.amount);
    case "monero":
      return sendXmrTx(
        accounts.monero,
        accounts.xmrSpendPrivkey,
        accounts.xmrViewPrivkey,
        params,
        req.restoreHeight ?? 0
      );
    case "tron":
      return sendTronTx(accounts.tronPrivkey, accounts.tron, params);
    default:
      throw new Error(`Unknown chain: ${req.chain}`);
  }
}

// ─── Fee estimate dispatcher ──────────────────────────────────────────────────

async function dispatchFeeEstimate(
  accounts: DerivedAccounts,
  req: { chain: string; to?: string; amount?: string }
) {
  switch (req.chain) {
    case "evm": {
      const f = await estimateEvmFee("https://cloudflare-eth.com", accounts.evm, req.to ?? accounts.evm, req.amount ?? "0");
      return { display: `~${f.totalFeeEth} ETH (${f.maxFeePerGas})` };
    }
    case "bitcoin": {
      const f = await estimateBtcFee(accounts.bitcoin, req.amount ?? "0");
      return { display: `~${f.estimatedFeeBtc} BTC (${f.feeRate})` };
    }
    case "solana": {
      const f = await estimateSolFee();
      return { display: f.fee };
    }
    case "polkadot": {
      const f = await estimateSubstrateFee("https://rpc.polkadot.io", accounts.polkadot, req.to ?? accounts.polkadot, req.amount ?? "0", 10);
      return { display: `~${f.fee} ${f.symbol}` };
    }
    case "liberland": {
      const f = await estimateSubstrateFee("https://mainnet.liberland.org", accounts.liberland, req.to ?? accounts.liberland, req.amount ?? "0", 12);
      return { display: `~${f.fee} LLD` };
    }
    case "cardano":
      return { display: "~0.17 ADA (network fee)" };
    case "monero":
      return { display: "~0.000016 XMR (typical)" };
    case "tron": {
      const f = await estimateTronFee();
      return { display: f.fee };
    }
    default:
      return { display: "Unknown" };
  }
}

// ─── EVM dApp handler ─────────────────────────────────────────────────────────

async function handleEthRequest(method: string, params: unknown[], origin: string): Promise<unknown> {
  if (!session.unlocked || !session.accounts) throw new Error("Wallet is locked");
  const { ethers } = await import("ethers");
  const wallet = new ethers.Wallet(session.accounts.evmPrivkey);
  switch (method) {
    case "eth_chainId":           return "0x1";
    case "eth_accounts":
      // Only expose the address to sites the user has explicitly connected.
      return connectedOrigins.has(origin) ? [session.accounts.evm] : [];
    case "eth_requestAccounts": {
      if (!connectedOrigins.has(origin)) {
        const ok = await requestApproval({ origin, kind: "connect", chain: "Ethereum" });
        if (!ok) throw new Error("User rejected the connection request");
        connectedOrigins.add(origin);
      }
      return [session.accounts.evm];
    }
    case "personal_sign": {
      const [message] = params as [string];
      let human = message;
      try { human = message.startsWith("0x") ? new TextDecoder().decode(ethers.getBytes(message)) : message; } catch { /* keep raw */ }
      const ok = await requestApproval({ origin, kind: "sign", chain: "Ethereum", message: human });
      if (!ok) throw new Error("User rejected the signature request");
      return wallet.signMessage(message.startsWith("0x") ? ethers.getBytes(message) : message);
    }
    case "eth_sendTransaction":   throw new Error("eth_sendTransaction: use LiberVault send UI");
    default:                      throw new Error(`Unsupported EVM method: ${method}`);
  }
}

// ─── Substrate dApp handler ───────────────────────────────────────────────────

async function handleDotRequest(method: string, _params: unknown[]): Promise<unknown> {
  if (!session.unlocked || !session.accounts) throw new Error("Wallet is locked");
  switch (method) {
    case "dot_accounts":  return [{ address: session.accounts.polkadot, name: "LiberVault" }];
    case "lld_accounts":
    case "llm_accounts":  return [{ address: session.accounts.liberland, name: "LiberVault – Liberland" }];
    default:              throw new Error(`Unsupported Substrate method: ${method}`);
  }
}

// ─── Monero handler ───────────────────────────────────────────────────────────

async function handleXmrRequest(method: string, params: unknown[], origin: string): Promise<unknown> {
  if (!session.unlocked || !session.accounts) throw new Error("Wallet is locked");
  switch (method) {
    case "xmr_getAddress":     return { address: session.accounts.monero };
    case "xmr_getPublicKeys":  return {
      // NOTE: private view key is intentionally NOT exposed to dApps — handing it out
      // lets the recipient see all incoming XMR (breaks Monero privacy). View-key
      // scanning happens only inside the wallet.
      publicSpendKey:  session.accounts.xmrSpendPubkey,
      publicViewKey:   session.accounts.xmrViewPubkey,
    };
    case "xmr_signMessage": {
      const okSig = await requestApproval({ origin, kind: "sign", chain: "Monero", message: String((params as [string])[0] ?? "") });
      if (!okSig) throw new Error("User rejected the signature request");
      const { keccak_256 } = await import("@noble/hashes/sha3");
      const { ed25519 }    = await import("@noble/curves/ed25519");
      const [message]      = params as [string];
      const msgHash        = keccak_256(new TextEncoder().encode(message));
      const spendKeyBE     = Buffer.from(session.accounts.xmrSpendPrivkey, "hex").reverse();
      const sig            = ed25519.sign(msgHash, spendKeyBE);
      return { signature: "0x" + Buffer.from(sig).toString("hex"), publicSpendKey: session.accounts.xmrSpendPubkey };
    }
    case "xmr_sendTransaction": {
      const [to, amount] = params as [string, string];
      const okSend = await requestApproval({ origin, kind: "sign", chain: "Monero", message: `Send ${amount} XMR to ${to}` });
      if (!okSend) throw new Error("User rejected the transaction");
      const { sendXmrTx } = await import("../lib/send");
      return sendXmrTx(
        session.accounts.monero,
        session.accounts.xmrSpendPrivkey,
        session.accounts.xmrViewPrivkey,
        { to, amount }
      );
    }
    default:
      throw new Error(`Unsupported XMR method: ${method}`);
  }
}

// ─── Tron handler ─────────────────────────────────────────────────────────────

async function handleTrxRequest(method: string, params: unknown[], origin: string): Promise<unknown> {
  if (!session.unlocked || !session.accounts) throw new Error("Wallet is locked");
  switch (method) {
    case "trx_getAddress":  return { address: session.accounts.tron };
    case "trx_accounts":    return [session.accounts.tron];
    case "trx_sendTransaction": {
      const [to, amount] = params as [string, string];
      const ok = await requestApproval({ origin, kind: "sign", chain: "Tron", message: `Send ${amount} TRX to ${to}` });
      if (!ok) throw new Error("User rejected the transaction");
      const { sendTronTx } = await import("../lib/send");
      return sendTronTx(session.accounts.tronPrivkey, session.accounts.tron, { to, amount });
    }
    default:
      throw new Error(`Unsupported TRX method: ${method}`);
  }
}
