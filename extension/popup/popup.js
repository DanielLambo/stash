import {
  getItems, setItems, getSettings, removeItem, togglePin, clearAll,
  addItem, updateItem, updateItems, removeItems, getCollections,
} from "../lib/storage.js";
import { categorize, timeAgo, summarize, trimUrlSurround } from "../lib/categorize.js";
// NOTE: api.js is intentionally NOT imported here. The popup performs
// no network calls — neither for sync nor for status. The Options
// page is the only surface that touches `lib/api.js`, and only on
// explicit user clicks.
import { actionsFor, qrMatrix, highlight, detectLanguage } from "../lib/actions.js";
import {
  isSetup as vaultIsSetup,
  isUnlocked as vaultIsUnlocked,
  unlockVault, lockVault, decryptItem, setupVault,
} from "../lib/crypto.js";
import { describeKind, shouldMaskVaultedItem } from "../lib/sensitive.js";
import { sanitizeRichHtml, tableRowsFromHtml, rowsToCsv, rowsToMarkdown } from "../lib/rich.js";
import { findAlphaBounds } from "../lib/image.js";

const $ = sel => document.querySelector(sel);
const listEl = $("#list");
const emptyEl = $("#empty");
const searchEl = $("#search");
const pillsEl = $("#pills");
const statusEl = $("#status");
const ftrStat = $("#ftr-stat");
const toastEl = $("#toast");
const modal = $("#modal");

let state = {
  items: [],
  settings: null,
  filter: "all",
  query: "",
  modalItem: null,
  modalEditing: false,
  vault: { setup: false, unlocked: false },
  // id → decrypted plaintext, populated after a successful unlock so we
  // don't decrypt on every render
  decrypted: new Map(),
  // Explicit per-popup reveals. Closing the popup clears this set.
  revealed: new Set(),
  collections: [],
  collectionFilter: "all",
  bulkMode: false,
  selected: new Set(),
  syncStatus: null,
};

const ICONS = {
  text: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h12M4 17h8"/></svg>`,
  link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1 1"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1-1"/></svg>`,
  email: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 7l10 7 10-7"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
  code: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76V6a3 3 0 0 1 6 0v4.76a2 2 0 0 0 .55 1.38l1.34 1.42A1 1 0 0 1 16.21 15H7.79a1 1 0 0 1-.68-1.44l1.34-1.42A2 2 0 0 0 9 10.76z"/></svg>`,
  pinFilled: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 17v5"/><path d="M9 10.76V6a3 3 0 0 1 6 0v4.76a2 2 0 0 0 .55 1.38l1.34 1.42A1 1 0 0 1 16.21 15H7.79a1 1 0 0 1-.68-1.44l1.34-1.42A2 2 0 0 0 9 10.76z"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`,
  open: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`,
  unlock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
  eyeOff: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 4.2A10.8 10.8 0 0 1 12 4c6.5 0 10 8 10 8a18 18 0 0 1-2.1 3.2M6.6 6.6C3.6 8.5 2 12 2 12s3.5 8 10 8a9.8 9.8 0 0 0 4.1-.9"/></svg>`,
};

function applyTheme(theme) {
  if (theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove("show"), 1500);
}

function setStatus(text, kind = "ok") {
  statusEl.textContent = text;
  statusEl.classList.remove("offline", "error");
  if (kind !== "ok") statusEl.classList.add(kind);
}

// Status text and tone are derived ENTIRELY from local state. No
// fetch, no probe, no ping. Sync health is observed via the cached
// `clipboard_last_sync_error` flag the service worker writes after
// each round-trip the user already opted into.
// Internal source tags ("current", "manual", etc.) are storage-layer
// labels and meaningless to the user — hide them from the UI. Real
// page hostnames pass through unchanged.
const INTERNAL_SOURCES = new Set(["current", "manual", "page", ""]);
function displaySource(src) {
  if (!src) return null;
  return INTERNAL_SOURCES.has(src) ? null : src;
}

