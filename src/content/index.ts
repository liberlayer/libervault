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

window.addEventListener("message", async (event) => {
  // Only handle messages from our inpage script
  if (event.source !== window) return;
  if (!event.data || event.data.__vault !== true) return;

  const { type, payload, id } = event.data;

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
