// Quick-paste HUD overlay. Lazy-loaded by content.js when the user presses
// the trigger keystroke while a text-editable element is focused.
//
// Design notes:
// - Renders inside a shadow DOM with mode "closed" so the page can't even
//   reach in via document.querySelector("clipboard-quick-paste-hud").
// - Pulls clipboard items via the shared storage.js wrapper (no duplication).
// - Each iframe runs its own content.js, so the HUD opens within whichever
//   frame the user actually triggered from. We rely on document.body /
//   documentElement and viewport-relative coordinates, which are all
//   per-frame.
// - The original target element keeps focus state in our closure; the
//   search input inside the shadow root takes DOM focus while the HUD is
//   open. Closing returns focus to the original target before insertion.

const HOST_TAG = "clipboard-quick-paste-hud";
const Z_INDEX = 2147483646; // 1 below max so the page can still draw modals above if needed
const HUD_W = 360;
const HUD_MAX_H = 420;

let hudHost = null;
let shadow = null;
let listeners = [];

const state = {
  open: false,
  target: null,           // the editable element we'll insert into
  targetSelStart: null,   // saved selection in case the page steals focus
  targetSelEnd: null,
  items: [],              // text-only items
  filtered: [],
  selectedIdx: 0,
  query: "",
};

/** Mirrors popup type tokens so quick-paste rows match main UI semantics. */
const TYPE_TAG_COLORS = {
  text: "#8e8e93",
  link: "#007aff",
  email: "#ff9f0a",
  phone: "#30d158",
  color: "#af52de",
  code: "#ff2d55",
  image: "#5ac8fa",
};

let categorizeFn = null;
async function ensureCategorize() {
  if (!categorizeFn) {
    const mod = await import(chrome.runtime.getURL("lib/categorize.js"));
    categorizeFn = mod.categorize;
  }
  return categorizeFn;
}

const STYLES = `
  :host { all: initial; }
  *, *::before, *::after { box-sizing: border-box; }

  .root {
    position: fixed;
    z-index: ${Z_INDEX};
    width: ${HUD_W}px;
    max-height: ${HUD_MAX_H}px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.85);
    backdrop-filter: blur(40px) saturate(180%);
    -webkit-backdrop-filter: blur(40px) saturate(180%);
    border: 1px solid rgba(0, 0, 0, 0.08);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.08);
    color: #1d1d1f;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
    font-size: 13px;
    letter-spacing: -0.01em;
    -webkit-font-smoothing: antialiased;
    transform-origin: top left;
    animation: hudIn 220ms cubic-bezier(0.32, 0.72, 0, 1) both;
  }
  @keyframes hudIn {
    from { opacity: 0; transform: translateY(-4px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  @media (prefers-color-scheme: dark) {
    .root {
      background: rgba(28, 28, 30, 0.78);
      border-color: rgba(255, 255, 255, 0.10);
      color: #f5f5f7;
    }
  }

  .hdr {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(120, 120, 128, 0.18);
  }
  .hdr svg { width: 14px; height: 14px; opacity: 0.5; flex-shrink: 0; }
  .hdr input {
    flex: 1; min-width: 0;
    background: transparent; border: none; outline: none;
    color: inherit; font: inherit;
    padding: 0;
  }
  .hdr input::placeholder { color: rgba(120, 120, 128, 0.8); }
  .hdr .badge {
    font-size: 10px;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    color: rgba(120, 120, 128, 1);
    border: 1px solid rgba(120, 120, 128, 0.25);
    padding: 1px 5px;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 6px;
    min-height: 0;
  }
  .list::-webkit-scrollbar { width: 6px; }
  .list::-webkit-scrollbar-thumb { background: rgba(120, 120, 128, 0.35); border-radius: 3px; }

  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    cursor: pointer;
    user-select: none;
    transition: background 120ms ease;
  }
  .row[aria-selected="true"] {
    background: rgba(0, 122, 255, 0.16);
  }
  @media (prefers-color-scheme: dark) {
    .row[aria-selected="true"] { background: rgba(10, 132, 255, 0.22); }
  }
  .row .num {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 9px;
    width: 14px; height: 14px;
    border-radius: 4px;
    background: rgba(120, 120, 128, 0.18);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: rgba(120, 120, 128, 1);
    flex-shrink: 0;
  }
  .row .text {
    flex: 1; min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .row .tag {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
    flex-shrink: 0;
    max-width: 64px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  @media (prefers-color-scheme: dark) {
    .row .tag { opacity: 0.95; }
  }

  .empty {
    padding: 24px 16px;
    text-align: center;
    color: rgba(120, 120, 128, 1);
    font-size: 12px;
  }

  .ftr {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 10px;
    border-top: 1px solid rgba(120, 120, 128, 0.18);
    font-size: 10px;
    color: rgba(120, 120, 128, 1);
  }
  .ftr kbd {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    background: rgba(120, 120, 128, 0.18);
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 9px;
  }
`;