function statusFromLocalState() {
  if (!state.settings?.enabled) return "Paused";
  if (state.settings?.syncEnabled && state.syncStatus?.state === "syncing") return "Syncing…";
  if (state.settings?.syncEnabled && state.syncStatus?.state === "offline") return "Offline · retry queued";
  if (state.settings?.syncEnabled && state.syncStatus?.state === "retrying") {
    const when = state.syncStatus.nextRetryAt ? new Date(state.syncStatus.nextRetryAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "soon";
    return `Sync retry ${when}`;
  }
  if (state.settings?.syncEnabled && state.syncStatus?.state === "synced") return "Ready · synced";
  if (state.vault?.setup && state.vault?.unlocked) return "Ready · Vault unlocked";
  if (state.vault?.setup) return "Ready · Vault locked";
  return "Ready";
}
function statusKindFromLocalState() {
  if (!state.settings?.enabled) return "offline";
  if (["offline", "retrying"].includes(state.syncStatus?.state)) return "error";
  return "ok";
}

function effectivePlaintext(item) {
  if (!item) return "";
  if (item.vaulted) return state.decrypted.get(item.id) || "";
  return item.text || "";
}

function categorizeForDisplay(item) {
  if (!item) return categorize({ kind: "text", text: "" });
  if (item.kind === "image") return categorize(item);
  return categorize({ ...item, text: effectivePlaintext(item) });
}

function visibleItems() {
  const q = state.query.trim().toLowerCase();
  return state.items.filter(item => {
    if (state.collectionFilter !== "all" && (item.collectionId || "inbox") !== state.collectionFilter) return false;
    const cat = categorizeForDisplay(item);
    if (state.filter === "pinned" && !item.pinned) return false;
    if (state.filter !== "all" && state.filter !== "pinned" && cat.type !== state.filter) return false;
    if (q) {
      // Search includes decrypted plaintext for unlocked vaulted items.
      const visibleText = effectivePlaintext(item);
      const hay = `${visibleText} ${item.source || ""} ${item.sourceTitle || ""} ${(item.tags || []).join(" ")} ${cat.label} ${cat.type} ${cat.meta?.host || ""}`;
      if (!hay.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function render() {
  const items = visibleItems();
  const all = state.items.length;
  ftrStat.textContent = all === 0 ? "0 items" : `${all} item${all === 1 ? "" : "s"}`;
  if (state.settings?.syncEnabled) {
    const syncLabel = state.syncStatus?.state === "synced" ? "synced" :
      state.syncStatus?.state === "syncing" ? "syncing" :
      ["offline", "retrying"].includes(state.syncStatus?.state) ? "retry queued" : "sync on";
    ftrStat.textContent += ` · ${syncLabel}`;
  }

  if (items.length === 0) {
    listEl.innerHTML = "";
    if (emptyEl) {
      emptyEl.classList.remove("hidden");
      // Scope under #empty so this works even if ids are missing (older builds / cached HTML).
      const emptyTitle = emptyEl.querySelector(".empty-title");
      const emptySub = emptyEl.querySelector(".empty-sub");
      if (emptyTitle && emptySub) {
        if (all === 0) {
          emptyTitle.textContent = "Nothing copied yet";
          emptySub.innerHTML = `Press ⌘C anywhere — your last <span id="empty-count">${state.settings?.maxItems || 5}</span> copies appear here.`;
        } else {
          emptyTitle.textContent = "No matching items";
          emptySub.textContent = "Try another filter, clear the search, or switch back to All.";
        }
      }
    }
    return;
  }
  emptyEl?.classList.add("hidden");

  const frag = document.createDocumentFragment();
  items.forEach((item, idx) => {
    frag.appendChild(renderCard(item, idx));
  });
  listEl.replaceChildren(frag);
}

function renderCard(item, index) {
  const cat = categorizeForDisplay(item);
  const card = document.createElement("article");
  card.className = "card";
  card.setAttribute("role", "listitem");
  card.dataset.id = item.id;
  if (item.pinned) card.classList.add("pinned");
  if (cat.type === "code") card.classList.add("is-code");
  if (item.signature) card.classList.add("is-signature");
  if (state.bulkMode) {
    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "card-select";
    check.checked = state.selected.has(item.id);
    check.addEventListener("click", e => {
      e.stopPropagation();
      if (check.checked) state.selected.add(item.id); else state.selected.delete(item.id);
      updateBulkCount();
    });
    card.appendChild(check);
  }

  // Vault treatment. Encrypted items stay masked even while their plaintext
  // is cached in memory, unless auto-blur is disabled or this card was
  // explicitly revealed during the current popup session.
  const isVaulted = !!item.vaulted;
  const isHidden = shouldMaskVaultedItem(
    item,
    state.decrypted.has(item.id),
    state.revealed.has(item.id),
    state.settings?.autoBlurSensitive,
  );
  if (isVaulted) card.classList.add("vaulted");
  if (isHidden) card.classList.add("hidden-content");

  // Icon / thumbnail / swatch
  let iconNode;
  if (isVaulted) {
    iconNode = document.createElement("div");
    iconNode.className = "card-icon";
    iconNode.dataset.type = "vault";
    iconNode.innerHTML = ICONS.lock;
  } else if (cat.type === "image" && item.dataUrl) {
    iconNode = document.createElement("div");
    iconNode.className = "card-thumb";
    iconNode.style.backgroundImage = `url("${item.dataUrl}")`;
  } else if (cat.type === "color") {
    iconNode = document.createElement("div");
    iconNode.className = "card-icon swatch";
    iconNode.dataset.type = "color";
    const fill = document.createElement("div");
    fill.className = "swatch-fill";
    fill.style.background = cat.meta.css || cat.meta.hex;
    iconNode.appendChild(fill);
  } else {
    iconNode = document.createElement("div");
    iconNode.className = "card-icon";
    iconNode.dataset.type = cat.type;
    iconNode.innerHTML = ICONS[cat.icon] || ICONS.text;
  }
  card.appendChild(iconNode);

  // Body
  const body = document.createElement("div");
  body.className = "card-body";
  const row1 = document.createElement("div");
  row1.className = "card-row1";
  if (index < 9) {
    const num = document.createElement("span");
    num.className = "card-num";
    num.textContent = index + 1;
    row1.appendChild(num);
  }
  const text = document.createElement("div");
  text.className = "card-text";
  if (isHidden) {
    text.textContent = "•".repeat(20);
  } else if (state.decrypted.has(item.id)) {
    const decrypted = state.decrypted.get(item.id);
    text.textContent = (decrypted || "").replace(/\s+/g, " ").slice(0, 240);
  } else {
    text.textContent = summarize(item, 200);
  }
  row1.appendChild(text);

  const row2 = document.createElement("div");
  row2.className = "card-row2";
  const tag = document.createElement("span");
  tag.className = "card-type-tag";
  tag.dataset.type = isVaulted ? "vault" : cat.type;
  if (isVaulted) {
    tag.textContent = item.vaultMeta?.label || describeKind(item.vaultMeta?.kind) || "Vault";
  } else if (item.sensitive) {
    tag.textContent = describeKind(item.sensitiveKind) || "Sensitive";
  } else {
    tag.textContent = cat.label;
  }
  row2.appendChild(tag);
  const collection = state.collections.find(c => c.id === (item.collectionId || "inbox"));
  if (collection) {
    row2.appendChild(dot());
    const col = document.createElement("span");
    col.textContent = collection.name;
    col.style.color = collection.color;
    row2.appendChild(col);
  }
  if (item.tags?.length) {
    const tags = document.createElement("span");
    tags.className = "card-tags";
    for (const value of item.tags.slice(0, 2)) {
      const t = document.createElement("span");
      t.className = "card-mini-tag";
      t.textContent = `#${value}`;
      tags.appendChild(t);
    }
    row2.appendChild(tags);
  }
  row2.appendChild(dot());
  const time = document.createElement("span");
  time.textContent = timeAgo(item.ts);
  row2.appendChild(time);
  const displaySrc = displaySource(item.source);
  if (displaySrc) {
    row2.appendChild(dot());
    const src = document.createElement("span");
    src.className = "src";
    src.textContent = displaySrc;
    row2.appendChild(src);
  }
  body.appendChild(row1);
  body.appendChild(row2);
  card.appendChild(body);

  // Pin marker (when not hovering)
  if (item.pinned) {
    const pm = document.createElement("div");
    pm.className = "card-pin-marker";
    pm.innerHTML = ICONS.pinFilled;
    card.appendChild(pm);
  }

  // Action buttons (visible on hover)
  const actions = document.createElement("div");
  actions.className = "card-actions";
  const pinBtn = actionBtn(item.pinned ? ICONS.pinFilled : ICONS.pin, item.pinned ? "Unpin" : "Pin", e => {
    e.stopPropagation();
    togglePin(item.id).then(refresh);
  });
  if (item.pinned) pinBtn.classList.add("is-pin-active");
  actions.appendChild(pinBtn);
  actions.appendChild(actionBtn(ICONS.open, "Expand", e => {
    e.stopPropagation();
    openModal(item);
  }));
  if (item.vaulted) {
    const revealed = state.revealed.has(item.id);
    actions.appendChild(actionBtn(revealed ? ICONS.eyeOff : ICONS.eye, revealed ? "Hide" : "Reveal", async e => {
      e.stopPropagation();
      if (revealed) {
        state.revealed.delete(item.id);
        render();
        return;
      }
      if (!(await ensureVaultUnlocked())) return;
      if (!state.decrypted.has(item.id)) {
        try {
          state.decrypted.set(item.id, await decryptItem(item));
        } catch {
          toast("Decrypt failed");
          return;
        }
      }
      state.revealed.add(item.id);
      render();
    }));
  }
  actions.appendChild(actionBtn(ICONS.trash, "Delete", async e => {
    e.stopPropagation();
    card.classList.add("card-leaving");
    setTimeout(async () => {
      await removeItem(item.id);
      refresh();
    }, 220);
  }));
  card.appendChild(actions);

  // Smart actions row — chips visible on hover, ordered after the icon buttons.
  const smart = actionsFor(item);
  if (smart.length) {
    const chips = document.createElement("div");
    chips.className = "card-chips";
    for (const a of smart) {
      const chip = document.createElement("button");
      chip.className = "chip";
      chip.textContent = a.label;
      chip.title = a.label;
      chip.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          const result = await a.run(item, makeActionCtx());
          if (!result) return;
          if (result.copy != null) {
            await navigator.clipboard.writeText(result.copy);
            toast(`Copied · ${truncate(result.copy, 30)}`);
          } else if (result.newText != null) {
            await updateItem(item.id, { text: result.newText, ts: Date.now() });
            await navigator.clipboard.writeText(result.newText);
            toast(`Replaced · re-copied`);
            state.items = await getItems();
            render();
          } else if (result.render === "qr") {
            openQrModal(result.value);
          } else if (result.render === "code") {
            openCodeModal(result.value.text, result.value.lang);
          }
        } catch {
          toast("Action failed");
        }
      });
      chips.appendChild(chip);
    }
    card.appendChild(chips);
  }

  // Click → primary action (copy + smart action)
  card.addEventListener("click", () => {
    if (state.bulkMode) {
      if (state.selected.has(item.id)) state.selected.delete(item.id); else state.selected.add(item.id);
      render();
      updateBulkCount();
      return;
    }
    primaryAction(item, categorizeForDisplay(item));
  });

  return card;
}

function makeActionCtx() {
  return {
    // SAFETY: chrome.tabs.create does not establish a window.opener
    // relationship from the new tab back to the popup. This gives us
    // the equivalent of HTML's `rel="noopener noreferrer"` for free.
    // We never pass user-supplied URLs through the popup without
    // protocol-checking first (see primaryAction below).
    openTab: (url) => { try { chrome.tabs.create({ url, active: false }); } catch {} },
    toast,
    copyText: async (t) => { try { await navigator.clipboard.writeText(t); } catch {} },
  };
}

function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function openQrModal(text) {
  const { size, modules } = qrMatrix(text);
  // Render to canvas at 8 px per module
  const scale = 8;
  const margin = 4;
  const px = (size + margin * 2) * scale;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = "#000";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules[y][x]) ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
    }
  }
  const dataUrl = canvas.toDataURL("image/png");
  // Reuse the existing modal: synthesize an "image" item briefly, but
  // simpler — just inject into modal-body manually.
  $("#modal-type").innerHTML = `<span class="dot" style="background:var(--type-link)"></span> QR Code`;
  $("#modal-meta").textContent = truncate(text, 60);
  $("#modal-edit").style.display = "none";
  const body = $("#modal-body"); body.innerHTML = "";
  const img = document.createElement("img");
  img.src = dataUrl;
  img.alt = "QR code";
  body.appendChild(img);
  state.modalItem = { id: "qr", kind: "image", dataUrl, text }; // for "Copy" button
  state.modalEditing = false;
  modal.classList.remove("hidden");
}

