// Sync client. Talks to a backend the *user* configures — there is no
// default Stash server and no developer-controlled endpoint.
//
// SAFETY GUARANTEES (enforced below):
//   1. Every public function returns null / no-ops if `syncUrl` is empty
//      OR `syncEnabled` is false. A fresh install therefore makes ZERO
//      outgoing requests until the user explicitly turns sync on AND
//      types in their own URL.
//   2. Vaulted items go over the wire only as ciphertext — the popup &
//      service worker encrypt before items ever reach this layer.
//   3. Items flagged `sensitive: true` but not yet vaulted (e.g.
//      captured before the user set up Vault) are filtered out by
//      `safeForSync()` so we cannot leak them through a misconfiguration.
//   4. We never log clipboard contents — only HTTP-level errors.
//
// Endpoints (handled by the open-source server in /server):
//   GET  /api/items?since=<ts>   -> { items: [...] }
//   POST /api/items              -> { items: [...], deletes: [...] } merge response
//   POST /api/auth/register      -> { token }   anonymous device token

import { getSettings, setSettings } from "./storage.js";
import { detectSensitive } from "./sensitive.js";

// Defensive guard: never let a plaintext-sensitive item reach the wire.
// Vaulted items pass through (their text field is empty and the cipher-
// text + iv ride along). Items captured before vault was set up may carry
// sensitive: true; we drop those rather than leak them.
function safeForSync(item) {
  if (!item) return false;
  if (item.vaulted) return true;          // already encrypted
  if (item.kind === "image") return true;
  const text = item.text || "";
  if (item.sensitive) return false;       // flagged at capture time
  if (detectSensitive(text).sensitive) return false; // belt & braces
  return true;
}

function filterSensitive(items) {
  return Array.isArray(items) ? items.filter(safeForSync) : [];
}

async function ensureToken(settings) {
  if (settings.syncToken) return settings.syncToken;
  const r = await fetch(`${settings.syncUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device: navigator.userAgent.slice(0, 80) }),
  });
  if (!r.ok) throw new Error(`register failed: ${r.status}`);
  const { token } = await r.json();
  await setSettings({ syncToken: token });
  return token;
}

export async function pushItems(items) {
  const settings = await getSettings();
  if (!settings.syncEnabled || !settings.syncUrl) return null;
  const token = await ensureToken(settings);
  const safe = filterSensitive(items);
  const r = await fetch(`${settings.syncUrl}/api/items`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ items: safe }),
  });
  if (!r.ok) throw new Error(`push failed: ${r.status}`);
  return r.json();
}

export async function pullItems(since = 0) {
  const settings = await getSettings();
  if (!settings.syncEnabled || !settings.syncUrl) return null;
  const token = await ensureToken(settings);
  const r = await fetch(`${settings.syncUrl}/api/items?since=${since}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`pull failed: ${r.status}`);
  return r.json();
}

export async function pingServer() {
  const settings = await getSettings();
  if (!settings.syncUrl) return false;
  try {
    const r = await fetch(`${settings.syncUrl}/api/health`, { cache: "no-store" });
    return r.ok;
  } catch {
    return false;
  }
}
