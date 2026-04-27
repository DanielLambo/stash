# Changelog

## 1.0.0 — 2026-04-26

Initial Chrome Web Store release.

### Added
- Clipboard history popup with smart type detection (text, links, emails,
  phones, colors, code, images).
- Configurable history size (3–50 items).
- Pin / unpin items; pinned items survive trimming.
- Quick-paste via number keys (1–9) and click-to-copy.
- ⌘K / Ctrl+K opens the search field; filter pills (All / Text / Links / Images /
  Code / Pinned).
- Expand modal with edit-in-place for text, full-size preview for images,
  hex / RGB readout for colors, favicon preview for links.
- Settings page with iOS-style toggles, segmented theme control, sync
  configuration, blocklist, JSON export, clear-all.
- Optional Node + SQLite sync server with bearer-token auth.
- Light / Dark / Auto themes; system-aware glass surfaces.
- Polished icon (squircle gradient) at 16/48/128 px.

### Bug-fixes / hardening (pre-publication pass)
- Trimmed manifest permissions: removed unused `activeTab`, `scripting`,
  broad `host_permissions`, and `web_accessible_resources`.
- Added `unlimitedStorage` permission so image data URLs survive the
  default 5 MB `chrome.storage.local` quota.
- Changed open shortcut from `Cmd+Shift+V` (conflicts with macOS
  Paste-and-Match) to `Alt+Shift+V`.
- Image re-copy now converts to PNG, the only image format the W3C
  Clipboard API guarantees.
- Sync now only advances the `lastSync` watermark on a successful pull,
  and persists `clipboard_last_sync_error` for surfaced errors.
- Service worker re-arms its alarm on `onStartup` as well as `onInstalled`.
- Image data URLs above ~5 MB are rejected at storage time to keep
  storage bounded.
- Modal-edit save handles the case where the underlying item was removed
  during the edit.
- Link cards validate the URL with `new URL()` before opening to avoid
  exceptions on malformed input.
- Card text and metadata rows now have `min-width: 0` so long single-line
  text truncates with ellipsis instead of overflowing siblings.
- Image-from-clipboard extraction now tries three paths: file blob in
  `clipboardData.items`, `<img src>` parsing of copied HTML, and
  `<img>` element walk on the active selection.
- Content script now runs in iframes (`all_frames: true`) so copies
  inside embeds are captured.
