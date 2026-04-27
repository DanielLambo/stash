# Privacy Policy — Stash

_Last updated: 2026-04-26_

Stash is a Chrome extension that helps you recall, search, transform, and
optionally encrypt the things you copy on the web. **Your data lives on
your computer.** This page explains exactly what Stash reads, where it
goes, and what it never does.

## The short version

* Stash runs **on your device**. Nothing is sent to the developer of
  Stash. There is no Stash server.
* Stash makes **no third-party network requests of any kind**. No
  analytics, no telemetry, no advertising IDs, no trackers, no error
  reporting, no font CDNs, no favicon fetches.
* Stash does **not** log, sell, or share your data.
* The optional cross-device sync uses a server **you choose** (typically
  one you run yourself). Stash never has a default cloud destination.
* Sensitive items (API keys, JWTs, credit cards, etc.) can be encrypted
  on your device with a master password before they're stored.

---

## What Stash reads

### Things you copy (always on)

When you press Cmd+C / Ctrl+C, or right-click → Copy on a web page,
Stash records what you copied so you can paste it later. This is the
fundamental job of a clipboard tool. The capture is event-driven — it
fires only on your own copy/cut action.

### The system clipboard, on demand

When you open the Stash popup or click its manual "capture clipboard"
button, Stash reads the current system clipboard one time. This lets it
record copies you made in another app (e.g. Finder, Preview) or on a
restricted page (`chrome://`). Stash **never polls the clipboard** in
the background.

### Trigger detection in an editable field — only if you turn on snippets

Snippet expansion is a productivity feature that lets you type a short
trigger like `;sig` and have Stash replace it with your own expansion
text. It is **off by default**. You must opt in from the Settings page.
When enabled, and only then, Stash:

* Detects user-defined trigger sequences in the editable field you're
  currently typing into.
* Keeps a tiny in-memory window of the most recent characters in that
  field — sized exactly to the longest trigger you've defined (so a
  4-character trigger means a 4-character window). Older characters
  are discarded immediately.
* Compares the tail of that window against triggers **you defined**.
* If a match is found, replaces the trigger with your expansion body.

What this means in plain English: **Stash does not log, store, or
transmit what you type.** No keystroke ever leaves your device. The
in-memory window is wiped on focus change, paste, or any non-text-
typing event. Password fields are excluded. The source file
[`extension/content/snippet.js`](extension/content/snippet.js)
includes a verbatim "what this module does NOT do" comment block at
the top so any auditor can verify this in under a minute.

---

## What Stash never does

* **No analytics** of any kind. We don't count installs, opens,
  copies, clicks, or anything else.
* **No browsing-history tracking.** Stash doesn't see which sites you
  visit. The content script reacts to `copy`/`cut` events; it does not
  read pages.
* **No content scraping.** Stash does not read page DOM, form values,
  cookies, localStorage, or request bodies. It cannot — it has no
  `host_permissions`, no `tabs` permission, and no `scripting`
  permission, so the underlying APIs are not even available to it.
* **No data sale.** Ever. Period.
* **No remote code.** All JavaScript ships inside the extension
  package. Stash does not load scripts from CDNs or run code fetched
  at runtime.
* **No telemetry.** No crash reporters, no error reporters, no A/B
  framework, no heatmaps.
* **No ads, advertising IDs, or third-party trackers.**

---

## Where your data is stored

Everything is stored on your computer using Chrome's built-in
`chrome.storage` APIs:

| Storage area | What we put there | Lifetime |
|---|---|---|
| `chrome.storage.local` | Clipboard items + snippet rules | Until you remove them or they roll off your history limit |
| `chrome.storage.sync` | Settings (theme, blocklist, vault config — salt + verifier) | Until you uninstall; replicated across Chromes you sign in with |
| `chrome.storage.session` | The Vault unlock cache (a derived key, in memory only) | Cleared when the browser exits |

You can wipe everything in one click from Settings → Data → Clear all,
or export it all as JSON.

---

## Sensitive data — the Vault

Each new clipboard item is checked locally against a set of rules that
recognize things like API keys (Stripe, GitHub, OpenAI, Anthropic,
AWS, Google, Slack), JWTs, credit cards (Luhn-validated), Social
Security numbers, and high-entropy secrets.

In every case, **a sensitive copy never lands in storage as plaintext**:

