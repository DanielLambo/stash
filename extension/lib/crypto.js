// Vault crypto. Web Crypto API only — no external libs.
//
// SAFETY GUARANTEES (verified by tests/vault.test.mjs):
//   • The user's master password is never stored — only the derived
//     PBKDF2 output (which is salted, slow, and memory-only).
//   • Every encryption uses a fresh random 12-byte IV. Reusing an IV
//     under the same key would catastrophically break AES-GCM, so we
//     test that two encryptions of the same plaintext produce
//     different IV+ciphertext.
//   • AES-GCM auth tag is enforced — wrong-key decrypt throws (no
//     oracle). Test asserts this.
//   • The plaintext of a vaulted item never lands in chrome.storage:
//     the SW capture handler calls encryptItem() and stores only
//     `{ vaulted:true, iv, ct }`.
//   • The derived raw key is cached in chrome.storage.session, which
//     is in-memory only and cleared on browser exit. It is never
//     written to chrome.storage.local or chrome.storage.sync.
//   • This file does not import or call any network functions and
//     does not log user data.
//
// Key derivation: PBKDF2-SHA256, 600,000 iterations (OWASP 2023 minimum
// for SHA-256). Output: 256-bit AES-GCM key.
//
// Encryption: AES-GCM with random 12-byte IV per message. The 16-byte
// auth tag is appended to the ciphertext by the API automatically.
//
// On-disk persistence (per-vault, in chrome.storage.sync so it follows
// the user across browsers signed into the same Chrome profile):
//   { salt, verifier_iv, verifier_ct, iterations, createdAt }
// where verifier is the encryption of a known constant (`VAULT_OK_v1`).
// We attempt to decrypt the verifier on unlock to confirm the password.
//
// Session unlock cache (chrome.storage.session — in-memory only, cleared
// on browser exit):
//   { rawKey: <base64>, expiresAt: <ms> }
// We re-import the raw bytes into a CryptoKey on each operation. We
// chose raw bytes over CryptoKey export because non-extractable AES keys
// can't be JSON-serialized into chrome.storage.session.

const TEXT = new TextEncoder();
const DECODE = new TextDecoder();

const PBKDF2_ITERATIONS = 600_000;
const VERIFIER_PLAINTEXT = "VAULT_OK_v1";
const SESSION_KEY = "vault_unlock";
const SYNC_KEY = "vault_config";
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ─────────────────────────────────────────────────────────────────
// Pure helpers (Node-testable without chrome.*)
// ─────────────────────────────────────────────────────────────────

export function bytesToBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
export function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKey(password, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    TEXT.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey", "deriveBits"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    /* extractable */ true, // we need to export raw to cache in session storage
    ["encrypt", "decrypt"],
  );
}

async function exportRawKey(cryptoKey) {
  return new Uint8Array(await crypto.subtle.exportKey("raw", cryptoKey));
}
async function importRawKey(rawBytes) {
  return crypto.subtle.importKey("raw", rawBytes, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
}

// Encrypt plaintext (string) with the given AES-GCM key. Returns
// { iv, ct } base64-encoded — both must be stored together.
export async function encryptString(plaintext, cryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctBytes = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, TEXT.encode(plaintext)),
  );
  return { iv: bytesToBase64(iv), ct: bytesToBase64(ctBytes) };
}

export async function decryptString({ iv, ct }, cryptoKey) {
  const ivBytes = base64ToBytes(iv);
  const ctBytes = base64ToBytes(ct);
  const ptBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBytes }, cryptoKey, ctBytes);
  return DECODE.decode(new Uint8Array(ptBuffer));
}

// Pure roundtrip — used by tests. Takes a password + salt + plaintext.
export async function _testRoundtrip(password, plaintext) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const k = await deriveKey(password, salt, 1000); // fast for tests
  const enc = await encryptString(plaintext, k);
  const dec = await decryptString(enc, k);
  return { ok: dec === plaintext, dec };
}

// ─────────────────────────────────────────────────────────────────
// Vault state — wrappers over chrome.storage. Browser-only.
// ─────────────────────────────────────────────────────────────────

