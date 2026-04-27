import {
  getItems, getSettings, removeItem, togglePin, clearAll,
  addItem, updateItem,
} from "../lib/storage.js";
import { categorize, timeAgo, summarize } from "../lib/categorize.js";
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
import { describeKind } from "../lib/sensitive.js";

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
function statusFromLocalState() {
  if (!state.settings?.enabled) return "Paused";
  if (state.vault?.setup && state.vault?.unlocked) return "Ready · Vault unlocked";
  if (state.vault?.setup) return "Ready · Vault locked";
  return "Ready";
}
function statusKindFromLocalState() {
  if (!state.settings?.enabled) return "offline";
  return "ok";
}

function visibleItems() {
  const q = state.query.trim().toLowerCase();
  return state.items.filter(item => {
    const cat = categorize(item);
    if (state.filter === "pinned" && !item.pinned) return false;
    if (state.filter !== "all" && state.filter !== "pinned" && cat.type !== state.filter) return false;
    if (q) {
      // Search includes decrypted plaintext for unlocked vaulted items.
      const visibleText = item.vaulted ? (state.decrypted.get(item.id) || "") : (item.text || "");
      const hay = visibleText + " " + (item.source || "");
      if (!hay.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function render() {
  const items = visibleItems();
  const all = state.items.length;
  ftrStat.textContent = all === 0 ? "0 items" : `${all} item${all === 1 ? "" : "s"}`;
  if (state.settings?.syncEnabled) ftrStat.textContent += " · synced";

  if (items.length === 0) {
    listEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    $("#empty-count").textContent = state.settings?.maxItems || 5;
    return;
  }
  emptyEl.classList.add("hidden");

  const frag = document.createDocumentFragment();
  items.forEach((item, idx) => {
    frag.appendChild(renderCard(item, idx));
  });
  listEl.replaceChildren(frag);
}

function renderCard(item, index) {
  const cat = categorize(item);
  const card = document.createElement("article");
  card.className = "card";
  card.setAttribute("role", "listitem");
  card.dataset.id = item.id;
  if (item.pinned) card.classList.add("pinned");
  if (cat.type === "code") card.classList.add("is-code");

  // Vault treatment — replace icon with lock + blur the card body until
  // the user reveals it. Sensitive-but-not-vaulted items just blur.
  const isVaulted = !!item.vaulted;
  const isSensitive = !!item.sensitive || isVaulted;
  const isHidden = isSensitive && !state.decrypted.has(item.id);
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
    fill.style.background = cat.meta.hex;
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
    text.textContent = summarize(item);
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
  row2.appendChild(dot());
  const time = document.createElement("span");
  time.textContent = timeAgo(item.ts);
  row2.appendChild(time);
  if (item.source) {
    row2.appendChild(dot());
    const src = document.createElement("span");
    src.className = "src";
    src.textContent = item.source;
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
  actions.appendChild(actionBtn(ICONS.pin, item.pinned ? "Unpin" : "Pin", e => {
    e.stopPropagation();
    togglePin(item.id).then(refresh);
  }));
  actions.appendChild(actionBtn(ICONS.open, "Expand", e => {
    e.stopPropagation();
    openModal(item);
  }));
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
  card.addEventListener("click", () => primaryAction(item, cat));

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
      const url = new URL(item.text);
      if (url.protocol === "http:" || url.protocol === "https:") {
        chrome.tabs.create({ url: url.toString(), active: false });
        toast(`Copied · opened ${cat.meta.host}`);
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
  const cat = categorize(item);
  const dotColors = {
    text: "var(--type-text)", link: "var(--type-link)", email: "var(--type-email)",
    phone: "var(--type-phone)", color: "var(--type-color)", code: "var(--type-code)",
    image: "var(--type-image)",
  };
  $("#modal-type").innerHTML = `<span class="dot" style="background:${dotColors[cat.type]}"></span> ${cat.label}`;
  $("#modal-meta").textContent = `${timeAgo(item.ts)}${item.source ? " · " + item.source : ""}`;
  renderModalBody(item, cat);
  modal.classList.remove("hidden");

  $("#modal-edit").style.display = item.kind === "image" ? "none" : "";
}

function renderModalBody(item, cat) {
  const body = $("#modal-body");
  body.innerHTML = "";

  if (cat.type === "image") {
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

  if (cat.type === "color") {
    const sw = document.createElement("div");
    sw.className = "modal-color-swatch";
    sw.style.background = cat.meta.hex;
    body.appendChild(sw);
    const info = document.createElement("div");
    info.className = "modal-color-info";
    const rgb = hexToRgb(cat.meta.hex);
    info.innerHTML = `<span>${cat.meta.hex.toUpperCase()}</span><span>rgb(${rgb.r}, ${rgb.g}, ${rgb.b})</span>`;
    body.appendChild(info);
    return;
  }

  if (cat.type === "link") {
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
    host.textContent = cat.meta?.host || item.text;
    const url = document.createElement("div");
    url.className = "url";
    url.textContent = item.text;
    info.appendChild(host);
    info.appendChild(url);
    wrap.appendChild(info);
    body.appendChild(wrap);
  }

  if (state.modalEditing) {
    const ta = document.createElement("textarea");
    ta.value = item.text || "";
    ta.id = "modal-textarea";
    body.appendChild(ta);
    setTimeout(() => ta.focus(), 50);
  } else {
    const pre = document.createElement("pre");
    pre.textContent = item.text || "";
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
    renderModalBody(state.modalItem, categorize(state.modalItem));
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
  renderModalBody(fresh, categorize(fresh));
  render();
  toast("Saved");
});

$("#modal-copy").addEventListener("click", async () => {
  if (!state.modalItem) return;
  const ok = await copyToClipboard(state.modalItem);
  if (ok) toast("Copied");
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
    if (visible[idx]) primaryAction(visible[idx], categorize(visible[idx]));
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
  applyTheme(state.settings.theme);
  render();
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
          return await addItem({
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
        if ((ci.types || []).includes("text/plain")) {
          const blob = await ci.getType("text/plain");
          const txt = await blob.text();
          if (txt && txt.trim()) {
            return await addItem({ kind: "text", text: txt, source: sourceLabel, ts: Date.now() });
          }
        }
      }
    }
  } catch { /* fall through to readText */ }

  try {
    const txt = await navigator.clipboard.readText();
    if (txt && txt.trim()) {
      return await addItem({ kind: "text", text: txt, source: sourceLabel, ts: Date.now() });
    }
  } catch {}
  return null;
}

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
