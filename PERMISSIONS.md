# Permissions — Stash

This document is written for two audiences:

1. **Chrome Web Store reviewers** evaluating whether the requested
   permissions are minimal and justified.
2. **Skeptical users** who want to verify the extension can't do more
   than it says.

For each permission we explain (a) why we need it, (b) what specifically
it lets us do, and (c) what it explicitly *does not* let us do.

`manifest.json` itself does not allow comments per the JSON spec, so the
justifications live here.

---

## What's in `manifest.json`

```jsonc
"permissions": [
  "storage",
  "clipboardRead",
  "clipboardWrite",
  "alarms",
  "unlimitedStorage"
]
```

No `host_permissions`. No `scripting`. No `tabs`. No `activeTab`. No
`webRequest`. No `cookies`. No `nativeMessaging`. Site access is
declared only via `content_scripts.matches: ["<all_urls>"]`.

---

## `storage`

**Why:** Stash needs somewhere to put your clipboard history, your
snippet rules, and your settings. We use Chrome's built-in
`chrome.storage` APIs — `local` for the items, `sync` for settings,
`session` (in-memory only) for the Vault unlock cache.

**What it lets the extension do:**
* Read and write its own storage area in the user's Chrome profile.
* Listen for changes to its own storage area.

**What it does NOT let the extension do:**
* Read or write any other extension's storage.
* Read or write any website's `localStorage`, `sessionStorage`,
  `IndexedDB`, or cookies.
* Read or write files on the user's disk.

---

## `clipboardRead`

**Why:** When you open the popup or click the "capture clipboard"
button, Stash reads the system clipboard one time. This is the only
way to record copies you made in another app (e.g. Finder) or on a
restricted page (`chrome://`). We use the modern
`navigator.clipboard.read()` API.

**What it lets the extension do:**
* Call `navigator.clipboard.read()` / `readText()` from extension UI
  contexts (popup, options page).

**What it does NOT let the extension do:**
* Read the clipboard from a content script on a web page.
* Poll the clipboard. The reads are explicitly user-triggered (popup
  open or capture-button click) — we did not write any setInterval /
  setTimeout polling and the manifest grants no `alarms` callback that
  would call this API.
* Read the clipboard from the service worker (Chrome blocks this; the
  SW has no DOM and no user gesture).

We considered moving this to `optional_permissions`, which would
remove the install-time prompt at the cost of a runtime permission
prompt the first time the user opens the popup. We kept it required
because (a) reading the clipboard *is* the core feature — the prompt
"Read data you copy and paste" matches user expectation for a
clipboard tool, and (b) post-install permission prompts are a worse
trust experience than disclosure at install.

---

## `clipboardWrite`

**Why:** When you click an item in the popup or press Enter in the
inline paste HUD, Stash writes that item back to the system clipboard
so you can paste it. We use `navigator.clipboard.writeText()` /
`write()`.

**What it lets the extension do:**
* Write text or an image blob to the system clipboard from extension
  UI contexts.

**What it does NOT let the extension do:**
* Write to the clipboard from a content script on a web page.
* Write without a user-initiated action (Chrome's clipboard write
  rules require an active user gesture).

---

## `alarms`

**Why:** Stash schedules a one-minute alarm to run an optional sync
round-trip with a server **the user configured**. When sync is off
(default), the alarm fires but does nothing.

**What it lets the extension do:**
* Schedule and cancel its own `chrome.alarms`.

**What it does NOT let the extension do:**
* Run code while Chrome is closed.
* Wake Chrome from a closed state.
* Schedule a system-level cron job.

The alarm is created in `chrome.runtime.onInstalled` and
`chrome.runtime.onStartup` and only fires the sync function when
`syncEnabled === true`.

---

## `unlimitedStorage`

**Why:** Stash stores image clips as base64 data URLs (so they
survive after the source page closes). A few screenshots can exceed
Chrome's default 5 MB `chrome.storage.local` quota, which would
silently break the feature. We cap each item ourselves at ~5 MB
(≈3.7 MB binary) in code.

**What it lets the extension do:**
* Store more than 5 MB total in `chrome.storage.local`.

**What it does NOT let the extension do:**
* Store data outside its own storage area.
* Bypass the per-item cap we enforce in `lib/storage.js`.
* Use unbounded RAM. (Items are still trimmed to the user's
  configured history size.)

---

## All-sites access via `content_scripts.matches: ["<all_urls>"]`

**Why:** A clipboard tool that only worked on a hand-picked list of
sites would be useless. Our content script registers handlers for
`copy` and `cut` events so the user's own copy actions are recorded
on any site, and registers a single keyboard-shortcut handler so the
inline paste HUD can open inside an editable field when the user
presses it.

**What it lets the extension do:**
* Inject `extension/content/content.js` into every web page the user
  visits, in the **isolated world** (Chrome's content-script sandbox,
  not the page's own JS context).
* Receive `copy` / `cut` events the user themselves fires, and the
  user's keyboard-shortcut keydown when they press it.
* If and only if the user has opted in to snippet expansion, detect
  user-defined trigger sequences inside the editable field they're
  currently typing into.

**What it does NOT let the extension do:**
* Run code in the page's main JS world.
* Read the page DOM, form fields, cookies, request bodies, fetch
  results, or any other state.
* Make `fetch` requests to arbitrary origins. We declare no
  `host_permissions`, so cross-origin fetches from extension contexts
  are blocked by CORS and from content scripts go through the page's
  own permissions (i.e. same-origin).
* Run on `chrome://`, `chrome-extension://`, the Web Store, or other
  restricted URLs — Chrome enforces this list.
* Use `chrome.scripting.executeScript`, `chrome.tabs.executeScript`,
  `chrome.cookies.*`, `chrome.webRequest.*`, or `chrome.cookies.*` —
  none of those permissions are declared.

We considered narrowing the matches array, but the feature requires
working everywhere a user might want to copy. We considered using
`activeTab` instead, but `activeTab` requires a user click on the
extension icon *before* the script runs, which would prevent passive
copy capture (the whole point). The current arrangement is the
minimum surface that supports the feature.

---

## Why we do NOT request other permissions

| Permission | Not requested because |
|---|---|
| `tabs` | We don't need to read tab URLs, titles, or other tab properties. `chrome.tabs.create({ url })` works without it. |
| `activeTab` | Would force users to click the toolbar icon before the content script runs, breaking passive copy capture. |
| `scripting` | Static `content_scripts` covers our injection needs. We never need to inject code dynamically based on a tab. |
| `cookies` | We never read or write cookies. |
| `webRequest` / `webRequestBlocking` | We don't intercept network requests. |
| `nativeMessaging` | We don't talk to native applications. |
| `bookmarks` / `history` / `downloads` | We don't touch any of these. |
| `host_permissions` for any URL | The site access we need is already covered by `content_scripts.matches`. Adding `host_permissions` would *also* allow `chrome.scripting`, `fetch` from extension contexts to those origins, etc. — strictly more power than we need. |
| `optional_permissions` | None of the requested permissions are gateable post-install without breaking the core flow. |

---

## Single-purpose declaration

> Stash maintains a fast, private, searchable history of the user's
> recent clipboard contents and lets them recall, transform, and
> (optionally) sync those items.

Every line of code in this extension supports that purpose.
