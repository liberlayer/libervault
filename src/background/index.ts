/**
 * Background Service Worker — LiberVault
 * Secure key store + signing + broadcasting.
 * Popup communicates via chrome.runtime.sendMessage.
 */

import { MSG, VaultRequest, VaultResponse, WalletStatus, AccountSet } from "../lib/messages";
import { vaultExists, saveVault, loadVault }    from "../lib/storage";
import { generateMnemonic, validateMnemonic, deriveAllAccounts, DerivedAccounts, waitForCrypto } from "../lib/keyring";
import { fetchAllBalances, AllBalances }         from "../lib/balance";
import { sendEvm, sendBtc, sendSol, sendSubstrate, sendXmrTx, estimateEvmFee, estimateBtcFee, estimateSolFee, estimateSubstrateFee, estimateXmrFeeForSend } from "../lib/send";

interface Session {
  accounts: DerivedAccounts | null;
  unlocked: boolean;
  balances: AllBalances | null;
}

let session: Session = { accounts: null, unlocked: false, balances: null };

waitForCrypto().catch(console.error);

chrome.alarms.create("keepAlive", { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(() => {});

chrome.runtime.onMessage.addListener((msg: VaultRequest, _sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch(err => sendResponse({ type: msg.type, error: (err as Error).message } as VaultResponse));
  return true;
});

function toAccountSet(a: DerivedAccounts): AccountSet {
  return {
    evm: a.evm, bitcoin: a.bitcoin, solana: a.solana,
    polkadot: a.polkadot, liberland: a.liberland, monero: a.monero,
  };
}

async function handleMessage(msg: VaultRequest): Promise<VaultResponse> {
  switch (msg.type) {

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
      return { type: msg.type, payload: await handleEthRequest(method, params) };
    }

    case MSG.DOT_REQUEST: {
      const { method, params } = msg.payload as { method: string; params: unknown[] };
      return { type: msg.type, payload: await handleDotRequest(method, params) };
    }

    case MSG.XMR_REQUEST: {
      const { method, params } = msg.payload as { method: string; params: unknown[] };
      return { type: msg.type, payload: await handleXmrRequest(method, params) };
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
  req: { chain: string; to: string; amount: string; memo?: string; chainId?: number }
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
    case "monero":
      throw new Error("Monero send requires ring signature WASM — coming in Phase 3. Use the Feather or Cake Wallet for XMR sends.");
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
    case "monero":
      return { display: "~0.000016 XMR (typical)" };
    default:
      return { display: "Unknown" };
  }
}

// ─── EVM dApp handler ─────────────────────────────────────────────────────────

async function handleEthRequest(method: string, params: unknown[]): Promise<unknown> {
  if (!session.unlocked || !session.accounts) throw new Error("Wallet is locked");
  const { ethers } = await import("ethers");
  const wallet = new ethers.Wallet(session.accounts.evmPrivkey);
  switch (method) {
    case "eth_accounts":
    case "eth_requestAccounts":   return [session.accounts.evm];
    case "eth_chainId":           return "0x1";
    case "personal_sign": {
      const [message] = params as [string];
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

async function handleXmrRequest(method: string, params: unknown[]): Promise<unknown> {
  if (!session.unlocked || !session.accounts) throw new Error("Wallet is locked");
  switch (method) {
    case "xmr_getAddress":     return { address: session.accounts.monero };
    case "xmr_getPublicKeys":  return {
      publicSpendKey:  session.accounts.xmrSpendPubkey,
      publicViewKey:   session.accounts.xmrViewPubkey,
      privateViewKey:  session.accounts.xmrViewPrivkey,
    };
    case "xmr_signMessage": {
      const { keccak_256 } = await import("@noble/hashes/sha3");
      const { ed25519 }    = await import("@noble/curves/ed25519");
      const [message]      = params as [string];
      const msgHash        = keccak_256(new TextEncoder().encode(message));
      const spendKeyBE     = Buffer.from(session.accounts.xmrSpendPrivkey, "hex").reverse();
      const sig            = ed25519.sign(msgHash, spendKeyBE);
      return { signature: "0x" + Buffer.from(sig).toString("hex"), publicSpendKey: session.accounts.xmrSpendPubkey };
    }
    case "xmr_sendTransaction":
      throw new Error("Monero send requires ring signature WASM — Phase 3");
    default:
      throw new Error(`Unsupported XMR method: ${method}`);
  }
}
