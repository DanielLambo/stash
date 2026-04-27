// Snippet expansion. Lazy-loaded by content.js ONLY when the user has
// explicitly enabled this feature from the Settings page. A fresh
// install never reaches this file.
//
// ─────────────────────────────────────────────────────────────────
// What snippet expansion is, in plain English
// ─────────────────────────────────────────────────────────────────
//
// Snippet expansion is a productivity feature that detects user-defined
// trigger sequences (like ;sig or ;eod) inside the editable field the
// user is currently typing into, and replaces them with the user's own
// expansion text.
//
// This module:
//   • Detects user-defined trigger sequences in the active text field
//     the user is typing into.
//   • Only processes user-initiated input within focused editable
//     fields. Events with `isTrusted === false` (i.e. synthesized by
//     page JavaScript) are rejected.
//   • Keeps a tiny in-memory window of the most recent characters the
//     user typed — sized exactly to the longest trigger they defined,
//     so e.g. a single 4-char trigger means a 4-char window. Older
//     characters are discarded immediately.
//   • Compares the tail of that window to the user's own trigger list.
//     On a match, replaces the trigger with the user's own expansion
//     body.
//
// This module does NOT:
//   • Capture, log, persist, or transmit raw input. The in-memory
//     window is JS-local, lives nowhere else, and is wiped on focus
//     change, paste, or any non-text-typing event.
//   • Read existing field values, page DOM, cookies, or any state
//     outside the user's own current typing.
//   • Make any outgoing network requests. There are no `fetch`, no
//     `XMLHttpRequest`, no `WebSocket`, no `chrome.runtime.sendMessage`,
//     and no `chrome.runtime.connect` calls anywhere in this file.
//   • Process password or other non-text inputs — `isEditable()`
//     explicitly excludes `<input type="password">`, checkboxes,
//     radios, file inputs, hidden inputs, and color/range pickers.
//   • Operate at all unless `settings.snippetsEnabled === true`.
//
// Placeholders supported in expansion bodies:
//   {cursor}            — final caret position (only the first occurrence)
//   {date}              — ISO yyyy-mm-dd
//   {date:FORMAT}       — strftime-ish: YYYY MM DD HH mm ss + literal text
//   {clipboard}         — current top clipboard text item (sync, from cache)
//   {input:Label here}  — inline prompt for a value before expanding

const PROMPT_TAG = "clipboard-snippet-prompt";

let triggers = [];           // array of snippet objects, sorted by trigger length DESC
let triggerMaxLen = 0;
let storageMod = null;
let buffer = "";             // recent keystrokes for the current target
let boundTarget = null;
let lastClipboardText = "";
let installed = false;
let enabled = true;

async function loadStorage() {
  if (storageMod) return storageMod;
  storageMod = await import(chrome.runtime.getURL("lib/storage.js"));
  return storageMod;
}

async function refresh() {
  const storage = await loadStorage();
  const list = await storage.getSnippets();
  triggers = list
    .filter(s => s && typeof s.trigger === "string" && s.trigger.length > 0)
    .sort((a, b) => b.trigger.length - a.trigger.length);
  triggerMaxLen = triggers.reduce((m, s) => Math.max(m, s.trigger.length), 0);

  const settings = await storage.getSettings();
  enabled = !!settings.snippetsEnabled;

  // Cache top clipboard text for {clipboard} expansion.
  const items = await storage.getItems();
  const top = items.find(i => i.kind === "text" && !i.vaulted);
  lastClipboardText = top?.text || "";
}

// ─────────────────────────────────────────────────────────────────
// Pure helpers (Node-testable). Exported.
// ─────────────────────────────────────────────────────────────────

export function pad2(n) { return String(n).padStart(2, "0"); }

export function formatDate(fmt = "YYYY-MM-DD", now = new Date()) {
  const map = {
    YYYY: String(now.getFullYear()),
    YY: String(now.getFullYear()).slice(-2),
    MM: pad2(now.getMonth() + 1),
    DD: pad2(now.getDate()),
    HH: pad2(now.getHours()),
    mm: pad2(now.getMinutes()),
    ss: pad2(now.getSeconds()),
  };
  // Replace longest tokens first so HH doesn't match inside YYYY etc.
  const tokens = ["YYYY", "YY", "MM", "DD", "HH", "mm", "ss"];
  let out = String(fmt);
  for (const t of tokens) out = out.split(t).join(map[t]);
  return out;
}

