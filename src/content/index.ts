/**
 * Content Script
 * --------------
 * Runs in ISOLATED world on every page.
 * Injects the inpage provider script into the MAIN world (where dApps live),
 * then bridges messages between it and the background service worker.
 *
 * Data flow:
 *   dApp → window.postMessage → content script → chrome.runtime.sendMessage → background
 *   background → chrome.runtime.onMessage → content script → window.postMessage → dApp
 */

import { MSG } from "../lib/messages";

// ─── Inject inpage provider into MAIN world ────────────────────────────────────

const script = document.createElement("script");
script.src = chrome.runtime.getURL("src/inpage/index.js");
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

// ─── Bridge: inpage → background ──────────────────────────────────────────────

// SECURITY: a web page may ONLY trigger these dApp-facing request types. Privileged
// wallet operations (create/import/unlock/lock, GET_ACCOUNTS, GET_BALANCES, send, fee)
// must never be reachable from a page — otherwise any site could read accounts or drain
// an unlocked wallet with no user approval.
const DAPP_ALLOWED = new Set<string>([MSG.ETH_REQUEST, MSG.SOL_REQUEST, MSG.DOT_REQUEST, MSG.XMR_REQUEST, MSG.TRX_REQUEST]);

window.addEventListener("message", async (event) => {
  // Only handle request messages from our inpage script (ignore our own responses)
  if (event.source !== window) return;
  if (!event.data || event.data.__vault !== true || event.data.__response) return;

  const { type, payload, id } = event.data;

  if (!DAPP_ALLOWED.has(type)) {
    window.postMessage({ __vault: true, __response: true, id, error: "This method is not available to web pages." }, "*");
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({ type, payload });
    window.postMessage(
      { __vault: true, __response: true, id, payload: response.payload, error: response.error },
      "*"
    );
  } catch (err) {
    window.postMessage(
      { __vault: true, __response: true, id, error: (err as Error).message },
      "*"
    );
  }
});

// ─── Bridge: background push events → inpage ──────────────────────────────────
// (Used for accountsChanged, chainChanged events in Phase 2)

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === MSG.ETH_RESPONSE || message.type === MSG.SOL_RESPONSE) {
    window.postMessage({ __vault: true, ...message }, "*");
  }
});
