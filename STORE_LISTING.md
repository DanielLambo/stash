# Chrome Web Store Listing — Stash

Everything below is sized for the developer dashboard's character
limits. Edit links and contact details before submitting.

---

## Name suggestions (3 options)

Ranked, with reasoning:

1. **Stash — Smart Clipboard for Power Users** *(recommended; current
   manifest name)*
   * Brandable, short, suggests "save + hide" — pairs naturally with
     the Vault feature.
   * "Smart" is descriptive without overpromising AI.
   * "for Power Users" filters self-selecting downloads to the
     audience that gets value.

2. **Stash — Paste at the Speed of Thought**
   * Heavier on the HUD positioning. Good for marketing copy outside
     the store; slightly less search-friendly inside it.

3. **Stash — Privacy-First Workflow Tool**
   * Leads with privacy. Strongest review-trust angle, but underplays
     the productivity story. Good for a follow-up version once the
     listing is established.

The shipped manifest uses option 1.

---

## Tagline (one line)

> **Paste smarter. Type less. Keep secrets safe.**

Three feature pillars in one breath: HUD, snippets, vault. Suitable
for the listing, the GitHub README, and social copy.

Alternates for A/B if desired:
* *"The clipboard, with superpowers."*
* *"A power tool for the things you copy."*
* *"Your clipboard, but smarter and safer."*

---

## Short description (≤ 132 chars)

```
Inline paste overlay, text expansion, smart actions, and on-device encryption for secrets. Fully local — no third-party network calls.
```

(123 chars. Same string lives in `manifest.json`'s `description` field.)

---

## Full description

```
Stash turns your clipboard into a workflow tool.

Inline paste overlay. Text expansion. Smart per-clip actions. On-
device encryption for the things you shouldn't store anywhere else.

❶ INSTANT PASTE, ANYWHERE
Press Cmd+Shift+V (Ctrl+Shift+V on Windows/Linux) inside any text
field — a search overlay appears, anchored right where you're typing.
Fuzzy-find a past clip, hit Enter, paste. No tab switching, no popup
hunt, no losing your place.

❷ TEXT EXPANSION (no account, no server)
Type ;sig and your signature appears. Type ;eod and your end-of-day
status template lands in Slack. Stash supports placeholders for
cursor position, dates, the current clipboard, and inline prompts —
written entirely in the snippet body you control. Nothing is sent
anywhere; expansion happens on your device.

❸ SMART ACTIONS PER CLIP
Stash classifies each clip and surfaces actions that fit:
  • URLs → open, copy as Markdown, generate a QR code (all on-device)
  • Hex colors → instant RGB / HSL / OKLCH conversion + swatch
  • JSON → format or minify in one click
  • Code → language detection + syntax-highlighted preview
  • Phone numbers → E.164 formatting and one-click dial
  • Emails → mailto compose

❹ THE VAULT — for things you'd never paste in a chat
API keys, JWTs, credit cards, GitHub tokens, AWS keys, OpenAI /
Anthropic keys, SSNs — Stash recognises the pattern locally and, with
your master password, encrypts them on your device with AES-GCM (key
derived via PBKDF2-SHA256, 600 000 iterations). A sensitive copy
never lands in storage as plaintext: if Vault isn't set up, the copy
is dropped and a 🔒 badge alerts you. Vaulted items are excluded from
sync and shown blurred until you click to unlock.

❺ PRIVATE BY DEFAULT
Stash is built to be auditable:
  • Everything stays on your computer.
  • Zero third-party network requests. No analytics, no telemetry,
    no advertising IDs, no trackers, no error reporting, no font
    CDNs, no favicon fetches.
  • Cross-device sync is opt-in, points at a server you choose, and
    has no default cloud destination.
  • Snippet expansion is off until you turn it on.
  • Per-domain blocklist for sites you never want recorded.
  • Manifest V3, no remote code, no broad host permissions, no
    `scripting`, no `tabs`, no `cookies`. The extension's full
    permission list and what each one cannot do is documented in
    PERMISSIONS.md (linked below).

❻ KEYBOARD-FIRST
  • Alt+Shift+V opens the popup
  • Cmd/Ctrl+Shift+V opens the inline paste HUD
  • Cmd/Ctrl+K focuses search
  • 1–9 paste that item

Open-source backend for sync. Bring your own server, or run the one
in our repo locally / on a Pi / on a Tailscale node.

Made for the kind of person who copies dozens of things a day and
wants both speed and a clear conscience about it.
```

### Category

`Productivity`

### Language

`English`

---

## Privacy practices form (in the dashboard)

* **Single purpose:**
  > Maintain a fast, private, searchable history of the user's recent
  > clipboard contents and let them recall, transform, and (optionally)
  > sync those items.

* **Data usage handling:**
  * Personally identifiable information — **No**
  * Health information — **No**
  * Financial / payment information — **No** (the Vault encrypts
    detected card-shaped strings on-device; we never receive them)
  * Authentication information — **No** (the Vault encrypts detected
    secrets on-device; we never receive them)
  * Personal communications — **No**
  * Location — **No**
  * Web history — **No**
  * User activity — **No**
  * Website content — **Yes** (the user's own clipboard contents,
    stored locally; not transmitted to us)

* **I certify that:** check both certification boxes — they are
  accurate.

* **Privacy policy URL:** paste the canonical URL listed in
  [`BRAND.md`](BRAND.md):
  `https://github.com/daniellambo/stash/blob/main/PRIVACY_POLICY.md`
  (verify the handle matches your repo before submission — see
  `BRAND.md` if you publish under a different GitHub handle).

* **Permission justifications:** copy from
  [`PERMISSIONS.md`](PERMISSIONS.md) — every permission already has a
  per-permission "Why" and "What it does NOT do" block in the right
  voice.

---

## Recommended screenshots

1280×800 PNG, 1–5 images. See [`SCREENSHOTS.md`](SCREENSHOTS.md) for
capture instructions and a JS snippet that seeds demo data.

1. **Hero — the inline paste HUD** anchored over a real-looking text
   field. Caption: *"A quick paste overlay, anywhere you type."*
2. **Vault — blurred secrets + the unlock card**. Caption: *"API
   keys, encrypted on your device."*
3. **Smart actions on a hex color** — the chip row showing Copy hex /
   RGB / HSL / OKLCH. Caption: *"Every clip is an action."*

(Optional 4th: a side-by-side GIF of `;sig` expanding into a real
signature, used as the "tile" image.)

---

## Promotional images (optional, recommended)

| Slot | Size | Notes |
|---|---|---|
| Small promo tile | 440×280 | Required for "Featured" placement. |
| Marquee | 1400×560 | Used on Web Store promotional banners. |

Use the squircle icon plus the tagline on a dark gradient.