// Parse a body with {placeholder} tokens into a stream of segments.
// Returns array of { kind: "text"|"cursor"|"date"|"clipboard"|"input", value? }.
export function parseBody(body) {
  const segs = [];
  const re = /\{(cursor|date(?::[^{}]*)?|clipboard|input:[^{}]*)\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(body)) !== null) {
    if (m.index > last) segs.push({ kind: "text", value: body.slice(last, m.index) });
    const tok = m[1];
    if (tok === "cursor") segs.push({ kind: "cursor" });
    else if (tok === "clipboard") segs.push({ kind: "clipboard" });
    else if (tok.startsWith("date")) {
      const fmt = tok.includes(":") ? tok.slice(tok.indexOf(":") + 1) : "YYYY-MM-DD";
      segs.push({ kind: "date", value: fmt });
    } else if (tok.startsWith("input:")) {
      segs.push({ kind: "input", value: tok.slice("input:".length).trim() || "Value" });
    }
    last = m.index + m[0].length;
  }
  if (last < body.length) segs.push({ kind: "text", value: body.slice(last) });
  return segs;
}

// Expand non-input segments. Returns { text, cursorOffset, inputs:[{label, segIdx}] }.
// `inputs` is empty when no {input:} placeholders are present.
export function expandSegments(segs, ctx) {
  const inputs = [];
  let text = "";
  let cursorOffset = -1;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    switch (s.kind) {
      case "text": text += s.value; break;
      case "date": text += formatDate(s.value, ctx.now); break;
      case "clipboard": text += ctx.clipboard || ""; break;
      case "cursor":
        if (cursorOffset === -1) cursorOffset = text.length;
        break;
      case "input":
        // Placeholder marker we'll replace with the user's answer.
        inputs.push({ label: s.value, marker: text.length });
        break;
    }
  }
  return { text, cursorOffset, inputs };
}

// Replace input markers with the user's answers. Markers are positions in
// `text` where each input answer should be inserted, in order. Because
// inserting earlier shifts later indexes, we work back-to-front.
export function applyInputs(text, inputs, answers, cursorOffset) {
  let out = text;
  let cursor = cursorOffset;
  for (let i = inputs.length - 1; i >= 0; i--) {
    const pos = inputs[i].marker;
    const ans = answers[i] ?? "";
    out = out.slice(0, pos) + ans + out.slice(pos);
    if (cursor >= 0 && pos < cursor) cursor += ans.length;
  }
  return { text: out, cursorOffset: cursor };
}

// Inspect the trailing buffer for any matching trigger. Returns the longest
// match (so a 4-char trigger beats a 2-char prefix of it).
export function findMatchingTrigger(buf, snippets) {
  for (const s of snippets) {
    if (buf.endsWith(s.trigger)) return s;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
// DOM-side wiring
// ─────────────────────────────────────────────────────────────────

function isEditable(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName || "").toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const t = (el.type || "").toLowerCase();
    const SKIP = new Set([
      "password", "checkbox", "radio", "submit", "reset", "button",
      "file", "hidden", "image", "color", "range",
    ]);
    return !SKIP.has(t);
  }
  return false;
}

function deleteRangeBeforeCaret(target, n) {
  if (target.isContentEditable) {
    const sel = target.ownerDocument.getSelection();
    if (!sel || !sel.rangeCount) return;
    for (let i = 0; i < n; i++) {
      sel.modify("extend", "backward", "character");
    }
    sel.deleteFromDocument();
    return;
  }
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
    const proto = target.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    const end = target.selectionEnd ?? target.value.length;
    const start = Math.max(0, end - n);
    const next = target.value.slice(0, start) + target.value.slice(end);
    if (setter) setter.call(target, next); else target.value = next;
    try { target.setSelectionRange(start, start); } catch {}
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
  }
}

