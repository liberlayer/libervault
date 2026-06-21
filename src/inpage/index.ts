/**
 * Inpage Provider
 * ---------------
 * Runs in the MAIN world of every web page.
 * Provides window.ethereum (EIP-1193 + EIP-6963) and window.solana (Phantom-compatible).
 * Communicates with the content script via window.postMessage.
 *
 * This file is bundled separately and loaded as a web_accessible_resource.
 */

// ─── Message Bridge ────────────────────────────────────────────────────────────

let requestCounter = 0;
const pendingRequests = new Map<string, { resolve: Function; reject: Function }>();

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (!event.data?.__vault || !event.data?.__response) return;

  const { id, payload, error } = event.data;
  const pending = pendingRequests.get(id);
  if (!pending) return;

  pendingRequests.delete(id);
  if (error) {
    pending.reject(new Error(error));
  } else {
    pending.resolve(payload);
  }
});

function sendToBackground(type: string, payload?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = `vault_${++requestCounter}_${Date.now()}`;
    pendingRequests.set(id, { resolve, reject });
    window.postMessage({ __vault: true, type, payload, id }, "*");
    // Timeout after 30s
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error("Request timeout"));
      }
    }, 30_000);
  });
}

// ─── EIP-1193 Ethereum Provider ────────────────────────────────────────────────

class VaultEthereumProvider extends EventTarget {
  public readonly isVault = true;
  public readonly isMetaMask = false; // Don't impersonate MetaMask
  public chainId = "0x1";
  public selectedAddress: string | null = null;

  async request({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> {
    const result = await sendToBackground("VAULT_ETH_REQUEST", { method, params: params ?? [] });
    return result;
  }

  // Legacy methods for older dApp compatibility
  send(method: string, params?: unknown[]): Promise<unknown> {
    return this.request({ method, params });
  }

  sendAsync(
    payload: { method: string; params?: unknown[]; id: number },
    callback: (error: Error | null, result?: unknown) => void
  ): void {
    this.request(payload)
      .then((result) => callback(null, { id: payload.id, jsonrpc: "2.0", result }))
      .catch((error) => callback(error));
  }

  // EIP-6963: Multi-wallet discovery
  announceProvider() {
    const info = {
      uuid:  "b1e7c4a2-9f3d-4c6e-8a1b-2d5f7e9c0a3b",
      name:  "LiberVault",
      icon:  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OCA0OCI+CiAgPHJlY3Qgd2lkdGg9IjQ4IiBoZWlnaHQ9IjQ4IiByeD0iMTEiIGZpbGw9IiMwZTBmMTMiLz4KICA8cGF0aCBkPSJNMjQgNy41bDEzIDUuMnY5LjNjMCA4LjQtNS4zIDE0LjItMTMgMTYuOC03LjctMi42LTEzLTguNC0xMy0xNi44di05LjN6IiBmaWxsPSIjZDIzYTYzIiBmaWxsLW9wYWNpdHk9IjAuMTUiIHN0cm9rZT0iI2UwNDc2ZSIgc3Ryb2tlLXdpZHRoPSIyLjQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KICA8Y2lyY2xlIGN4PSIyNCIgY3k9IjIxLjUiIHI9IjMuMiIgZmlsbD0iI2UwNDc2ZSIvPgogIDxyZWN0IHg9IjIyLjYiIHk9IjIzIiB3aWR0aD0iMi44IiBoZWlnaHQ9IjcuNSIgcng9IjEuNCIgZmlsbD0iI2UwNDc2ZSIvPgo8L3N2Zz4K",
      rdns:  "com.libervault",
    };
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({ info, provider: this }),
      })
    );
  }
}

// ─── Solana Provider (Phantom-compatible) ──────────────────────────────────────

class VaultSolanaProvider extends EventTarget {
  public readonly isVault  = true;
  public readonly isPhantom = false;
  public publicKey: { toBase58(): string } | null = null;
  public isConnected = false;

  async connect(): Promise<{ publicKey: { toBase58(): string } }> {
    const result = await sendToBackground("VAULT_ETH_REQUEST", {
      method: "sol_connect",
      params: [],
    }) as { solana: string };

    this.publicKey = { toBase58: () => result.solana };
    this.isConnected = true;
    this.dispatchEvent(new CustomEvent("connect", { detail: { publicKey: this.publicKey } }));
    return { publicKey: this.publicKey };
  }

  async disconnect(): Promise<void> {
    this.publicKey  = null;
    this.isConnected = false;
    this.dispatchEvent(new CustomEvent("disconnect"));
  }

  async signMessage(message: Uint8Array): Promise<{ signature: Uint8Array }> {
    const result = await sendToBackground("VAULT_SOL_REQUEST", {
      method: "signMessage",
      params: [Array.from(message)],
    }) as { signature: number[] };
    return { signature: new Uint8Array(result.signature) };
  }
}

// ─── Register Providers ────────────────────────────────────────────────────────

const ethereumProvider = new VaultEthereumProvider();
const solanaProvider   = new VaultSolanaProvider();

// EIP-1193: window.ethereum
Object.defineProperty(window, "ethereum", {
  value:      ethereumProvider,
  writable:   false,
  configurable: false,
});

// Solana: window.solana
Object.defineProperty(window, "solana", {
  value:      solanaProvider,
  writable:   false,
  configurable: false,
});

// EIP-6963: Respond to provider discovery requests
window.addEventListener("eip6963:requestProvider", () => {
  ethereumProvider.announceProvider();
});

// Announce immediately on load
ethereumProvider.announceProvider();

console.log("[LiberVault] Providers injected: window.ethereum, window.solana");