function openCodeModal(text, lang) {
  $("#modal-type").innerHTML = `<span class="dot" style="background:var(--type-code)"></span> ${(lang || "code").toUpperCase()}`;
  $("#modal-meta").textContent = `${(text.match(/\n/g) || []).length + 1} lines`;
  $("#modal-edit").style.display = "none";
  const body = $("#modal-body"); body.innerHTML = "";
  const pre = document.createElement("pre");
  pre.innerHTML = highlight(text, lang || detectLanguage(text));
  body.appendChild(pre);
  state.modalItem = { id: "code", kind: "text", text };
  state.modalEditing = false;
  modal.classList.remove("hidden");
}

function actionBtn(svg, title, onClick) {
  const b = document.createElement("button");
  b.className = "icon-btn";
  b.innerHTML = svg;
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

function dot() {
  const s = document.createElement("span");
  s.textContent = "·";
  s.style.opacity = "0.4";
  return s;
}

async function primaryAction(item, cat) {
  // Vaulted items: ensure unlocked, decrypt, then copy the plaintext.
  if (item.vaulted) {
    const ensured = await ensureVaultUnlocked();
    if (!ensured) return;
    let plaintext = state.decrypted.get(item.id);
    if (!plaintext) {
      try {
        plaintext = await decryptItem(item);
        state.decrypted.set(item.id, plaintext);
        render();
      } catch {
        toast("Decrypt failed");
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(plaintext);
      await updateItem(item.id, { ts: Date.now() });
      state.items = await getItems();
      render();
      toast("Decrypted · copied");
    } catch {
      toast("Copy failed");
    }
    return;
  }

  const ok = await copyToClipboard(item);
  if (!ok) return;
  // Smart secondary actions for some types — non-blocking
  if (cat.type === "link") {
    try {
      const href = cat.meta?.canonical || trimUrlSurround(item.text);
      const url = new URL(href);
      if (url.protocol === "http:" || url.protocol === "https:") {
        chrome.tabs.create({ url: url.toString(), active: false });
        toast(`Copied · opened ${cat.meta?.host || url.hostname}`);
        return;
      }
    } catch {}
    toast("Copied");
  } else if (cat.type === "image") {
    toast("Image copied");
  } else {
    toast("Copied");
  }
}

async function ensureVaultUnlocked() {
  if (await vaultIsUnlocked()) return true;
  if (!(await vaultIsSetup())) {
    toast("Set up vault in Settings");
    return false;
  }
  return new Promise(resolve => {
    showVaultUnlock(resolve);
  });
}

function showVaultUnlock(onDone) {
  const overlay = $("#vault-unlock");
  const input = $("#vault-pass");
  const err = $("#vault-err");
  err.textContent = "";
  input.value = "";
  overlay.classList.remove("hidden");
  setTimeout(() => input.focus(), 60);

  async function submit() {
    const pw = input.value;
    if (!pw) return;
    err.textContent = "Unlocking…";
    const ok = await unlockVault(pw);
    if (ok) {
      err.textContent = "";
      overlay.classList.add("hidden");
      // Refresh state so isUnlocked() reads the new session.
      state.vault.unlocked = true;
      await chrome.storage.local.remove("sensitive_capture_pending");
      onDone(true);
    } else {
      err.textContent = "Wrong password";
      input.select();
    }
  }
  function cancel() {
    overlay.classList.add("hidden");
    onDone(false);
  }
  input.onkeydown = e => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); submit(); }
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
  };
  $("#vault-cancel").onclick = cancel;
  $("#vault-submit").onclick = submit;
}

