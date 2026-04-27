# Clipboard — Refined Clipboard History

A Chrome extension that captures your last *N* copies — text, links, images,
code, colors — and presents them in a polished, refined UI. Comes with a
local Node + SQLite **sync server** so your clipboard follows you across
browsers and machines.

> Designed to feel polished and native: system fonts, frosted-glass surfaces,
> a smooth squircle icon, spring animations, system-aware light/dark mode.

---

## Highlights

- **Refined visual language** — squircle app icon, frosted-glass popup,
  segmented controls, rounded toggle switches, springy easing curves
  (`cubic-bezier(0.32, 0.72, 0, 1)`), full light/dark/auto theming.
- **Smart type detection** — links, emails, phone numbers, hex colors, code
  snippets, and images each render with a distinct icon, color, and
  type-specific UI (favicon for links, color swatch for hex codes,
  image thumbnail with full-size expand, etc.).
- **Configurable history** — keep the last 3–50 copies. Pin items to keep them
  forever. Quick-paste any visible item with the **1–9** number keys.
- **Edit & expand** — click the expand button to see the full text or image,
  edit text in-place, view image dimensions/size.
- **Search & filter** — `⌘K` to focus search, filter pills for All / Text /
  Links / Images / Code / Pinned.
- **Privacy-first** — capture pause, per-domain blocklist, optional sync.
  Sync token is opaque and per-device.
- **Cross-device sync** — Node + Express + SQLite (WAL) backend.
  Anonymous device registration, bearer-token auth, debounced push, periodic pull.
- **Manifest V3** — service worker + content scripts, no remote code,
  no analytics.

---

## Project layout

```
clipboard_project/
├── extension/              ← Load this in chrome://extensions
│   ├── manifest.json
│   ├── popup/              ← The toolbar popup
│   ├── options/            ← Full settings page
│   ├── background/         ← MV3 service worker
│   ├── content/            ← Per-tab copy listener
│   ├── lib/                ← Shared modules + design tokens
│   └── icons/              ← Generated PNGs + generate.py
├── server/                 ← Optional sync server
│   ├── server.js
│   ├── db.js
│   └── package.json
├── scripts/
│   └── build.sh            ← Produces dist/clipboard-<version>.zip
├── PUBLISHING.md           ← Step-by-step Chrome Web Store guide
├── STORE_LISTING.md        ← Copy-pasteable store listing copy
├── PERMISSIONS.md          ← Permission justifications for review
├── PRIVACY.md              ← Privacy policy (host this publicly)
├── SCREENSHOTS.md          ← Capture guide for store screenshots
├── CHANGELOG.md
└── LICENSE
```

---

## Install the extension

1. Open `chrome://extensions` (or Edge / Brave equivalent).
2. Toggle **Developer mode** on (top right).
3. Click **Load unpacked** and select `clipboard_project/extension/`.
4. Pin the extension to your toolbar.
5. Press `Option + Shift + V` (`Alt + Shift + V` on Win/Linux) to open it any time.

That's it — start copying. Your last 5 items will appear in the popup.

> Want to publish it to the Chrome Web Store? See **[PUBLISHING.md](PUBLISHING.md)**
> for the full checklist, build command, and listing copy.

---

## Run the sync server (optional)

The extension is fully functional offline. Enable sync only if you want your
history to follow you across browsers.

```bash
cd server
npm install
npm start
# → Clipboard sync server listening on http://localhost:8787
```

In the extension:

1. Click the gear icon in the popup → opens Settings.
2. Under **Sync across devices**:
   - Toggle **Enable sync** on.
   - Set the server URL (default `http://localhost:8787`).
   - Click **Test connection** — should turn green.
3. Click **Sync now** — your token is auto-generated and saved on first sync.