* **Vault not set up:** the copy is **dropped**, and a 🔒 badge flashes
  on the toolbar so you notice. The popup will invite you to set up
  Vault. We choose to lose the copy rather than store it in the clear.
* **Vault set up & unlocked:** the secret is encrypted on your device
  before it's saved. The plaintext does not touch disk.
* **Vault set up & locked:** the copy is **dropped**, and a 🔒 badge
  flashes to alert you that you need to unlock first.

### Encryption details, in plain English

* Encryption uses **AES-GCM**, an industry-standard authenticated
  cipher. (Same family used in HTTPS.)
* Your master password is **never stored**. We derive an encryption
  key from it using **PBKDF2-SHA256 with 600,000 iterations**, which
  is the OWASP-recommended minimum for 2024+.
* If you forget your master password, vaulted items **cannot be
  recovered**. There is no backdoor.
* The encryption code is in
  [`extension/lib/crypto.js`](extension/lib/crypto.js) — small enough
  to read and audit.

---

## Optional cross-device sync

Sync is **off by default** and Stash has **no default destination**.
When you turn it on, you provide a server URL — typically a server you
run yourself using the open-source code in our repository's `/server`
folder. Stash transmits:

* The clipboard items you see in the popup.
* For vaulted items: only the encrypted form (ciphertext + IV). We
  could not decrypt them even if we wanted to.

Items flagged sensitive but not yet encrypted (because Vault wasn't
set up at capture time) are filtered out before push as a safety net.

If you do not enable sync, **no data ever leaves your computer**.

---

## Outgoing network requests, full list

The only way Stash makes network requests at all is via the **optional
sync** feature, which is off by default.

| Trigger | Destination | What is sent |
|---|---|---|
| You enabled sync and typed in your own server URL | The URL **you typed** (no default) | Items you've copied (vaulted ones are sent only as ciphertext) |
| Periodic sync alarm (1×/min, only while sync is on) | Same URL as above | Same as above |

That is the complete list. There are no analytics endpoints, no error
reporters, no font CDNs, no favicon fetches, no third-party APIs of
any kind.

---

## Permissions, plain English

| Permission | Why we ask | What it does NOT do |
|---|---|---|
| `storage` | Save your clipboard history and settings on this computer. | Doesn't read storage from any other extension or any website. |
| `clipboardRead` | Read the system clipboard *only* when you open the popup or click "capture clipboard". | Doesn't poll, doesn't run in the background. |
| `clipboardWrite` | Copy a saved item back to your clipboard when you click it. | Only fires on your click. |
| `alarms` | Run the optional sync round-trip every minute when sync is on. | Disabled when sync is off. |
| `unlimitedStorage` | Allow image clips to exceed Chrome's default 5 MB storage cap. | We still cap each item ourselves (~5 MB). |
| All-sites access (via content script `matches`) | Receive *your* `copy`/`cut` events on any page so the clipboard works site-agnostically. | Does not read pages. We have no `host_permissions`, no `scripting`, no `tabs` — the script cannot fetch, scrape, or inject elsewhere. |

---

## Your controls

* **Pause capture entirely** — Settings → Enable capture.
* **Disable image capture** — Settings → Capture images.
* **Block specific domains** — Settings → Privacy → Blocked domains.
* **Disable snippet expansion** — Settings → Snippets (off by default).
* **Lock Vault** at any time — Settings → Vault → Lock now.
* **Reset Vault token** to unlink this device from sync.
* **Export your history** as JSON.
* **Wipe everything** in one click.

---

## Data retention

* Local items roll off automatically once your history exceeds the
  limit you set (default: 5 items). Pinned items don't roll off.
* Sync items live on **your** server until you delete them. Stash has
  no automatic-expiry policy because Stash doesn't run that server.

---

## Children

Stash is not directed at children under 13 and does not knowingly
collect data from them.

---

## Changes

If this policy changes, the date at the top moves and the change is
noted in [`CHANGELOG.md`](CHANGELOG.md). Material changes will also
appear in the extension's release notes on the Chrome Web Store.

---

## Contact

For questions, security disclosures, or audit requests, open an
issue at: <https://github.com/daniellambo/stash/issues>

(If the project moves, the canonical URL is tracked in `BRAND.md` in
the repository root.)