const SEARCH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;

function buildShadow() {
  hudHost = document.createElement(HOST_TAG);
  // closed mode = page scripts can't traverse into the shadow root
  shadow = hudHost.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = STYLES;

  const root = document.createElement("div");
  root.className = "root";
  root.innerHTML = `
    <div class="hdr">
      ${SEARCH_ICON}
      <input class="search" type="text" placeholder="Search clipboard…" autocomplete="off" spellcheck="false" />
      <span class="badge">↵ paste</span>
    </div>
    <div class="list" role="listbox"></div>
    <div class="ftr">
      <span><kbd>↑↓</kbd> nav · <kbd>↵</kbd> paste · <kbd>esc</kbd> close</span>
      <span class="count"></span>
    </div>
  `;
  shadow.append(style, root);
}

function getSearchEl() { return shadow.querySelector(".search"); }
function getListEl() { return shadow.querySelector(".list"); }
function getCountEl() { return shadow.querySelector(".count"); }
function getRoot() { return shadow.querySelector(".root"); }

// Shallow fuzzy: subsequence match (chars of query appear in order in text).
// Falls back gracefully to substring scoring; we don't need full FZF here.
export function fuzzyMatch(query, text) {
  if (!query) return { ok: true, score: 0 };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return { ok: true, score: 1000 - t.indexOf(q) };
  let qi = 0, ti = 0, lastMatch = -1, runs = 0, run = 0;
  while (qi < q.length && ti < t.length) {
    if (q[qi] === t[ti]) {
      if (lastMatch === ti - 1) run++; else { if (run > 1) runs += run; run = 1; }
      lastMatch = ti;
      qi++;
    }
    ti++;
  }
  if (qi !== q.length) return { ok: false, score: 0 };
  return { ok: true, score: 100 + runs * 5 - (t.length - q.length) * 0.1 };
}

function applyFilter() {
  const q = state.query.trim();
  if (!q) {
    state.filtered = state.items.slice();
  } else {
    const scored = [];
    for (const it of state.items) {
      const m = fuzzyMatch(q, it.text || "");
      if (m.ok) scored.push({ it, score: m.score });
    }
    scored.sort((a, b) => b.score - a.score);
    state.filtered = scored.map(s => s.it);
  }
  state.selectedIdx = state.filtered.length ? 0 : -1;
}

function renderList() {
  const list = getListEl();
  list.innerHTML = "";
  getCountEl().textContent = state.filtered.length
    ? `${state.filtered.length}/${state.items.length}` : "";

  if (!state.filtered.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = state.items.length === 0
      ? "No clipboard items yet."
      : "No matches.";
    list.appendChild(e);
    return;
  }

  state.filtered.forEach((item, idx) => {
    const row = document.createElement("div");
    row.className = "row";
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", idx === state.selectedIdx ? "true" : "false");
    row.dataset.idx = String(idx);

    if (idx < 9) {
      const num = document.createElement("span");
      num.className = "num";
      num.textContent = String(idx + 1);
      row.appendChild(num);
    }

    const txt = document.createElement("span");
    txt.className = "text";
    const single = (item.text || "").replace(/\s+/g, " ").slice(0, 240);
    txt.textContent = single;
    row.appendChild(txt);

    const cat = categorizeFn ? categorizeFn(item) : { type: "text", label: "Text" };
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = cat.label;
    tag.style.color = TYPE_TAG_COLORS[cat.type] || TYPE_TAG_COLORS.text;
    row.appendChild(tag);

    row.addEventListener("mouseenter", () => setSelected(idx, false));
    row.addEventListener("mousedown", e => { e.preventDefault(); paste(idx); });

    list.appendChild(row);
  });
}

function setSelected(idx, scroll = true) {
  if (idx < 0 || idx >= state.filtered.length) return;
  state.selectedIdx = idx;
  const rows = getListEl().querySelectorAll(".row");
  rows.forEach((r, i) => r.setAttribute("aria-selected", i === idx ? "true" : "false"));
  if (scroll) {
    const el = rows[idx];
    if (el) el.scrollIntoView({ block: "nearest" });
  }
}

function paste(idx = state.selectedIdx) {
  if (idx < 0 || idx >= state.filtered.length) return;
  const item = state.filtered[idx];
  const target = state.target;
  // Close BEFORE focus restoration so the search input doesn't fight focus.
  closeInternal();
  if (!target || !target.isConnected) return;
  try {
    target.focus({ preventScroll: false });
    if (state.targetSelStart != null && typeof target.setSelectionRange === "function") {
      try { target.setSelectionRange(state.targetSelStart, state.targetSelEnd); } catch {}
    }
    insertTextAtCursor(target, item.text || "");
  } catch { /* page may have removed the target */ }
}