To sync between two browsers, copy the token from one (Settings → reveal token
via `chrome.storage.sync` or simply set the same URL/token on both — see
[`docs/multi-device.md`](#multi-device-sync) below).

---

## Multi-device sync

Each install gets its own anonymous bearer token. To share history:

1. Run the server somewhere both devices can reach (e.g. a Tailscale node).
2. On Device A, enable sync. The extension calls
   `POST /api/auth/register` and stores the returned token in
   `chrome.storage.sync`.
3. On Device B, paste the same token into Settings (or open the same Chrome
   profile, since `chrome.storage.sync` syncs settings across signed-in
   browsers automatically).

> Sync round-trip happens every minute via `chrome.alarms`, plus debounced
> pushes within 800 ms of any new copy.

---

## Settings reference

| Setting | Default | Notes |
|---|---|---|
| Enable capture | on | Master switch. |
| History size | 5 | 3–50. Pinned items don't count toward the cap. |
| Capture images | on | When on, images become base64 data URLs. |
| Show capture badge | off | Briefly highlights the toolbar icon on each copy. |
| Theme | Auto | Auto / Light / Dark. |
| Sync enabled | off | Turn on once your server is reachable. |
| Server URL | `http://localhost:8787` | Change to point at your own server. |
| Capture on websites | on | Turn off to use only the popup's manual capture. |
| Blocked domains | empty | One per line. Subdomains included. |

---

## Demo script (60 seconds)

Use this to walk through the extension at the hackathon:

1. **Open the popup.** Show the empty state and the "last 5 copies appear here"
   subtitle.
2. **Copy a few things** from any tab:
   - A normal sentence
   - A URL like `https://en.wikipedia.org/wiki/Clipboard_(computing)`
   - An email like `you@work-domain.com`
   - A hex color like `#0a84ff`
   - A code snippet with at least 2 lines and a `function`/`const` keyword
   - Right-click an image → **Copy image**
3. **Re-open the popup.** All six show with distinct icons + type tags.
4. **Press `1`** — the first item is copied back. **Click another card** — same.
5. **Click the expand icon** on the link — favicon + URL preview appears.
6. **Click expand on the color** — full color swatch with hex + RGB.
7. **Click expand on the image** — full preview with dimensions.
8. **Click expand on text → "Edit"** — modify text, click Save, watch it
   update in place.
9. **Press `⌘K`** — search filters live as you type.
10. **Open Settings** — show the rounded toggle switches, theme segmented control,
    and the sync section. **Click Test connection** (with the server running)
    → green check.
11. **Toggle theme** to Dark — entire UI adapts instantly.

---

## Architecture notes

- **Capture path.** The content script (`content/content.js`) listens for
  `copy`/`cut` events on every page in the capture phase. For images it pulls
  the file from `clipboardData.items`, base64-encodes it, and reads dimensions.
  For text it prefers `clipboardData.getData("text/plain")` and falls back to
  the active selection.
- **Storage.** Items live in `chrome.storage.local` (per-device, larger quota);
  settings live in `chrome.storage.sync` (auto-syncs with the user's Chrome
  profile). Items are deduped by content + recency.
- **Service worker.** MV3 service workers are ephemeral, so the worker only
  reacts to messages and `chrome.alarms`. State lives in `chrome.storage`.
- **Sync.** Bearer-token auth. `POST /api/items` upserts and returns the
  reconciled list in one round-trip; `GET /api/items?since=` supports
  incremental pulls. The DB uses `INSERT … ON CONFLICT … WHERE excluded.ts >=
  items.ts` so an out-of-order push from a slow client never overwrites a
  newer state.
- **Privacy.** No third-party analytics, no remote code. Sync is opt-in. The
  blocklist is enforced in the service worker before storage.

---

## Regenerating icons

```bash
cd extension/icons
python3 generate.py        # writes icon-16.png, icon-48.png, icon-128.png
```

The generator draws a smooth squircle with a diagonal blue→indigo gradient,
a soft inner top highlight, a clipboard glyph, and a subtle drop shadow.
Renders at 4× and downscales for crisp anti-aliased corners.

---

## Roadmap

- Optional E2E encryption for synced items.
- Keyboard-only quick-paste overlay mode (`⌘⇧V` opens a centered overlay).
- Tap-and-hold preview, tap to paste.

---

## License

MIT.