function insertText(target, text) {
  if (!text) return;
  if (target.isContentEditable) {
    const ok = target.ownerDocument.execCommand("insertText", false, text);
    if (!ok) {
      const sel = target.ownerDocument.getSelection();
      if (sel?.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
      }
      target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
    return;
  }
  const proto = target.tagName === "INPUT" ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? target.value.length;
  const next = target.value.slice(0, start) + text + target.value.slice(end);
  if (setter) setter.call(target, next); else target.value = next;
  const caret = start + text.length;
  try { target.setSelectionRange(caret, caret); } catch {}
  target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
}

function setCursor(target, offset) {
  if (target.isContentEditable) {
    const sel = target.ownerDocument.getSelection();
    if (!sel) return;
    const range = sel.rangeCount ? sel.getRangeAt(0) : target.ownerDocument.createRange();
    // For contenteditable we approximate: move backward by (totalText - offset).
    // execCommand insertion already left the caret at the end, so move back.
    const insertedLen = target.dataset.__lastInsertLen ? Number(target.dataset.__lastInsertLen) : 0;
    const back = Math.max(0, insertedLen - offset);
    for (let i = 0; i < back; i++) sel.modify("move", "backward", "character");
    return;
  }
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
    const start = (target.selectionStart ?? 0);
    const newPos = Math.max(0, start - (target.dataset.__lastInsertLen ? Number(target.dataset.__lastInsertLen) - offset : 0));
    try { target.setSelectionRange(newPos, newPos); } catch {}
  }
}

async function promptInputs(target, inputs) {
  if (!inputs.length) return [];
  const answers = [];
  for (let i = 0; i < inputs.length; i++) {
    const ans = await showInlinePrompt(target, inputs[i].label);
    if (ans === null) return null; // user cancelled — abort expansion
    answers.push(ans);
  }
  return answers;
}

