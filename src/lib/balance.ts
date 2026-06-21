/**
 * Balance Fetching — LiberVault
 * Each chain uses its own API/RPC. All calls return a human-readable
 * decimal string (e.g. "1.234567") plus the raw value in the chain's
 * smallest unit (bigint string).
 */

export interface BalanceResult {
  formatted:  string;   // human-readable with symbol, e.g. "1.2345 ETH"
  raw:        string;   // smallest unit as string, e.g. "1234500000000000000"
  symbol:     string;
  usd?:       string;   // optional fiat value
  error?:     string;
}

// ─── EVM ──────────────────────────────────────────────────────────────────────

export async function fetchEvmBalance(
  address: string,
  rpcUrl: string,
  symbol: string
): Promise<BalanceResult> {
  try {
    const { ethers } = await import("ethers");
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const raw      = await provider.getBalance(address);
    const formatted = parseFloat(ethers.formatEther(raw)).toFixed(6);
    return { formatted: `${formatted} ${symbol}`, raw: raw.toString(), symbol };
  } catch (e) {
    return { formatted: "0.000000", raw: "0", symbol, error: (e as Error).message };
  }
}

// ─── Bitcoin ──────────────────────────────────────────────────────────────────

export async function fetchBtcBalance(address: string): Promise<BalanceResult> {
  try {
    const r = await fetch(`https://blockstream.info/api/address/${address}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    // funded_txo_sum - spent_txo_sum = balance in satoshis
    const satoshis = BigInt(data.chain_stats.funded_txo_sum) -
                     BigInt(data.chain_stats.spent_txo_sum);
    const btc = Number(satoshis) / 1e8;
    return {
      formatted: `${btc.toFixed(8)} BTC`,
      raw:       satoshis.toString(),
      symbol:    "BTC",
    };
  } catch (e) {
    return { formatted: "0.00000000 BTC", raw: "0", symbol: "BTC", error: (e as Error).message };
  }
}

// ─── Solana ───────────────────────────────────────────────────────────────────

export async function fetchSolBalance(address: string): Promise<BalanceResult> {
  try {
    const { Connection, PublicKey, LAMPORTS_PER_SOL } = await import("@solana/web3.js");
    const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
    const pubkey = new PublicKey(address);
    const lamports = await conn.getBalance(pubkey);
    const sol = (lamports / LAMPORTS_PER_SOL).toFixed(6);
    return { formatted: `${sol} SOL`, raw: lamports.toString(), symbol: "SOL" };
  } catch (e) {
    return { formatted: "0.000000 SOL", raw: "0", symbol: "SOL", error: (e as Error).message };
  }
}

// ─── Substrate (Polkadot / Liberland) ─────────────────────────────────────────

export async function fetchSubstrateBalance(
  address: string,
  rpcUrl: string,
  symbol: string,
  decimals = 10
): Promise<BalanceResult> {
  try {
    // Use HTTP JSON-RPC directly — avoids @polkadot/api WebSocket overhead
    // system_account returns the AccountInfo struct which includes free balance
    const { ApiPromise, HttpProvider } = await import("@polkadot/api");

    // Convert WSS to HTTPS for MV3 service worker compatibility
    const httpUrl = rpcUrl.replace("wss://", "https://").replace("ws://", "http://");
    const provider = new HttpProvider(httpUrl);
    const api      = await ApiPromise.create({ provider, noInitWarn: true });

    const account: any = await api.query.system.account(address);
    const free  = BigInt(account.data.free.toString());
    const divisor = BigInt(10 ** decimals);
    const whole = free / divisor;
    const frac  = free % divisor;
    const formatted = `${whole}.${frac.toString().padStart(decimals, "0").slice(0, 4)} ${symbol}`;

    await api.disconnect();
    return { formatted, raw: free.toString(), symbol };
  } catch (e) {
    return { formatted: `0.0000 ${symbol}`, raw: "0", symbol, error: (e as Error).message };
  }
}

// ─── Monero (view-key scan via remote node) ────────────────────────────────────
// NOTE: This shares your private VIEW KEY with the remote node.
// Use your own node for maximum privacy. The view key cannot spend funds.

export async function fetchXmrBalance(
  address: string,
  privateViewKey: string,
  publicSpendKey: string
): Promise<BalanceResult> {
  try {
    // Use the Monero daemon's open RPC to get_address_txs
    // This is compatible with MyMonero's open API format
    const res = await fetch("https://xmr.node.community:18089/json_rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: "0", method: "get_address_txs",
        params: { address, view_key: privateViewKey },
      }),
    });

    if (!res.ok) throw new Error(`Node returned ${res.status}`);
    const data = await res.json();

    if (data.error) throw new Error(data.error.message);

    const totalReceived = BigInt(data.result?.total_received ?? 0);
    const totalSent     = BigInt(data.result?.total_sent ?? 0);
    const balance       = totalReceived - totalSent;
    const xmr           = Number(balance) / 1e12; // Monero has 12 decimal places

    return {
      formatted: `${xmr.toFixed(6)} XMR`,
      raw:       balance.toString(),
      symbol:    "XMR",
    };
  } catch (e) {
    // Fallback: show balance as unknown — scanning needs a node
    return {
      formatted: "Scan required",
      raw:       "0",
      symbol:    "XMR",
      error:     (e as Error).message,
    };
  }
}

// ─── Unified fetcher ──────────────────────────────────────────────────────────

// Koios is a keyless REST API (no CSL/WASM) — inlined here so the heavy
// cardano-serialization-lib (WASM, top-level await) stays out of this graph
// and only loads inside the background service worker.
export async function fetchCardanoBalance(address: string): Promise<BalanceResult> {
  try {
    const res = await fetch("https://api.koios.rest/api/v1/address_info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _addresses: [address] }),
    });
    if (!res.ok) throw new Error(`Koios ${res.status}`);
    const data = await res.json();
    const lovelace = (Array.isArray(data) && data[0]?.balance) ? String(data[0].balance) : "0";
    return { formatted: `${(Number(lovelace) / 1e6).toFixed(6)} ADA`, raw: lovelace, symbol: "ADA" };
  } catch (e) {
    return { formatted: "0.000000 ADA", raw: "0", symbol: "ADA", error: (e as Error).message };
  }
}

export interface AllBalances {
  evm:       BalanceResult;
  bitcoin:   BalanceResult;
  solana:    BalanceResult;
  polkadot:  BalanceResult;
  liberland: BalanceResult;
  monero:    BalanceResult;
  cardano:   BalanceResult;
}

export async function fetchAllBalances(
  accounts: {
    evm: string; bitcoin: string; solana: string;
    polkadot: string; liberland: string; monero: string; cardano: string;
  },
  xmrKeys?: { privateViewKey: string; publicSpendKey: string }
): Promise<AllBalances> {
  const [evm, bitcoin, solana, polkadot, liberland, monero, cardano] = await Promise.allSettled([
    fetchEvmBalance(accounts.evm, "https://cloudflare-eth.com", "ETH"),
    fetchBtcBalance(accounts.bitcoin),
    fetchSolBalance(accounts.solana),
    fetchSubstrateBalance(accounts.polkadot, "https://rpc.polkadot.io", "DOT", 10),
    fetchSubstrateBalance(accounts.liberland, "https://mainnet.liberland.org", "LLD", 12),
    xmrKeys
      ? fetchXmrBalance(accounts.monero, xmrKeys.privateViewKey, xmrKeys.publicSpendKey)
      : Promise.resolve({ formatted: "Connect node", raw: "0", symbol: "XMR" }),
    fetchCardanoBalance(accounts.cardano),
  ]);

  const unwrap = (r: PromiseSettledResult<BalanceResult>, sym: string): BalanceResult =>
    r.status === "fulfilled" ? r.value : { formatted: `0 ${sym}`, raw: "0", symbol: sym, error: String(r.reason) };

  return {
    evm:       unwrap(evm, "ETH"),
    bitcoin:   unwrap(bitcoin, "BTC"),
    solana:    unwrap(solana, "SOL"),
    polkadot:  unwrap(polkadot, "DOT"),
    liberland: unwrap(liberland, "LLD"),
    monero:    unwrap(monero, "XMR"),
    cardano:   unwrap(cardano, "ADA"),
  };
}
