// ─── Message Types ────────────────────────────────────────────────────────────

export const MSG = {
  WALLET_CREATE:   "VAULT_WALLET_CREATE",
  WALLET_IMPORT:   "VAULT_WALLET_IMPORT",
  WALLET_UNLOCK:   "VAULT_WALLET_UNLOCK",
  WALLET_LOCK:     "VAULT_WALLET_LOCK",
  WALLET_STATUS:   "VAULT_WALLET_STATUS",
  GET_ACCOUNTS:    "VAULT_GET_ACCOUNTS",
  GET_BALANCES:    "VAULT_GET_BALANCES",
  ETH_REQUEST:     "VAULT_ETH_REQUEST",
  ETH_RESPONSE:    "VAULT_ETH_RESPONSE",
  SOL_REQUEST:     "VAULT_SOL_REQUEST",
  SOL_RESPONSE:    "VAULT_SOL_RESPONSE",
  DOT_REQUEST:     "VAULT_DOT_REQUEST",
  DOT_RESPONSE:    "VAULT_DOT_RESPONSE",
  XMR_REQUEST:     "VAULT_XMR_REQUEST",
  XMR_RESPONSE:    "VAULT_XMR_RESPONSE",
  TX_APPROVE:      "VAULT_TX_APPROVE",
  TX_REJECT:       "VAULT_TX_REJECT",
  INPAGE_REQUEST:  "VAULT_INPAGE_REQUEST",
  INPAGE_RESPONSE: "VAULT_INPAGE_RESPONSE",
} as const;

export type MsgKey = (typeof MSG)[keyof typeof MSG];

// ─── Chain Registry ────────────────────────────────────────────────────────────

export const CHAINS = {
  ethereum:  { id: 1,     name: "Ethereum",    symbol: "ETH",   rpc: "https://cloudflare-eth.com",             family: "evm",       ss58Prefix: undefined },
  polygon:   { id: 137,   name: "Polygon",     symbol: "MATIC", rpc: "https://polygon-rpc.com",                family: "evm",       ss58Prefix: undefined },
  bsc:       { id: 56,    name: "BNB Chain",   symbol: "BNB",   rpc: "https://bsc-dataseed.binance.org",       family: "evm",       ss58Prefix: undefined },
  arbitrum:  { id: 42161, name: "Arbitrum",    symbol: "ETH",   rpc: "https://arb1.arbitrum.io/rpc",           family: "evm",       ss58Prefix: undefined },
  base:      { id: 8453,  name: "Base",        symbol: "ETH",   rpc: "https://mainnet.base.org",               family: "evm",       ss58Prefix: undefined },
  bitcoin:   { id: 0,     name: "Bitcoin",     symbol: "BTC",   rpc: "",                                       family: "utxo",      ss58Prefix: undefined },
  solana:    { id: -1,    name: "Solana",      symbol: "SOL",   rpc: "https://api.mainnet-beta.solana.com",    family: "solana",    ss58Prefix: undefined },
  polkadot:  { id: -2,    name: "Polkadot",    symbol: "DOT",   rpc: "wss://rpc.polkadot.io",                 family: "substrate", ss58Prefix: 0  },
  kusama:    { id: -3,    name: "Kusama",      symbol: "KSM",   rpc: "wss://kusama-rpc.polkadot.io",          family: "substrate", ss58Prefix: 2  },
  liberland: { id: -4,    name: "Liberland",   symbol: "LLD",   rpc: "wss://mainnet.liberland.org",           family: "substrate", ss58Prefix: 56 },
  monero:    { id: -5,    name: "Monero",      symbol: "XMR",   rpc: "https://xmr.node.community:18089",      family: "monero",    ss58Prefix: undefined },
} as const;

export type ChainKey = keyof typeof CHAINS;
export type ChainFamily = "evm" | "utxo" | "solana" | "substrate" | "monero";

// ─── Wallet Types ──────────────────────────────────────────────────────────────

export interface WalletStatus {
  initialized: boolean;
  unlocked:    boolean;
}

export interface AccountSet {
  evm:       string; // 0x checksum
  bitcoin:   string; // bc1 bech32
  solana:    string; // base58
  polkadot:  string; // SS58 prefix 0
  liberland: string; // SS58 prefix 56 (LLD + LLM share same address)
  monero:    string; // Monero base58 mainnet address (0x12 prefix)
}

/** Monero has two keypairs — callers needing the view key for scanning get this */
export interface MoneroAccount {
  address:          string;
  publicSpendKey:   string; // hex
  publicViewKey:    string; // hex
  privateViewKey:   string; // hex — needed for wallet scanning (NOT the spend key)
}

export interface VaultRequest<T = unknown> {
  type:     MsgKey;
  payload?: T;
  id?:      string;
}

export interface VaultResponse<T = unknown> {
  type:     MsgKey;
  payload?: T;
  error?:   string;
  id?:      string;
}

// ─── Extended message types for send/receive ───────────────────────────────────

export interface SendRequest {
  chain:   string;   // "evm" | "bitcoin" | "solana" | "polkadot" | "liberland"
  to:      string;
  amount:  string;
  memo?:   string;
  chainId?: number;  // EVM only
}

export interface FeeRequest {
  chain:   string;
  from:    string;
  to?:     string;
  amount?: string;
}

export interface FeeResult {
  display: string; // human-readable e.g. "~0.0001 ETH"
  raw?:    string;
}
