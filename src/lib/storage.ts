/**
 * Encrypted Storage
 * -----------------
 * All sensitive data is encrypted with AES-GCM before hitting chrome.storage.local.
 * The encryption key is derived from the user's password via PBKDF2 (SHA-256, 600k iterations).
 * The raw password and derived key are NEVER persisted — only the encrypted vault blob.
 */

const STORAGE_KEY  = "vault_encrypted";
const SALT_KEY     = "vault_salt";
const PBKDF2_ITERS = 600_000; // OWASP 2023 recommendation for PBKDF2-SHA256

export interface VaultBlob {
  mnemonic:  string;
  accounts?: Record<string, string>; // future: named accounts
}

// ─── Key Derivation ────────────────────────────────────────────────────────────

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

// ─── Chrome Storage Helpers ────────────────────────────────────────────────────

async function storageGet(key: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => resolve(result[key]));
  });
}

async function storageSet(key: string, value: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

// ─── Public API ────────────────────────────────────────────────────────────────

/** Returns true if an encrypted vault already exists in storage. */
export async function vaultExists(): Promise<boolean> {
  const blob = await storageGet(STORAGE_KEY);
  return !!blob;
}

/**
 * Encrypt and persist the vault blob.
 * Called once on wallet creation, or when user changes password.
 */
export async function saveVault(data: VaultBlob, password: string): Promise<void> {
  const salt = randomBytes(32);
  const iv   = randomBytes(12);
  const key  = await deriveKey(password, salt);

  const plaintext  = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);

  // Pack: salt(32) + iv(12) + ciphertext
  const packed = new Uint8Array(32 + 12 + ciphertext.byteLength);
  packed.set(salt, 0);
  packed.set(iv, 32);
  packed.set(new Uint8Array(ciphertext), 44);

  const encoded = btoa(String.fromCharCode(...packed));
  await storageSet(STORAGE_KEY, encoded);
}

/**
 * Decrypt and return the vault blob using the user's password.
 * Throws if the password is wrong (AES-GCM authentication will fail).
 */
export async function loadVault(password: string): Promise<VaultBlob> {
  const encoded = await storageGet(STORAGE_KEY);
  if (!encoded) throw new Error("No vault found");

  const packed = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const salt   = packed.slice(0, 32);
  const iv     = packed.slice(32, 44);
  const cipher = packed.slice(44);

  const key = await deriveKey(password, salt);

  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  } catch {
    throw new Error("Incorrect password");
  }

  return JSON.parse(new TextDecoder().decode(plain)) as VaultBlob;
}

/** Wipe all vault data from storage. Irreversible without the mnemonic. */
export async function clearVault(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove([STORAGE_KEY, SALT_KEY], resolve);
  });
}