// Robust insertion that works for React-controlled <input>/<textarea> and
// for contenteditable.
function insertTextAtCursor(el, text) {
  if (!text) return;
  if (el.isContentEditable) {
    // execCommand is technically "deprecated" but still the most reliable
    // way to insert into contenteditable while firing input events.
    const ok = document.execCommand("insertText", false, text);
    if (ok) return;
    // Fallback for browsers that returned false
    const sel = el.ownerDocument.getSelection();
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    return;
  }

  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    const proto = el.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    if (setter) setter.call(el, next); else el.value = next;
    const caret = start + text.length;
    try { el.setSelectionRange(caret, caret); } catch {}
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }
}

function positionNear(target) {
  const root = getRoot();
  const r = target.getBoundingClientRect();
  const margin = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Measure actual height after we filled content (max-height bounded).
  const actualH = Math.min(HUD_MAX_H, root.scrollHeight || HUD_MAX_H);

  let top = r.bottom + margin;
  if (top + actualH > vh - margin) {
    // Flip above
    top = r.top - actualH - margin;
    if (top < margin) {
      // Neither below nor above fits — pin to top of viewport
      top = margin;
    }
  }

  let left = r.left;
  if (left + HUD_W > vw - margin) left = vw - HUD_W - margin;
  if (left < margin) left = margin;

  root.style.top = `${Math.round(top)}px`;
  root.style.left = `${Math.round(left)}px`;
}

function reposition() {
  if (state.open && state.target?.isConnected) {
    positionNear(state.target);
  }
}

function onKeyDown(e) {
  if (!state.open) return;
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeInternal();
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    e.stopPropagation();
    setSelected(Math.min(state.filtered.length - 1, state.selectedIdx + 1));
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    e.stopPropagation();
    setSelected(Math.max(0, state.selectedIdx - 1));
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    e.stopPropagation();
    paste();
    return;
  }
  // 1–9 quick paste while search is empty
  if (!state.query && /^[1-9]$/.test(e.key)) {
    const idx = parseInt(e.key, 10) - 1;
    if (idx < state.filtered.length) {
      e.preventDefault();
      paste(idx);
    }
  }
}

function onSearchInput(e) {
  state.query = e.target.value;
  applyFilter();
  renderList();
}

function onDocMouseDown(e) {
  if (!state.open) return;
  // Click outside the shadow host closes the HUD.
  const path = e.composedPath ? e.composedPath() : [];
  if (!path.includes(hudHost)) closeInternal();
}

function closeInternal() {
  if (!state.open) return;
  state.open = false;
  if (hudHost?.parentNode) hudHost.parentNode.removeChild(hudHost);
  for (const [t, ev, fn, opts] of listeners) t.removeEventListener(ev, fn, opts);
  listeners.length = 0;
  state.target = null;
  state.targetSelStart = state.targetSelEnd = null;
  state.items = [];
  state.filtered = [];
  state.query = "";
  state.selectedIdx = 0;
}

function listen(target, ev, fn, opts) {
  target.addEventListener(ev, fn, opts);
  listeners.push([target, ev, fn, opts]);
}

export function close() { closeInternal(); }

export async function open(target) {
  if (state.open) return false;
  if (!target || !target.isConnected) return false;

  if (!hudHost) buildShadow();

  // Snapshot the target's selection so we can restore even if the browser
  // briefly clears it when our search input takes focus.
  state.target = target;
  state.targetSelStart = (typeof target.selectionStart === "number") ? target.selectionStart : null;
  state.targetSelEnd = (typeof target.selectionEnd === "number") ? target.selectionEnd : null;

  // Anchor in the same document the target lives in (handles iframes and
  // pages that swap document.body via SPA frameworks). Use documentElement
  // as a safer fallback if body hasn't rendered yet.
  const ownerDoc = target.ownerDocument || document;
  const container = ownerDoc.body || ownerDoc.documentElement;
  container.appendChild(hudHost);

  // Pull items via the shared storage wrapper — no logic duplicated.
  let items = [];
  try {
    const storage = await import(chrome.runtime.getURL("lib/storage.js"));
    await ensureCategorize();
    const all = await storage.getItems();
    // The HUD only handles text. Images can't be pasted into a text field.
    // Vaulted items are skipped here; the popup is the place to unlock them.
    items = all
      .filter(i => i.kind === "text" && !i.vaulted)
      .sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        return (b.ts || 0) - (a.ts || 0);
      });
  } catch (e) {
    items = [];
  }
  state.items = items;
  applyFilter();

  state.open = true;
  renderList();
  positionNear(target);
  // After rendering the actual list, recompute height once
  requestAnimationFrame(reposition);

  const search = getSearchEl();
  search.value = "";
  // Use capture-phase keydown so we run before page handlers.
  listen(shadow, "keydown", onKeyDown, true);
  listen(search, "input", onSearchInput, false);
  listen(document, "mousedown", onDocMouseDown, true);
  listen(window, "resize", reposition, false);
  listen(window, "scroll", reposition, true);

  // Defer focus to next frame so existing focus events settle first.
  requestAnimationFrame(() => search.focus());
  return true;
}

export function isOpen() { return state.open; }
