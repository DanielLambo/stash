// Content script. Runs in every frame (manifest: all_frames: true).
//
// ─────────────────────────────────────────────────────────────────
// SAFETY MODEL — what this script does and does not do
// ─────────────────────────────────────────────────────────────────
//
// NO AUTOMATIC DATA COLLECTION OCCURS.
// NO BACKGROUND PAGE SCRAPING.
//
// All behavior in this file is gated on a verifiable user-initiated
// action:
//
//   1) The clipboard save path runs ONLY when the user themselves
//      triggers a `copy` or `cut` action on the page. We additionally
//      reject events with `isTrusted === false` (i.e. events
//      synthesized by page JavaScript), so a malicious page cannot
//      cause Stash to record anything the user did not actually copy.
//
//   2) The inline-paste HUD activates ONLY when the user presses the
//      Stash shortcut (Cmd/Ctrl+Shift+V) inside an editable field.
//      `isTrusted` is checked here as well.
//
//   3) The snippet-expansion module is lazy-loaded ONLY if the user
//      has explicitly enabled it in Settings. A fresh install never
//      reaches that file. The module itself does not persist any
//      input data; see content/snippet.js for full details.
//
// What this script cannot do (audit the file to verify):
//   • It does not read the page's DOM, form values, cookies,
//     localStorage, request bodies, or any state outside the user's
//     own clipboard or typing actions.
//   • It makes no outgoing network requests. There are no `fetch`,
//     no XHR, no `chrome.scripting`, no `chrome.tabs.*` calls in
//     this file, and the manifest grants no `host_permissions` or
//     `scripting` permission that would enable them elsewhere.
//   • It does not run on `chrome://`, `chrome-extension://`, the
//     Web Store, or other restricted URLs — Chrome enforces this.
(function () {
  if (window.__clipboardCaptureInstalled) return;
  window.__clipboardCaptureInstalled = true;

  const HOST = (() => {
    try { return location.hostname || "page"; } catch { return "page"; }
  })();

  const IS_MAC = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || "");

  // ─────────────────────────────────────────────────────────────────
  // Capture path (existing behavior)
  // ─────────────────────────────────────────────────────────────────

  function send(payload) {
    try {
      chrome.runtime.sendMessage({ type: "capture", payload }, () => void chrome.runtime.lastError);
    } catch {}
  }

  function imageFileFromItems(items) {
    if (!items) return null;
    for (const it of items) {
      if (it.kind === "file" && it.type && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) return f;
      }
    }
    return null;
  }

  function imageSrcFromHtml(html) {
    if (!html) return null;
    const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    return m ? m[1] : null;
  }

  function imageSrcFromSelection() {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const range = sel.getRangeAt(0);
      const frag = range.cloneContents();
      const img = frag.querySelector && frag.querySelector("img");
      return img?.src || null;
    } catch {
      return null;
    }
  }

  async function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  // Re-encode an image data URL through a 2D canvas as PNG. PNG cannot
  // store EXIF, so this strips GPS coordinates, camera serial numbers,
  // and any other metadata that may have been embedded in the source
  // (e.g. when the user copies a photo). Returns the original on
  // decode failure (so a corrupted clipboard never breaks capture).
  async function stripImageMetadata(dataUrl) {
    if (!dataUrl || !dataUrl.startsWith("data:image/")) return dataUrl;
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error("decode failed"));
        i.src = dataUrl;
      });
      const w = img.naturalWidth | 0, h = img.naturalHeight | 0;
      if (!w || !h) return dataUrl;
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL("image/png");
    } catch {
      return dataUrl;
    }
  }

  // Local-only: accept inline `data:` URLs, refuse everything else.
  // Earlier drafts fetched external image URLs here; that has been
  // removed so the extension makes ZERO outgoing network requests
  // outside the user's own optional sync server. Image capture for the
  // common "Copy image" right-click case continues to work via the
  // file-blob path below (`imageFileFromItems` → `fileToDataUrl`).
  async function urlToDataUrl(url) {
    if (!url) return null;
    if (url.startsWith("data:")) return url;
    return null;
  }

  async function imageDimensions(dataUrl) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ w: 0, h: 0 });
      img.src = dataUrl;
    });
  }

  async function tryExtractImage(e) {
    let raw = null;

    const file = imageFileFromItems(e.clipboardData?.items);
    if (file) raw = await fileToDataUrl(file);

    if (!raw) {
      const html = e.clipboardData?.getData("text/html");
      const htmlSrc = imageSrcFromHtml(html);
      if (htmlSrc) raw = await urlToDataUrl(htmlSrc);
    }

    if (!raw) {
      const selSrc = imageSrcFromSelection();
      if (selSrc) raw = await urlToDataUrl(selSrc);
    }

    if (!raw) return null;
    // Always re-encode through canvas → PNG to strip EXIF / GPS /
    // any other metadata before the image enters our pipeline.
    return await stripImageMetadata(raw);
  }

  async function handleCopy(e) {
    // Defense in depth: only act on real user-initiated copy/cut
    // events. `isTrusted` is set by the browser and cannot be forged
    // from page JS, so this rejects programmatic copy events that
    // the user did not initiate.
    if (!e || e.isTrusted === false) return;
    try {
      const dataUrl = await tryExtractImage(e);
      if (dataUrl) {
        const { w, h } = await imageDimensions(dataUrl);
        send({ kind: "image", dataUrl, width: w, height: h, source: HOST, ts: Date.now() });
        return;
      }
      let text = e.clipboardData?.getData("text/plain") || "";
      if (!text) text = (window.getSelection()?.toString() || "");
      if (!text || !text.trim()) return;
      send({ kind: "text", text, source: HOST, ts: Date.now() });
    } catch {
      // never break the page
    }
  }

  // Forwarded copy events are filtered by the service worker against the
  // user's settings (`enabled`, `capturePages`, per-domain blocklist)
  // before any storage write occurs.
  document.addEventListener("copy", handleCopy, true);
  document.addEventListener("cut", handleCopy, true);

  // ─────────────────────────────────────────────────────────────────
  // HUD trigger
  // ─────────────────────────────────────────────────────────────────

  // Walk closed-over composed paths and shadow roots to find the truly
  // focused element. Native activeElement returns the shadow host when
  // focus is inside an open shadow root.
  function deepActive() {
    let el = document.activeElement;
    let guard = 0;
    while (el && el.shadowRoot && el.shadowRoot.activeElement && guard++ < 16) {
      el = el.shadowRoot.activeElement;
    }
    return el;
  }

  function isEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = (el.tagName || "").toUpperCase();
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
      const t = (el.type || "").toLowerCase();
      // Skip password and non-text input types — privacy critical.
      const SKIP = new Set([
        "password", "checkbox", "radio", "submit", "reset", "button",
        "file", "hidden", "image", "color", "range",
      ]);
      if (SKIP.has(t)) return false;
      return true;
    }
    return false;
  }

  // Cmd+Shift+V on Mac, Ctrl+Shift+V elsewhere.
  function isHudTrigger(e) {
    const meta = IS_MAC ? e.metaKey : e.ctrlKey;
    if (!meta || !e.shiftKey || e.altKey) return false;
    const k = (e.key || "").toLowerCase();
    return k === "v";
  }

  let hudModule = null;
  async function loadHud() {
    if (hudModule) return hudModule;
    try {
      hudModule = await import(chrome.runtime.getURL("content/hud.js"));
    } catch {
      hudModule = null;
    }
    return hudModule;
  }

  document.addEventListener("keydown", async (e) => {
    // Only respond to genuine user keystrokes, not synthesized ones.
    if (!e.isTrusted) return;
    if (!isHudTrigger(e)) return;
    const target = deepActive();
    if (!isEditable(target)) return;
    // We're committed to the HUD now — preventDefault before the async
    // import so the browser doesn't run paste-and-match in the meantime.
    e.preventDefault();
    e.stopPropagation();
    const mod = await loadHud();
    if (mod && !mod.isOpen()) mod.open(target);
  }, true);

  // ─────────────────────────────────────────────────────────────────
  // Snippet expander — opt-in.
  //
  // SAFETY: We do not register *any* `input` listeners on the page until
  // the user has explicitly enabled snippet expansion from the options
  // page. This means: a fresh install never observes typing. The module
  // itself only inspects the trailing N characters where N = the longest
  // user-defined trigger length, never persists keystroke data, and
  // never transmits anything off-device. See content/snippet.js for the
  // full design notes.
  // ─────────────────────────────────────────────────────────────────
  let snippetInstalled = false;
  async function ensureSnippetExpanderIfEnabled() {
    if (snippetInstalled) return;
    try {
      const storage = await import(chrome.runtime.getURL("lib/storage.js"));
      const s = await storage.getSettings();
      if (!s.snippetsEnabled) return;
      const mod = await import(chrome.runtime.getURL("content/snippet.js"));
      mod.install();
      snippetInstalled = true;
    } catch {
      // Snippet expander failed to load — capture path is unaffected.
    }
  }
  ensureSnippetExpanderIfEnabled();

  // If the user toggles snippet expansion on while a tab is open,
  // load the module without requiring a page reload. Toggling off
  // takes effect on the next reload (we cannot un-register a content
  // script from itself).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.clipboard_settings) {
      const next = changes.clipboard_settings.newValue;
      if (next?.snippetsEnabled) ensureSnippetExpanderIfEnabled();
    }
  });
})();