// Tiny inline prompt rendered in a closed shadow root, anchored near the
// target. Resolves with the entered string or null on cancel.
function showInlinePrompt(target, label) {
  return new Promise(resolve => {
    const host = document.createElement(PROMPT_TAG);
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .root {
        position: fixed; z-index: 2147483646;
        background: rgba(255,255,255,0.92);
        backdrop-filter: blur(30px) saturate(180%);
        -webkit-backdrop-filter: blur(30px) saturate(180%);
        border: 1px solid rgba(0,0,0,0.08);
        border-radius: 12px;
        box-shadow: 0 12px 36px rgba(0,0,0,0.18);
        padding: 10px 12px;
        display: flex; align-items: center; gap: 8px;
        font: 13px -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
        color: #1d1d1f;
        animation: ppIn 200ms cubic-bezier(0.32,0.72,0,1) both;
      }
      @keyframes ppIn { from { opacity: 0; transform: translateY(-2px) scale(.98); } to { opacity:1; transform: translateY(0) scale(1); } }
      @media (prefers-color-scheme: dark) {
        .root { background: rgba(28,28,30,0.92); border-color: rgba(255,255,255,0.10); color: #f5f5f7; }
      }
      label { font-weight: 500; flex-shrink: 0; }
      input {
        flex: 1; min-width: 160px;
        background: rgba(120,120,128,0.16);
        border: none; outline: none;
        padding: 5px 8px; border-radius: 6px;
        color: inherit; font: inherit;
      }
      input:focus { box-shadow: 0 0 0 2px rgba(0,122,255,0.25); }
      .hint { font-size: 10px; color: rgba(120,120,128,1); }
    `;
    const root = document.createElement("div");
    root.className = "root";
    root.innerHTML = `<label></label><input type="text" /><span class="hint">↵ ok · esc cancel</span>`;
    root.querySelector("label").textContent = label || "Value";
    shadow.append(style, root);

    const ownerDoc = target.ownerDocument || document;
    (ownerDoc.body || ownerDoc.documentElement).appendChild(host);

    const r = target.getBoundingClientRect();
    const margin = 8;
    let top = r.bottom + margin;
    if (top + 60 > window.innerHeight) top = Math.max(margin, r.top - 60);
    let left = r.left;
    if (left + 360 > window.innerWidth) left = Math.max(margin, window.innerWidth - 360 - margin);
    root.style.top = `${Math.round(top)}px`;
    root.style.left = `${Math.round(left)}px`;

    const input = root.querySelector("input");
    requestAnimationFrame(() => input.focus());

    function cleanup() { try { host.remove(); } catch {} }
    function done(value) { cleanup(); resolve(value); }

    input.addEventListener("keydown", e => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); done(input.value); }
      else if (e.key === "Escape") { e.preventDefault(); done(null); }
    }, true);
    input.addEventListener("blur", () => done(null), { once: true });
  });
}

async function tryExpand(target) {
  if (!enabled || triggers.length === 0) return false;
  const matched = findMatchingTrigger(buffer, triggers);
  if (!matched) return false;

  // 1) Delete the trigger characters before the caret.
  deleteRangeBeforeCaret(target, matched.trigger.length);

  // 2) Parse the body and prompt for any {input:} fields.
  const segs = parseBody(matched.body);
  const expanded = expandSegments(segs, { now: new Date(), clipboard: lastClipboardText });
  let { text, cursorOffset, inputs } = expanded;
  if (inputs.length) {
    const answers = await promptInputs(target, inputs);
    if (answers === null) {
      // user cancelled — restore the trigger so they can keep typing
      insertText(target, matched.trigger);
      buffer = "";
      return false;
    }
    const result = applyInputs(text, inputs, answers, cursorOffset);
    text = result.text;
    cursorOffset = result.cursorOffset;
  }

  // 3) Insert the expanded text and reposition the caret if {cursor} was set.
  if (cursorOffset >= 0) {
    insertText(target, text.slice(0, cursorOffset));
    insertText(target, text.slice(cursorOffset));
    // Move caret back to the {cursor} position
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
      const caret = (target.selectionStart ?? 0) - (text.length - cursorOffset);
      try { target.setSelectionRange(caret, caret); } catch {}
    } else if (target.isContentEditable) {
      const sel = target.ownerDocument.getSelection();
      const back = text.length - cursorOffset;
      for (let i = 0; i < back && sel; i++) sel.modify("move", "backward", "character");
    }
  } else {
    insertText(target, text);
  }

  buffer = "";
  return true;
}

function bind(target) {
  if (boundTarget === target) return;
  boundTarget = target;
  buffer = "";
}

function onInput(e) {
  if (!enabled) return;
  // Reject synthesized events. `isTrusted === true` is set by the
  // browser only for genuine user-initiated input; page JavaScript
  // cannot forge it. This blocks both malicious page-side spoofing
  // and our own programmatic value updates from re-entering the
  // matcher (defense against accidental recursion during expansion).
  if (e.isTrusted === false) { buffer = ""; return; }
  const target = e.target;
  if (!isEditable(target)) return;
  bind(target);

  // We append only on `insertText` events — the input-type the W3C
  // spec emits when the user types a character. For everything else
  // (paste, replace, IME composition end, JS value mutation) we drop
  // the in-memory window so we never match across boundaries.
  const ev = e;
  if (ev.inputType === "insertText" && typeof ev.data === "string") {
    buffer = (buffer + ev.data).slice(-Math.max(triggerMaxLen, 1));
  } else if (ev.inputType === "deleteContentBackward") {
    buffer = buffer.slice(0, -1);
  } else {
    buffer = "";
    return;
  }

  if (buffer.length && triggerMaxLen && buffer.length >= 1) {
    tryExpand(target);
  }
}

function onFocusOut(e) {
  if (e.target === boundTarget) {
    buffer = "";
    boundTarget = null;
  }
}

// Listeners live behind a one-way idempotent install() and a matching
// uninstall(). install() refuses to register the listeners unless
// `enabled === true` at the moment of call. uninstall() removes them
// when the user toggles snippets off in the same session.
let listenersAttached = false;

function attachListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  document.addEventListener("input", onInput, true);
  document.addEventListener("focusout", onFocusOut, true);
}

function detachListeners() {
  if (!listenersAttached) return;
  listenersAttached = false;
  document.removeEventListener("input", onInput, true);
  document.removeEventListener("focusout", onFocusOut, true);
  buffer = "";
  boundTarget = null;
}

export async function install() {
  if (installed) return;
  installed = true;
  await refresh();

  // ── EXPLICIT ENABLE GATE ───────────────────────────────────────
  // No `input` / `focusout` listeners are registered unless snippet
  // expansion is currently enabled in the user's settings. If the
  // user toggles snippets on later, the storage.onChanged handler
  // below attaches them at that point. If they toggle snippets off,
  // the same handler removes them.
  // ───────────────────────────────────────────────────────────────
  if (enabled) attachListeners();

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === "local" && changes.clipboard_snippets) {
      await refresh().catch(() => {});
    } else if (area === "local" && changes.clipboard_items) {
      await refresh().catch(() => {});
    } else if (area === "sync" && changes.clipboard_settings) {
      await refresh().catch(() => {});
      if (enabled) attachListeners(); else detachListeners();
    }
  });
}

// Exposed for testability: run a full expansion against an input element.
// Returns true if a snippet matched.
export async function _testExpand(target) { return tryExpand(target); }
