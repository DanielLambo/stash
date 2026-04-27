// Storage layer: chrome.storage.local for clipboard items, chrome.storage.sync for settings.
// Item shape: { id, kind: "text"|"image", text?, dataUrl?, width?, height?, ts, pinned, source }

export const DEFAULT_SETTINGS = {
  maxItems: 5,
  theme: "auto",                     // auto | light | dark
  enabled: true,
  syncEnabled: false,
  // Empty by default — Stash never has a default cloud destination. Sync
  // stays inert until the user types in their own server URL.
  syncUrl: "",
  syncToken: "",
  blocklist: [],                     // hostnames to skip on capture
  capturePages: true,
  captureImages: true,
  showNotifications: false,
  // Off by default. Snippet expansion is opt-in to keep the install
  // experience minimal: no input listening on web pages until the user
  // explicitly enables it from the options page.
  snippetsEnabled: false,
  // Auto-vault is on by default *behaviorally* (the detector still runs),
  // but no encryption happens until the user sets a master password.
  autoVault: true,
};

export const STORAGE_KEYS = {
  ITEMS: "clipboard_items",
  SETTINGS: "clipboard_settings",
  LAST_SYNC: "clipboard_last_sync",
  SNIPPETS: "clipboard_snippets",
};

export async function getSettings() {
  const { [STORAGE_KEYS.SETTINGS]: s } = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(s || {}) };
}

export async function setSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: next });
  return next;
}

export async function getItems() {
  const { [STORAGE_KEYS.ITEMS]: items } = await chrome.storage.local.get(STORAGE_KEYS.ITEMS);
  return Array.isArray(items) ? items : [];
}

export async function setItems(items) {
  await chrome.storage.local.set({ [STORAGE_KEYS.ITEMS]: items });
}

export function makeId() {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Hard ceiling for stored image data URLs (~5 MB of base64 ≈ 3.7 MB binary).
// Generous for typical screenshots; protects chrome.storage from runaway
// accumulation even with the unlimitedStorage permission.
export const MAX_IMAGE_DATA_URL_BYTES = 5 * 1024 * 1024;

// Add an item, deduping against the most recent and capping at maxItems (pinned preserved).
export async function addItem(item) {
  const settings = await getSettings();
  if (!settings.enabled) return null;
  if (item?.kind === "image" && (item.dataUrl || "").length > MAX_IMAGE_DATA_URL_BYTES) {
    return null;
  }

  const items = await getItems();
  const incoming = {
    id: item.id || makeId(),
    kind: item.kind || "text",
    text: item.text || "",
    dataUrl: item.dataUrl || "",
    width: item.width || 0,
    height: item.height || 0,
    ts: item.ts || Date.now(),
    pinned: !!item.pinned,
    source: item.source || "",
    // Vault / sensitive flags propagate through addItem unchanged.
    vaulted: !!item.vaulted,
    iv: item.iv || "",
    ct: item.ct || "",
    vaultMeta: item.vaultMeta || null,
    sensitive: !!item.sensitive,
    sensitiveKind: item.sensitiveKind || "",
  };

  // Dedup: skip for vaulted items since each encryption has a unique IV /
  // ciphertext by design. Plaintext items dedup as before.
  const idx = incoming.vaulted ? -1 : items.findIndex(i =>
    !i.vaulted && i.kind === incoming.kind &&
    (incoming.kind === "image"
      ? i.dataUrl === incoming.dataUrl
      : (i.text || "").trim() === (incoming.text || "").trim() && incoming.text.trim().length > 0)
  );
  if (idx >= 0) {
    const existing = items.splice(idx, 1)[0];
    existing.ts = incoming.ts;
    existing.source = incoming.source || existing.source;
    items.unshift(existing);
    await setItems(items);
    return existing;
  }

  if (incoming.kind === "text" && !incoming.text.trim()) return null;
  if (incoming.kind === "image" && !incoming.dataUrl) return null;

  items.unshift(incoming);

  // Trim, but always keep pinned items
  const pinned = items.filter(i => i.pinned);
  const unpinned = items.filter(i => !i.pinned);
  const trimmed = unpinned.slice(0, settings.maxItems);
  // Preserve order: most-recent first, then re-merge (pinned stay where they were)
  const merged = items.filter(i => i.pinned || trimmed.includes(i));
  await setItems(merged);
  return incoming;
}

export async function removeItem(id) {
  const items = await getItems();
  const next = items.filter(i => i.id !== id);
  await setItems(next);
}

export async function togglePin(id) {
  const items = await getItems();
  const next = items.map(i => (i.id === id ? { ...i, pinned: !i.pinned } : i));
  await setItems(next);
}

export async function updateItem(id, patch) {
  const items = await getItems();
  const next = items.map(i => (i.id === id ? { ...i, ...patch } : i));
  await setItems(next);
}

export async function clearAll() {
  const items = await getItems();
  await setItems(items.filter(i => i.pinned));
}

// ─────────────────────────────────────────────────────────────────
// Snippets
// Snippet shape: { id, trigger, body, label?, createdAt, updatedAt }
// Stored separately from clipboard items in chrome.storage.local.
// ─────────────────────────────────────────────────────────────────

export async function getSnippets() {
  const { [STORAGE_KEYS.SNIPPETS]: s } = await chrome.storage.local.get(STORAGE_KEYS.SNIPPETS);
  return Array.isArray(s) ? s : [];
}

export async function setSnippets(list) {
  await chrome.storage.local.set({ [STORAGE_KEYS.SNIPPETS]: Array.isArray(list) ? list : [] });
}

export async function upsertSnippet(snippet) {
  if (!snippet || typeof snippet !== "object") throw new Error("invalid snippet");
  const trigger = String(snippet.trigger || "").trim();
  const body = String(snippet.body ?? "");
  if (!trigger) throw new Error("trigger required");
  if (!body) throw new Error("body required");

  const list = await getSnippets();
  const id = snippet.id || `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const next = list.filter(s => s.id !== id);
  // Trigger uniqueness — case-sensitive on purpose so ";Sig" and ";sig"
  // can coexist as distinct snippets.
  const duplicate = next.find(s => s.trigger === trigger);
  if (duplicate && duplicate.id !== id) {
    throw new Error(`trigger "${trigger}" is already used by another snippet`);
  }
  const final = {
    id,
    trigger,
    body,
    label: snippet.label || "",
    createdAt: snippet.createdAt || now,
    updatedAt: now,
  };
  next.unshift(final);
  await setSnippets(next);
  return final;
}

export async function removeSnippet(id) {
  const list = await getSnippets();
  await setSnippets(list.filter(s => s.id !== id));
}
