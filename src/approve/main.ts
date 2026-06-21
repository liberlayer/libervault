/**
 * Approval popup — LiberVault
 * Shown (in its own window) when a dApp requests connect/sign. Reads the pending
 * request from the background worker, lets the user Approve/Reject, and reports back.
 * Closing the window counts as a rejection (background also auto-rejects after 2 min).
 */
import { MSG } from "../lib/messages";

const id = new URLSearchParams(location.search).get("id") || "";
const $ = (s: string) => document.querySelector(s) as HTMLElement;
let decided = false;

async function load() {
  const r = await chrome.runtime.sendMessage({ type: MSG.GET_PENDING_APPROVAL, payload: { id } });
  const d = r?.payload as { origin: string; kind: "connect" | "sign"; chain?: string; message?: string } | null;

  if (!d) {
    $("#title").textContent = "Request expired";
    $("#body").textContent = "This request is no longer pending. You can close this window.";
    (document.querySelector("#approve") as HTMLButtonElement).disabled = true;
    return;
  }

  $("#title").textContent = d.kind === "connect" ? "Connection request" : "Signature request";
  $("#origin").textContent = d.origin;
  $("#verb").textContent = d.kind === "connect"
    ? "connect to your wallet and view your address"
    : "sign a message with your key";

  if (d.chain) $("#chain").textContent = d.chain;
  else $("#chainwrap").style.display = "none";

  if (d.kind === "sign" && d.message) {
    $("#msgwrap").style.display = "block";
    $("#msg").textContent = d.message;
  }
}

async function respond(approve: boolean) {
  decided = true;
  await chrome.runtime.sendMessage({ type: approve ? MSG.TX_APPROVE : MSG.TX_REJECT, payload: { id } }).catch(() => {});
  window.close();
}

$("#approve").addEventListener("click", () => respond(true));
$("#reject").addEventListener("click", () => respond(false));
// Closing the window without choosing = reject.
window.addEventListener("beforeunload", () => {
  if (!decided) chrome.runtime.sendMessage({ type: MSG.TX_REJECT, payload: { id } }).catch(() => {});
});

load();