async function getVaultConfig() {
  if (typeof chrome === "undefined") return null;
  const { [SYNC_KEY]: cfg } = await chrome.storage.sync.get(SYNC_KEY);
  return cfg || null;
}

async function setVaultConfig(cfg) {
  if (typeof chrome === "undefined") return;
  await chrome.storage.sync.set({ [SYNC_KEY]: cfg });
}

export async function isSetup() {
  const cfg = await getVaultConfig();
  return !!(cfg && cfg.salt && cfg.verifier_ct);
}

// One-time setup. Generates a salt, derives a key, stores a verifier.
// The derived key is automatically cached in session storage.
export async function setupVault(password) {
  if (!password || password.length < 6) throw new Error("Password must be at least 6 characters.");
  if (await isSetup()) throw new Error("Vault is already set up.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cryptoKey = await deriveKey(password, salt);
  const verifier = await encryptString(VERIFIER_PLAINTEXT, cryptoKey);
  await setVaultConfig({
    salt: bytesToBase64(salt),
    verifier_iv: verifier.iv,
    verifier_ct: verifier.ct,
    iterations: PBKDF2_ITERATIONS,
    createdAt: Date.now(),
  });
  await cacheKey(cryptoKey);
  return true;
}

// Verify password and cache derived key in session storage. Returns true
// on success, false on bad password.
export async function unlockVault(password, ttlMs = DEFAULT_TTL_MS) {
  const cfg = await getVaultConfig();
  if (!cfg) return false;
  const salt = base64ToBytes(cfg.salt);
  const iter = cfg.iterations || PBKDF2_ITERATIONS;
  const cryptoKey = await deriveKey(password, salt, iter);
  try {
    const dec = await decryptString({ iv: cfg.verifier_iv, ct: cfg.verifier_ct }, cryptoKey);
    if (dec !== VERIFIER_PLAINTEXT) return false;
    await cacheKey(cryptoKey, ttlMs);
    return true;
  } catch {
    return false;
  }
}

export async function lockVault() {
  if (typeof chrome === "undefined") return;
  await chrome.storage.session.remove(SESSION_KEY);
}

async function cacheKey(cryptoKey, ttlMs = DEFAULT_TTL_MS) {
  if (typeof chrome === "undefined") return;
  const raw = await exportRawKey(cryptoKey);
  await chrome.storage.session.set({
    [SESSION_KEY]: {
      rawKey: bytesToBase64(raw),
      expiresAt: Date.now() + ttlMs,
    },
  });
}

async function getCachedKey() {
  if (typeof chrome === "undefined") return null;
  const { [SESSION_KEY]: c } = await chrome.storage.session.get(SESSION_KEY);
  if (!c || !c.rawKey) return null;
  if (c.expiresAt && c.expiresAt < Date.now()) {
    await chrome.storage.session.remove(SESSION_KEY);
    return null;
  }
  return await importRawKey(base64ToBytes(c.rawKey));
}

export async function isUnlocked() {
  return !!(await getCachedKey());
}

// Encrypt + tag an item for storage. Item shape becomes:
//   { vaulted: true, kind: "text", text: "", iv, ct, vaultMeta: {...} }
// Returns the original item if vault is locked or not configured.
export async function encryptItem(item) {
  const k = await getCachedKey();
  if (!k) return null;
  const enc = await encryptString(item.text || "", k);
  return {
    ...item,
    vaulted: true,
    text: "",
    iv: enc.iv,
    ct: enc.ct,
    vaultMeta: { kind: item.vaultMeta?.kind || "vault", encryptedAt: Date.now() },
  };
}

// Decrypt a vaulted item. Returns the plaintext string. Throws if locked
// or bad ciphertext.
export async function decryptItem(item) {
  if (!item || !item.vaulted) return item?.text || "";
  const k = await getCachedKey();
  if (!k) throw new Error("Vault is locked.");
  return await decryptString({ iv: item.iv, ct: item.ct }, k);
}
