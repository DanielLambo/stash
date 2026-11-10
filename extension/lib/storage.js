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
  // Keep decrypted Vault cards masked until the user explicitly reveals one.
  autoBlurSensitive: true,
  retentionDays: 0,                  // 0 = keep until history cap / manual deletion
  captureRichText: true,
  capturePageContext: true,
};

export const STORAGE_KEYS = {
  ITEMS: "clipboard_items",
  SETTINGS: "clipboard_settings",
  LAST_SYNC: "clipboard_last_sync",
  SNIPPETS: "clipboard_snippets",
  COLLECTIONS: "clipboard_collections",
};

export const DEFAULT_COLLECTIONS = [
  { id: "inbox", name: "Inbox", color: "#8e8e93", createdAt: 0 },
  { id: "work", name: "Work", color: "#0a84ff", createdAt: 0 },
  { id: "personal", name: "Personal", color: "#30d158", createdAt: 0 },
  { id: "projects", name: "Projects", color: "#af52de", createdAt: 0 },
  { id: "signatures", name: "Signatures", color: "#ff9f0a", createdAt: 0 },
];

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
  const list = Array.isArray(items) ? items : [];
  const now = Date.now();
  const active = list.filter(item => !item.expiresAt || item.expiresAt > now || item.pinned);
  if (active.length !== list.length) {
    await chrome.storage.local.set({ [STORAGE_KEYS.ITEMS]: active });
  }
  return active;
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
export const MAX_FILE_DATA_URL_BYTES = 8 * 1024 * 1024;

// Add an item, deduping against the most recent and capping at maxItems (pinned preserved).
export async function addItem(item) {
  const settings = await getSettings();
  if (!settings.enabled) return null;
  if (item?.kind === "image" && (item.dataUrl || "").length > MAX_IMAGE_DATA_URL_BYTES) {
    return null;
  }
  if (item?.kind === "file" && (item.dataUrl || "").length > MAX_FILE_DATA_URL_BYTES) return null;

  const items = await getItems();
  const now = Date.now();
  const retentionDays = Math.max(0, Number(settings.retentionDays) || 0);
  const incoming = {
    id: item.id || makeId(),
    kind: item.kind || "text",
    text: item.text || "",
    dataUrl: item.dataUrl || "",
    width: item.width || 0,
    height: item.height || 0,
    ts: Number(item.ts) || now,
    updatedAt: Number(item.updatedAt) || Number(item.ts) || now,
    pinned: !!item.pinned,
    source: item.source || "",
    // Vault / sensitive flags propagate through addItem unchanged.
    vaulted: !!item.vaulted,
    iv: item.iv || "",
    ct: item.ct || "",
    vaultMeta: item.vaultMeta || null,
    sensitive: !!item.sensitive,
    sensitiveKind: item.sensitiveKind || "",
    html: item.html || "",
    tableCsv: item.tableCsv || "",
    tableMarkdown: item.tableMarkdown || "",
    fileName: item.fileName || "",
    mimeType: item.mimeType || "",
    fileSize: Number(item.fileSize) || 0,
    sourceUrl: item.sourceUrl || "",
    sourceTitle: item.sourceTitle || "",
    collectionId: item.collectionId || "inbox",
    collectionName: item.collectionName || "",
    collectionColor: item.collectionColor || "",
    tags: Array.isArray(item.tags) ? [...new Set(item.tags.map(t => String(t).trim()).filter(Boolean))].slice(0, 20) : [],
    syncExcluded: !!item.syncExcluded,
    screenshot: !!item.screenshot,
    signature: !!item.signature,
    expiresAt: Number(item.expiresAt) || (retentionDays ? now + retentionDays * 86400000 : 0),
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
    existing.updatedAt = incoming.updatedAt;
    existing.source = incoming.source || existing.source;
    for (const field of [
      "html", "tableCsv", "tableMarkdown", "sourceUrl", "sourceTitle",
      "fileName", "mimeType", "fileSize", "collectionId", "collectionName",
      "collectionColor", "syncExcluded", "screenshot", "signature", "expiresAt",
    ]) {
      if (Object.prototype.hasOwnProperty.call(item, field)) existing[field] = incoming[field];
    }
    if (Object.prototype.hasOwnProperty.call(item, "tags")) {
      existing.tags = [...new Set([...(existing.tags || []), ...incoming.tags])].slice(0, 20);
    }
    if (incoming.pinned) existing.pinned = true;
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
  const next = items.map(i => (i.id === id ? { ...i, pinned: !i.pinned, updatedAt: Date.now() } : i));
  await setItems(next);
}

export async function updateItem(id, patch) {
  const items = await getItems();
  const next = items.map(i => (i.id === id ? { ...i, ...patch, updatedAt: Number(patch?.updatedAt) || Date.now() } : i));
  await setItems(next);
}

export async function updateItems(ids, patch) {
  const wanted = new Set(ids || []);
  const now = Date.now();
  const items = await getItems();
  const next = items.map(i => wanted.has(i.id) ? { ...i, ...patch, updatedAt: now } : i);
  await setItems(next);
  return next.filter(i => wanted.has(i.id));
}

export async function removeItems(ids) {
  const wanted = new Set(ids || []);
  const items = await getItems();
  await setItems(items.filter(i => !wanted.has(i.id)));
}

export async function clearAll() {
  const items = await getItems();
  await setItems(items.filter(i => i.pinned));
}

export async function getCollections() {
  const { [STORAGE_KEYS.COLLECTIONS]: saved } = await chrome.storage.local.get(STORAGE_KEYS.COLLECTIONS);
  const custom = Array.isArray(saved) ? saved : [];
  const byId = new Map(DEFAULT_COLLECTIONS.map(c => [c.id, c]));
  for (const c of custom) if (c?.id && c?.name) byId.set(c.id, c);
  return [...byId.values()];
}

export async function upsertCollection(collection) {
  const name = String(collection?.name || "").trim();
  if (!name) throw new Error("collection name required");
  const all = await getCollections();
  const id = collection.id || `col_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const next = all.filter(c => c.id !== id);
  const saved = { id, name: name.slice(0, 40), color: collection.color || "#8e8e93", createdAt: collection.createdAt || Date.now() };
  next.push(saved);
  await chrome.storage.local.set({ [STORAGE_KEYS.COLLECTIONS]: next });
  return saved;
}

export async function removeCollection(id) {
  if (id === "inbox") return;
  const all = await getCollections();
  await chrome.storage.local.set({ [STORAGE_KEYS.COLLECTIONS]: all.filter(c => c.id !== id) });
  const items = await getItems();
  const now = Date.now();
  await setItems(items.map(i => i.collectionId === id ? { ...i, collectionId: "inbox", updatedAt: now } : i));
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
    variables: Array.isArray(snippet.variables) ? snippet.variables : [],
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