async function copyToClipboard(item) {
  try {
    if (item.kind === "image" && item.dataUrl) {
      // Convert to PNG — the only image type the W3C Clipboard API guarantees.
      const pngBlob = await dataUrlToPngBlob(item.dataUrl);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
    } else if (item.kind === "file" && item.dataUrl) {
      const a = document.createElement("a");
      a.href = item.dataUrl;
      a.download = item.fileName || "stash-file";
      a.click();
    } else if (item.html && navigator.clipboard?.write) {
      const safeHtml = sanitizeRichHtml(item.html);
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([item.text || ""], { type: "text/plain" }),
        "text/html": new Blob([safeHtml], { type: "text/html" }),
      })]);
    } else {
      await navigator.clipboard.writeText(item.text || "");
    }
    // bump ts so most-recent ordering reflects use
    await updateItem(item.id, { ts: Date.now() });
    state.items = await getItems();
    render();
    return true;
  } catch (e) {
    toast("Copy failed");
    return false;
  }
}

async function dataUrlToPngBlob(dataUrl) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("image decode failed"));
    i.src = dataUrl;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || 1;
  canvas.height = img.naturalHeight || 1;
  canvas.getContext("2d").drawImage(img, 0, 0);
  return await new Promise((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
  });
}

/* Modal */
function openModal(item) {
  state.modalItem = item;
  state.modalEditing = false;
  const vaultLocked = shouldMaskVaultedItem(
    item,
    state.decrypted.has(item.id),
    state.revealed.has(item.id),
    state.settings?.autoBlurSensitive,
  );
  const cat = categorizeForDisplay(item);
  const dotColors = {
    text: "var(--type-text)", link: "var(--type-link)", email: "var(--type-email)",
    phone: "var(--type-phone)", color: "var(--type-color)", code: "var(--type-code)",
    image: "var(--type-image)", rich: "var(--type-link)", table: "var(--type-color)", file: "var(--type-email)",
  };
  if (vaultLocked) {
    $("#modal-type").innerHTML = `<span class="dot" style="background:var(--type-color)"></span> Vault`;
  } else {
    $("#modal-type").innerHTML = `<span class="dot" style="background:${dotColors[cat.type] || "var(--type-text)"}"></span> ${cat.label}`;
  }
  const dsrc = displaySource(item.source);
  $("#modal-meta").textContent = `${timeAgo(item.ts)}${dsrc ? " · " + dsrc : ""}`;
  renderModalBody(item, cat);
  modal.classList.remove("hidden");

  $("#modal-edit").style.display = ["image", "file", "rich", "table"].includes(item.kind) || item.vaulted ? "none" : "";
  $("#modal-plain").style.display = item.html || item.tableCsv ? "" : "none";
  $("#modal-csv").style.display = item.kind === "table" ? "" : "none";
  $("#modal-markdown").style.display = item.kind === "table" ? "" : "none";
  $("#modal-local").textContent = item.syncExcluded ? "Allow sync" : "Local only";
}

function renderModalBody(item, _cat) {
  const body = $("#modal-body");
  body.innerHTML = "";

  if (shouldMaskVaultedItem(
    item,
    state.decrypted.has(item.id),
    state.revealed.has(item.id),
    state.settings?.autoBlurSensitive,
  )) {
    const p = document.createElement("p");
    p.className = "vault-modal-hint";
    p.textContent = "This item is protected. Use the eye button on its card to reveal it, or click the card to copy it without revealing.";
    body.appendChild(p);
    return;
  }

  const textSrc = effectivePlaintext(item);
  const viewCat = categorizeForDisplay(item);
  if (item.sourceTitle || item.sourceUrl) {
    const source = document.createElement("button");
    source.className = "btn source-context";
    source.textContent = item.sourceTitle || item.sourceUrl;
    source.title = item.sourceUrl || "";
    source.addEventListener("click", () => {
      if (/^https?:\/\//i.test(item.sourceUrl || "")) chrome.tabs.create({ url: item.sourceUrl, active: false });
    });
    body.appendChild(source);
  }

  if (item.kind === "file") {
    const wrap = document.createElement("div");
    wrap.className = "vault-modal-hint";
    wrap.textContent = `${item.fileName || "File"} · ${item.mimeType || "unknown type"} · ${formatBytes(item.fileSize || 0)}`;
    body.appendChild(wrap);
    if (item.mimeType?.startsWith("audio/")) {
      const audio = document.createElement("audio");
      audio.controls = true; audio.src = item.dataUrl; audio.style.width = "100%";
      body.appendChild(audio);
    } else if (item.mimeType === "application/pdf") {
      const embed = document.createElement("embed");
      embed.src = item.dataUrl; embed.type = "application/pdf";
      embed.style.cssText = "width:100%;height:300px";
      body.appendChild(embed);
    }
    return;
  }
  if ((item.kind === "rich" || item.kind === "table") && item.html) {
    const rich = document.createElement("div");
    rich.className = "rich-preview";
    rich.innerHTML = sanitizeRichHtml(item.html);
    rich.addEventListener("click", e => {
      const link = e.target.closest("a");
      if (!link) return;
      e.preventDefault();
      if (/^https?:\/\//i.test(link.href)) chrome.tabs.create({ url: link.href, active: false });
    });
    body.appendChild(rich);
    if (item.kind === "table") {
      const pre = document.createElement("pre");
      pre.textContent = item.tableMarkdown || item.tableCsv || "";
      body.appendChild(pre);
    }
    return;
  }

  if (viewCat.type === "image") {
    const img = document.createElement("img");
    img.src = item.dataUrl;
    img.alt = "Clipboard image";
    body.appendChild(img);
    const meta = document.createElement("div");
    meta.style.cssText = "text-align:center;font-size:11px;color:var(--text-tertiary);margin-top:10px;";
    meta.textContent = `${item.width || "?"} × ${item.height || "?"} · ${formatBytes((item.dataUrl.length * 3) / 4)}`;
    body.appendChild(meta);
    return;
  }

  if (viewCat.type === "color") {
    const sw = document.createElement("div");
    sw.className = "modal-color-swatch";
    sw.style.background = viewCat.meta.css || viewCat.meta.hex;
    body.appendChild(sw);
    const info = document.createElement("div");
    info.className = "modal-color-info";
    const rgb = hexToRgb(viewCat.meta.hex);
    const s1 = document.createElement("span");
    s1.textContent = viewCat.meta.css || String(viewCat.meta.hex).toUpperCase();
    const s2 = document.createElement("span");
    s2.textContent = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    info.append(s1, s2);
    body.appendChild(info);
    return;
  }

  if (viewCat.type === "link") {
    const wrap = document.createElement("div");
    wrap.className = "modal-link-preview";
    // SAFETY: deliberately no remote favicon fetch. Earlier drafts hit
    // www.google.com/s2/favicons every time the user expanded a link
    // card, which leaked the hostname to a third party. We render a
    // local SVG link icon instead so the popup makes zero passive
    // network requests.
    const fav = document.createElement("div");
    fav.className = "favicon";
    fav.innerHTML = ICONS.link;
    wrap.appendChild(fav);
    const info = document.createElement("div");
    info.className = "info";
    const host = document.createElement("div");
    host.className = "host";
    host.textContent = viewCat.meta?.host || textSrc;
    const urlEl = document.createElement("div");
    urlEl.className = "url";
    urlEl.textContent = viewCat.meta?.canonical || trimUrlSurround(textSrc);
    info.appendChild(host);
    info.appendChild(urlEl);
    wrap.appendChild(info);
    body.appendChild(wrap);
  }

  if (state.modalEditing) {
    const ta = document.createElement("textarea");
    ta.value = textSrc;
    ta.id = "modal-textarea";
    body.appendChild(ta);
    setTimeout(() => ta.focus(), 50);
    return;
  }

  if (viewCat.type === "code") {
    const pre = document.createElement("pre");
    pre.className = "modal-pre-code";
    pre.innerHTML = highlight(textSrc, detectLanguage(textSrc));
    body.appendChild(pre);
    return;
  }

  if (viewCat.type !== "image" && viewCat.type !== "color") {
    const pre = document.createElement("pre");
    pre.textContent = textSrc;
    body.appendChild(pre);
  }
}

function closeModal() {
  modal.classList.add("hidden");
  state.modalItem = null;
  state.modalEditing = false;
}

$("#modal-close").addEventListener("click", closeModal);
modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });

