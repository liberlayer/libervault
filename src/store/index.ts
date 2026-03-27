import { create } from "zustand";
import { MSG, AccountSet, WalletStatus } from "../lib/messages";
import { AllBalances } from "../lib/balance";

export type ChainTab = "evm" | "bitcoin" | "solana" | "polkadot" | "liberland" | "monero";
export type ModalView = null | "send" | "receive";
type View = "loading" | "welcome" | "create" | "import" | "reveal-mnemonic" | "dashboard" | "lock";

interface VaultStore {
  view:        View;
  setView:     (v: View) => void;
  status:      WalletStatus;
  accounts:    AccountSet | null;
  mnemonic:    string | null;
  activeTab:   ChainTab;
  setTab:      (t: ChainTab) => void;
  modal:       ModalView;
  setModal:    (m: ModalView) => void;
  error:       string | null;
  loading:     boolean;
  balances:    AllBalances | null;
  balanceLoading: boolean;
  lastTxHash:  string | null;
  lastTxExplorer: string | null;

  init:          () => Promise<void>;
  createWallet:  (password: string) => Promise<void>;
  importWallet:  (mnemonic: string, password: string) => Promise<void>;
  unlock:        (password: string) => Promise<void>;
  lock:          () => Promise<void>;
  clearMnemonic: () => void;
  clearError:    () => void;
  fetchBalances: () => Promise<void>;
  sendTx: (chain: string, to: string, amount: string, memo?: string, chainId?: number) => Promise<void>;
  estimateFee: (chain: string, to?: string, amount?: string) => Promise<string>;
}

async function sendMsg<T>(type: string, payload?: unknown): Promise<T> {
  const r = await chrome.runtime.sendMessage({ type, payload });
  if (r?.error) throw new Error(r.error);
  return r?.payload as T;
}

export const useVault = create<VaultStore>((set, get) => ({
  view: "loading", status: { initialized: false, unlocked: false },
  accounts: null, mnemonic: null, activeTab: "evm", modal: null,
  error: null, loading: false, balances: null, balanceLoading: false,
  lastTxHash: null, lastTxExplorer: null,

  setView:       (view)  => set({ view }),
  setTab:        (t)     => set({ activeTab: t }),
  setModal:      (m)     => set({ modal: m, error: null }),
  clearError:    ()      => set({ error: null }),
  clearMnemonic: ()      => set({ mnemonic: null }),

  init: async () => {
    try {
      const status = await sendMsg<WalletStatus>(MSG.WALLET_STATUS);
      if (!status.initialized) set({ status, view: "welcome" });
      else if (status.unlocked) {
        const accounts = await sendMsg<AccountSet>(MSG.GET_ACCOUNTS);
        set({ status, accounts, view: "dashboard" });
        get().fetchBalances();
      } else set({ status, view: "lock" });
    } catch (e) { set({ view: "welcome", error: (e as Error).message }); }
  },

  createWallet: async (password) => {
    set({ loading: true, error: null });
    try {
      const r = await sendMsg<{ mnemonic: string; accounts: AccountSet }>(MSG.WALLET_CREATE, { password });
      set({ accounts: r.accounts, mnemonic: r.mnemonic, status: { initialized: true, unlocked: true }, view: "reveal-mnemonic", loading: false });
    } catch (e) { set({ error: (e as Error).message, loading: false }); }
  },

  importWallet: async (mnemonic, password) => {
    set({ loading: true, error: null });
    try {
      const r = await sendMsg<{ accounts: AccountSet }>(MSG.WALLET_IMPORT, { mnemonic, password });
      set({ accounts: r.accounts, status: { initialized: true, unlocked: true }, view: "dashboard", loading: false });
      get().fetchBalances();
    } catch (e) { set({ error: (e as Error).message, loading: false }); }
  },

  unlock: async (password) => {
    set({ loading: true, error: null });
    try {
      const r = await sendMsg<{ accounts: AccountSet }>(MSG.WALLET_UNLOCK, { password });
      set({ accounts: r.accounts, status: { initialized: true, unlocked: true }, view: "dashboard", loading: false });
      get().fetchBalances();
    } catch (e) { set({ error: (e as Error).message, loading: false }); }
  },

  lock: async () => {
    await sendMsg(MSG.WALLET_LOCK);
    set({ accounts: null, mnemonic: null, balances: null, status: { initialized: true, unlocked: false }, view: "lock" });
  },

  fetchBalances: async () => {
    set({ balanceLoading: true });
    try {
      const balances = await sendMsg<AllBalances>(MSG.GET_BALANCES);
      set({ balances, balanceLoading: false });
    } catch { set({ balanceLoading: false }); }
  },

  sendTx: async (chain, to, amount, memo, chainId) => {
    set({ loading: true, error: null, lastTxHash: null, lastTxExplorer: null });
    try {
      const r = await sendMsg<{ txHash: string; explorer: string }>(
        "VAULT_SEND_TX" as any, { chain, to, amount, memo, chainId }
      );
      set({ loading: false, lastTxHash: r.txHash, lastTxExplorer: r.explorer, modal: null });
      get().fetchBalances();
    } catch (e) { set({ error: (e as Error).message, loading: false }); }
  },

  estimateFee: async (chain, to, amount) => {
    try {
      const r = await sendMsg<{ display: string }>("VAULT_ESTIMATE_FEE" as any, { chain, to, amount });
      return r.display;
    } catch { return "Estimating…"; }
  },
}));