$("#modal-edit").addEventListener("click", async () => {
  if (!state.modalItem) return;
  if (!state.modalEditing) {
    state.modalEditing = true;
    $("#modal-edit").textContent = "Save";
    renderModalBody(state.modalItem, categorizeForDisplay(state.modalItem));
    return;
  }
  const ta = $("#modal-textarea");
  if (!ta) return;
  const newText = ta.value;
  await updateItem(state.modalItem.id, { text: newText, ts: Date.now() });
  state.items = await getItems();
  const fresh = state.items.find(i => i.id === state.modalItem.id);
  if (!fresh) {
    // Item was removed elsewhere — close cleanly instead of crashing.
    closeModal();
    render();
    toast("Saved");
    return;
  }
  state.modalItem = fresh;
  state.modalEditing = false;
  $("#modal-edit").textContent = "Edit";
  renderModalBody(fresh, categorizeForDisplay(fresh));
  render();
  toast("Saved");
});

$("#modal-copy").addEventListener("click", async () => {
  if (!state.modalItem) return;
  const ok = await copyToClipboard(state.modalItem);
  if (ok) toast("Copied");
});
$("#modal-plain").addEventListener("click", async () => {
  if (!state.modalItem) return;
  const text = state.modalItem.tableMarkdown || effectivePlaintext(state.modalItem);
  try { await navigator.clipboard.writeText(text); toast("Plain text copied"); } catch { toast("Copy failed"); }
});
$("#modal-csv").addEventListener("click", async () => {
  if (!state.modalItem?.tableCsv) return;
  await navigator.clipboard.writeText(state.modalItem.tableCsv);
  toast("CSV copied");
});
$("#modal-markdown").addEventListener("click", async () => {
  if (!state.modalItem?.tableMarkdown) return;
  await navigator.clipboard.writeText(state.modalItem.tableMarkdown);
  toast("Markdown copied");
});
$("#modal-local").addEventListener("click", async () => {
  if (!state.modalItem) return;
  await updateItem(state.modalItem.id, { syncExcluded: !state.modalItem.syncExcluded });
  state.modalItem = (await getItems()).find(i => i.id === state.modalItem.id);
  state.items = await getItems();
  $("#modal-local").textContent = state.modalItem.syncExcluded ? "Allow sync" : "Local only";
  render();
  toast(state.modalItem.syncExcluded ? "Kept on this device" : "Sync allowed");
});

/* Header buttons */
$("#btn-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("#btn-clear").addEventListener("click", async () => {
  await clearAll();
  refresh();
  toast("Cleared");
});
$("#btn-sync").addEventListener("click", async () => {
  setStatus("Syncing…");
  const r = await chrome.runtime.sendMessage({ type: "sync-now" });
  await refresh();
  if (r?.ok) toast(r.pulled ? `Synced · ${r.pulled} new` : "Synced");
  else toast("Sync failed");
});
$("#btn-paste").addEventListener("click", async () => {
  const saved = await captureCurrentClipboard("manual");
  if (saved) {
    await refresh();
    toast(saved.kind === "image" ? "Image captured" : "Captured");
  } else {
    toast("Nothing on clipboard");
  }
});

function fillCollectionSelect(select, includeAll = false) {
  const current = select.value;
  select.innerHTML = "";
  if (includeAll) select.add(new Option("All collections", "all"));
  for (const c of state.collections) select.add(new Option(c.name, c.id));
  if ([...select.options].some(o => o.value === current)) select.value = current;
}

function updateBulkCount() {
  $("#bulk-count").textContent = `${state.selected.size} selected`;
}

$("#collection-filter").addEventListener("change", e => {
  state.collectionFilter = e.target.value;
  render();
});
$("#bulk-toggle").addEventListener("click", () => {
  state.bulkMode = !state.bulkMode;
  if (!state.bulkMode) state.selected.clear();
  $("#bulk-toggle").textContent = state.bulkMode ? "Done" : "Select";
  $("#bulk-bar").classList.toggle("hidden", !state.bulkMode);
  updateBulkCount();
  render();
});
$("#bulk-apply").addEventListener("click", async () => {
  if (!state.selected.size) return;
  const tags = $("#bulk-tags").value.split(",").map(t => t.trim()).filter(Boolean);
  const collectionId = $("#bulk-collection").value || "inbox";
  const collection = state.collections.find(c => c.id === collectionId);
  const patch = {
    collectionId,
    collectionName: collection?.name || "Inbox",
    collectionColor: collection?.color || "#8e8e93",
  };
  if (tags.length) patch.tags = [...new Set(tags)].slice(0, 20);
  await updateItems([...state.selected], patch);
  await refresh();
  toast("Selection updated");
});
$("#bulk-delete").addEventListener("click", async () => {
  if (!state.selected.size || !confirm(`Delete ${state.selected.size} selected item(s)?`)) return;
  await removeItems([...state.selected]);
  state.selected.clear();
  await refresh();
  updateBulkCount();
});

/* Search */
searchEl.addEventListener("input", e => {
  state.query = e.target.value;
  render();
});

/* Pills */
pillsEl.addEventListener("click", e => {
  const pill = e.target.closest(".pill");
  if (!pill) return;
  pillsEl.querySelectorAll(".pill").forEach(p => p.classList.remove("active"));
  pill.classList.add("active");
  state.filter = pill.dataset.filter;
  render();
});

/* Keyboard */
document.addEventListener("keydown", e => {
  // ⌘K / Ctrl+K → focus search
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    searchEl.focus();
    searchEl.select();
    return;
  }
  // Escape → close modal or clear search
  if (e.key === "Escape") {
    if (!$("#signature-editor").classList.contains("hidden")) { closeSignatureEditor(); return; }
    if (!$("#screenshot-editor").classList.contains("hidden")) { $("#screenshot-editor").classList.add("hidden"); return; }
    if (!modal.classList.contains("hidden")) { closeModal(); return; }
    if (document.activeElement === searchEl) {
      searchEl.value = "";
      state.query = "";
      render();
      searchEl.blur();
    }
    return;
  }
  // 1-9 quick paste (only when search not focused)
  if (/^[1-9]$/.test(e.key) && document.activeElement !== searchEl && modal.classList.contains("hidden")) {
    const idx = parseInt(e.key, 10) - 1;
    const visible = visibleItems();
    if (visible[idx]) primaryAction(visible[idx], categorizeForDisplay(visible[idx]));
  }
});

/* Live updates */
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === "local" && changes.clipboard_items) {
    state.items = changes.clipboard_items.newValue || [];
    render();
  }
  if (area === "sync" && changes.clipboard_settings) {
    state.settings = changes.clipboard_settings.newValue;
    applyTheme(state.settings.theme);
    render();
  }
});

/* Init */
async function refresh() {
  state.items = await getItems();
  state.settings = await getSettings();
  state.collections = await getCollections();
  const knownCollections = new Set(state.collections.map(c => c.id));
  for (const item of state.items) {
    if (item.collectionId && item.collectionName && !knownCollections.has(item.collectionId)) {
      state.collections.push({
        id: item.collectionId, name: item.collectionName,
        color: item.collectionColor || "#8e8e93", createdAt: item.ts || 0,
      });
      knownCollections.add(item.collectionId);
    }
  }
  state.syncStatus = (await chrome.storage.local.get("clipboard_sync_status")).clipboard_sync_status || null;
  fillCollectionSelect($("#collection-filter"), true);
  fillCollectionSelect($("#bulk-collection"), false);
  $("#collection-filter").value = state.collectionFilter;
  applyTheme(state.settings.theme);
  setStatus(statusFromLocalState(), statusKindFromLocalState());
  render();
}

// Migration: older builds set `sensitive: true` on plaintext items
// when the Vault wasn't configured. Those items have always been
// stored as plaintext (the SW never had a key to encrypt with), so
// the flag is purely a UI-blur signal — and blurring plaintext that
// the user can't decrypt is broken UX. Clear the flag on any
// non-vaulted item so they render normally.
async function migrateOrphanedSensitiveFlags() {
  const items = await getItems();
  let changed = false;
  const next = items.map(i => {
    if (i.sensitive && !i.vaulted) {
      changed = true;
      const { sensitive, sensitiveKind, ...rest } = i;
      return rest;
    }
    return i;
  });
  if (changed) await setItems(next);
}

async function decryptUnlockedVaultItems() {
  if (!(await vaultIsUnlocked())) return;
  let any = false;
  for (const item of state.items) {
    if (item.vaulted && !state.decrypted.has(item.id)) {
      try {
        const pt = await decryptItem(item);
        state.decrypted.set(item.id, pt);
        any = true;
      } catch { /* skip undecryptable */ }
    }
  }
  if (any) render();
}

async function init() {
  // One-time clean-up of stale sensitive flags from older builds.
  await migrateOrphanedSensitiveFlags();
  await refresh();
  state.vault.setup = await vaultIsSetup();
  state.vault.unlocked = await vaultIsUnlocked();
  await decryptUnlockedVaultItems();
  // SAFETY: the popup never makes a network request on its own. The
  // status badge is derived ONLY from local state. To verify sync
  // reachability the user goes to the Options page and clicks
  // "Test connection" — that is the single place sync health is
  // probed, and only on an explicit click.
  setStatus(statusFromLocalState(), statusKindFromLocalState());
  const pending = (await chrome.storage.local.get("sensitive_capture_pending")).sensitive_capture_pending;
  if (pending && Date.now() - pending.ts < 24 * 60 * 60 * 1000) {
    const warning = $("#privacy-warning");
    warning.textContent = "A sensitive copy was blocked because Vault was locked or not configured. Open Settings to protect future sensitive clips.";
    warning.classList.remove("hidden");
    warning.addEventListener("click", () => chrome.runtime.openOptionsPage(), { once: true });
  }
  // Always pick up whatever is currently on the system clipboard — handles
  // copies from outside the browser, restricted pages (chrome://), or
  // anywhere our content script couldn't reach.
  const saved = await captureCurrentClipboard("current");
  if (saved) {
    state.items = await getItems();
    render();
  }
}

// Capture whatever is on the system clipboard right now — text OR image.
// Popup is user-initiated, so navigator.clipboard.read() is allowed.
async function captureCurrentClipboard(sourceLabel) {
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const ci of items) {
        const imgType = (ci.types || []).find(t => t.startsWith("image/"));
        if (imgType) {
          const blob = await ci.getType(imgType);
          const dataUrl = await blobToDataUrl(blob);
          const dim = await imgDim(dataUrl);
          return await storeManualCapture({
            kind: "image",
            dataUrl,
            width: dim.w,
            height: dim.h,
            source: sourceLabel,
            ts: Date.now(),
          });
        }
      }
      // No image — try the text path on the same ClipboardItem set.
      for (const ci of items) {
        if ((ci.types || []).includes("text/html")) {
          const htmlBlob = await ci.getType("text/html");
          const plainBlob = (ci.types || []).includes("text/plain") ? await ci.getType("text/plain") : null;
          const rawHtml = await htmlBlob.text();
          const html = sanitizeRichHtml(rawHtml);
          const text = plainBlob ? await plainBlob.text() : "";
          if (html && text.trim()) {
            const rows = tableRowsFromHtml(html);
            return await storeManualCapture({
              kind: rows.length ? "table" : "rich", text, html,
              tableCsv: rows.length ? rowsToCsv(rows) : "",
              tableMarkdown: rows.length ? rowsToMarkdown(rows) : "",
              source: sourceLabel, ts: Date.now(),
            });
          }
        }
        if ((ci.types || []).includes("text/plain")) {
          const blob = await ci.getType("text/plain");
          const txt = await blob.text();
          if (txt && txt.trim()) {
            return await storeManualCapture({ kind: "text", text: txt, source: sourceLabel, ts: Date.now() });
          }
        }
      }
    }
  } catch { /* fall through to readText */ }

  try {
    const txt = await navigator.clipboard.readText();
    if (txt && txt.trim()) {
      return await storeManualCapture({ kind: "text", text: txt, source: sourceLabel, ts: Date.now() });
    }
  } catch {}
  return null;
}

async function storeManualCapture(payload) {
  const result = await chrome.runtime.sendMessage({ type: "capture-manual", payload });
  if (!result?.ok && result?.reason?.startsWith("vault_")) {
    toast(result.reason === "vault_locked" ? "Vault is locked; sensitive clip blocked" : "Set up Vault to protect this clip");
  }
  return result?.saved || null;
}

async function addFiles(files) {
  let saved = 0;
  let rejected = 0;
  for (const file of [...(files || [])]) {
    try {
      const dataUrl = await blobToDataUrl(file);
      const item = await addItem({
        kind: "file", text: file.name, dataUrl,
        fileName: file.name, mimeType: file.type || "application/octet-stream",
        fileSize: file.size, source: "manual", ts: Date.now(),
        syncExcluded: true,
      });
      if (item) saved++; else rejected++;
    } catch { rejected++; }
  }
  await refresh();
  toast(rejected ? `Added ${saved}; ${rejected} too large` : `Added ${saved} file${saved === 1 ? "" : "s"}`);
}

$("#btn-file").addEventListener("click", () => $("#file-input").click());
$("#file-input").addEventListener("change", e => {
  addFiles(e.target.files);
  e.target.value = "";
});
const appEl = $("#app");
appEl.addEventListener("dragover", e => { e.preventDefault(); appEl.classList.add("drop-active"); });
appEl.addEventListener("dragleave", e => { if (!appEl.contains(e.relatedTarget)) appEl.classList.remove("drop-active"); });
appEl.addEventListener("drop", e => {
  e.preventDefault();
  appEl.classList.remove("drop-active");
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});

const shot = {
  image: null, mode: "crop", selection: null, dragStart: null,
  paths: [], activePath: null, ocrText: "",
};
const shotCanvas = $("#shot-canvas");
const shotCtx = shotCanvas.getContext("2d");

function shotPoint(e) {
  const r = shotCanvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(shotCanvas.width, (e.clientX - r.left) * shotCanvas.width / r.width)),
    y: Math.max(0, Math.min(shotCanvas.height, (e.clientY - r.top) * shotCanvas.height / r.height)),
  };
}
function renderShot() {
  if (!shot.image) return;
  shotCtx.clearRect(0, 0, shotCanvas.width, shotCanvas.height);
  shotCtx.drawImage(shot.image, 0, 0);
  shotCtx.strokeStyle = "#ff453a";
  shotCtx.lineWidth = Math.max(4, shotCanvas.width / 300);
  shotCtx.lineCap = "round";
  for (const path of shot.paths) {
    if (path.length < 2) continue;
    shotCtx.beginPath();
    shotCtx.moveTo(path[0].x, path[0].y);
    for (const p of path.slice(1)) shotCtx.lineTo(p.x, p.y);
    shotCtx.stroke();
  }
  if (shot.selection) {
    const { x, y, w, h } = shot.selection;
    shotCtx.fillStyle = "rgba(0,122,255,.16)";
    shotCtx.strokeStyle = "#0a84ff";
    shotCtx.lineWidth = Math.max(2, shotCanvas.width / 600);
    shotCtx.fillRect(x, y, w, h);
    shotCtx.strokeRect(x, y, w, h);
  }
}
function setShotMode(mode) {
  shot.mode = mode;
  document.querySelectorAll("[data-shot-mode]").forEach(b => b.classList.toggle("active", b.dataset.shotMode === mode));
}
document.querySelectorAll("[data-shot-mode]").forEach(b => b.addEventListener("click", () => setShotMode(b.dataset.shotMode)));
shotCanvas.addEventListener("pointerdown", e => {
  shotCanvas.setPointerCapture(e.pointerId);
  const p = shotPoint(e);
  shot.dragStart = p;
  if (shot.mode === "draw") {
    shot.activePath = [p];
    shot.paths.push(shot.activePath);
  }
});
shotCanvas.addEventListener("pointermove", e => {
  if (!shot.dragStart) return;
  const p = shotPoint(e);
  if (shot.mode === "draw") shot.activePath.push(p);
  else {
    shot.selection = {
      x: Math.min(shot.dragStart.x, p.x), y: Math.min(shot.dragStart.y, p.y),
      w: Math.abs(p.x - shot.dragStart.x), h: Math.abs(p.y - shot.dragStart.y),
    };
  }
  renderShot();
});
shotCanvas.addEventListener("pointerup", () => { shot.dragStart = null; shot.activePath = null; });

async function openScreenshotEditor(dataUrl) {
  const image = await new Promise((resolve, reject) => {
    const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = dataUrl;
  });
  shot.image = image; shot.selection = null; shot.paths = []; shot.ocrText = "";
  shotCanvas.width = image.naturalWidth; shotCanvas.height = image.naturalHeight;
  setShotMode("crop"); renderShot();
  $("#shot-status").textContent = "Drag to select a region, or annotate before saving.";
  $("#screenshot-editor").classList.remove("hidden");
}
$("#btn-screenshot").addEventListener("click", async () => {
  toast("Capturing visible tab…");
  const result = await chrome.runtime.sendMessage({ type: "capture-screenshot" });
  if (!result?.ok || !result.dataUrl) return toast("Screenshot failed");
  await openScreenshotEditor(result.dataUrl);
});
$("#shot-cancel").addEventListener("click", () => $("#screenshot-editor").classList.add("hidden"));
$("#shot-reset").addEventListener("click", () => { shot.selection = null; shot.paths = []; shot.ocrText = ""; renderShot(); });
$("#shot-ocr").addEventListener("click", async () => {
  if (typeof TextDetector === "undefined") {
    $("#shot-status").textContent = "OCR is not available in this Chrome build.";
    return;
  }
  const selection = shot.selection;
  try {
    shot.selection = null; renderShot();
    const blocks = await new TextDetector().detect(shotCanvas);
    shot.ocrText = blocks.map(b => b.rawValue || "").filter(Boolean).join("\n");
    $("#shot-status").textContent = shot.ocrText ? `Extracted ${shot.ocrText.length} characters.` : "No text detected.";
  } catch { $("#shot-status").textContent = "Text extraction failed."; }
  finally { shot.selection = selection; renderShot(); }
});
$("#shot-save").addEventListener("click", async () => {
  const crop = shot.selection?.w > 8 && shot.selection?.h > 8
    ? shot.selection : { x: 0, y: 0, w: shotCanvas.width, h: shotCanvas.height };
  const selection = shot.selection; shot.selection = null; renderShot();
  const out = document.createElement("canvas");
  out.width = Math.round(crop.w); out.height = Math.round(crop.h);
  out.getContext("2d").drawImage(shotCanvas, crop.x, crop.y, crop.w, crop.h, 0, 0, out.width, out.height);
  shot.selection = selection;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const saved = await addItem({
    kind: "image", screenshot: true, dataUrl: out.toDataURL("image/png"),
    width: out.width, height: out.height, text: shot.ocrText,
    source: tabs[0]?.url ? new URL(tabs[0].url).hostname : "screenshot",
    sourceUrl: tabs[0]?.url || "", sourceTitle: tabs[0]?.title || "",
    ts: Date.now(), syncExcluded: true,
  });
  $("#screenshot-editor").classList.add("hidden");
  await refresh();
  toast(saved ? "Screenshot saved" : "Screenshot was too large to save");
});

const signatureCanvas = $("#signature-canvas");
const signatureCtx = signatureCanvas.getContext("2d", { willReadFrequently: true });
const signatureState = { drawing: false, dirty: false, last: null };

function signaturePoint(e) {
  const rect = signatureCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * signatureCanvas.width / rect.width,
    y: (e.clientY - rect.top) * signatureCanvas.height / rect.height,
  };
}

function clearSignature() {
  signatureCtx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
  signatureState.dirty = false;
  signatureState.last = null;
}

function openSignatureEditor() {
  clearSignature();
  $("#signature-name").value = "My signature";
  $("#signature-file").value = "";
  $("#signature-editor").classList.remove("hidden");
}

function closeSignatureEditor() {
  $("#signature-editor").classList.add("hidden");
  signatureState.drawing = false;
}

signatureCanvas.addEventListener("pointerdown", e => {
  if (e.button !== 0 && e.pointerType === "mouse") return;
  signatureCanvas.setPointerCapture(e.pointerId);
  signatureState.drawing = true;
  signatureState.dirty = true;
  signatureState.last = signaturePoint(e);
  signatureCtx.fillStyle = $("#signature-color").value;
  signatureCtx.beginPath();
  signatureCtx.arc(signatureState.last.x, signatureState.last.y, 2.8, 0, Math.PI * 2);
  signatureCtx.fill();
});
signatureCanvas.addEventListener("pointermove", e => {
  if (!signatureState.drawing) return;
  const point = signaturePoint(e);
  signatureCtx.strokeStyle = $("#signature-color").value;
  signatureCtx.lineWidth = 5.5;
  signatureCtx.lineCap = "round";
  signatureCtx.lineJoin = "round";
  signatureCtx.beginPath();
  signatureCtx.moveTo(signatureState.last.x, signatureState.last.y);
  signatureCtx.lineTo(point.x, point.y);
  signatureCtx.stroke();
  signatureState.last = point;
});
function stopSignatureDrawing() {
  signatureState.drawing = false;
  signatureState.last = null;
}
signatureCanvas.addEventListener("pointerup", stopSignatureDrawing);
signatureCanvas.addEventListener("pointercancel", stopSignatureDrawing);

function trimmedSignatureCanvas() {
  const { width, height } = signatureCanvas;
  const pixels = signatureCtx.getImageData(0, 0, width, height).data;
  const bounds = findAlphaBounds(pixels, width, height);
  if (!bounds) return null;
  const { left, right, top, bottom } = bounds;
  const pad = 20;
  const sx = Math.max(0, left - pad), sy = Math.max(0, top - pad);
  const sw = Math.min(width - sx, right - left + 1 + pad * 2);
  const sh = Math.min(height - sy, bottom - top + 1 + pad * 2);
  const out = document.createElement("canvas");
  out.width = sw; out.height = sh;
  out.getContext("2d").drawImage(signatureCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

$("#btn-signature").addEventListener("click", openSignatureEditor);
$("#signature-cancel").addEventListener("click", closeSignatureEditor);
$("#signature-close").addEventListener("click", closeSignatureEditor);
$("#signature-clear").addEventListener("click", clearSignature);
$("#signature-file").addEventListener("change", async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
    toast("Use a PNG, JPEG, or WebP image under 8 MB");
    e.target.value = "";
    return;
  }
  try {
    const dataUrl = await blobToDataUrl(file);
    const image = await new Promise((resolve, reject) => {
      const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = dataUrl;
    });
    if (image.naturalWidth > 10000 || image.naturalHeight > 10000) throw new Error("image dimensions too large");
    clearSignature();
    const scale = Math.min(signatureCanvas.width / image.naturalWidth, signatureCanvas.height / image.naturalHeight);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    signatureCtx.drawImage(image, (signatureCanvas.width - width) / 2, (signatureCanvas.height - height) / 2, width, height);
    signatureState.dirty = true;
  } catch { toast("Could not import signature image"); }
});
$("#signature-save").addEventListener("click", async () => {
  const output = signatureState.dirty ? trimmedSignatureCanvas() : null;
  if (!output) return toast("Draw or import a signature first");
  const name = $("#signature-name").value.trim() || "My signature";
  const saved = await addItem({
    kind: "image", signature: true, text: name,
    dataUrl: output.toDataURL("image/png"), width: output.width, height: output.height,
    source: "signature", ts: Date.now(), pinned: true, syncExcluded: true,
    collectionId: "signatures", collectionName: "Signatures", collectionColor: "#ff9f0a",
    tags: ["signature"],
  });
  if (!saved) return toast("Signature was too large to save");
  closeSignatureEditor();
  const copied = await copyToClipboard(saved);
  await refresh();
  toast(copied ? "Signature saved and copied" : "Signature saved; copy failed");
});

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function imgDim(dataUrl) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = dataUrl;
  });
}

/* Helpers */
function hexToRgb(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6);
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function formatBytes(b) {
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

init();
