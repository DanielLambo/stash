# Publishing to the Chrome Web Store

Step-by-step guide. Allow ~1–2 hours for the first submission, mostly
artwork and review-form filling.

## 0. One-time prerequisites

1. A Google account.
2. A **Chrome Web Store developer account** — pay the **one-time $5 USD**
   registration fee at
   [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole).
3. Verify the contact email Google sends you.

## 1. Final pre-publish checklist

- [ ] `extension/manifest.json` — version is correct, name/description final.
- [ ] [LICENSE](LICENSE), [PRIVACY.md](PRIVACY.md), [PERMISSIONS.md](PERMISSIONS.md), [STORE_LISTING.md](STORE_LISTING.md), [CHANGELOG.md](CHANGELOG.md) — present.
- [ ] [PRIVACY_POLICY.md](PRIVACY_POLICY.md) hosted at a public URL. The canonical URL (configured in [BRAND.md](BRAND.md)) is `https://github.com/daniellambo/stash/blob/main/PRIVACY_POLICY.md`.
- [ ] At least 1 screenshot at 1280×800 or 640×400 — see [SCREENSHOTS.md](SCREENSHOTS.md).
- [ ] (Optional, recommended) 440×280 small promo tile.
- [ ] No `console.log` debug spam left in extension code.
- [ ] No `localhost` URLs hard-coded as defaults the user can't change
       (we use `localhost:8787` as the *default* sync URL, but the user
       can change it — that's fine).
- [ ] Loaded the extension unpacked from `extension/` and verified each
       feature: capture, expand, edit, search, pin, theme switch, options.

## 2. Build the upload ZIP

```bash
./scripts/build.sh
```

This produces `dist/clipboard-<version>.zip`, containing only the files
needed at runtime (no `generate.py`, no `.DS_Store`, no
`__pycache__`, no `node_modules`).

Verify:

```bash
unzip -l dist/clipboard-1.0.0.zip
```

The listing should show `manifest.json` at the top level — that's the
shape Chrome expects.

## 3. Upload

1. Go to the
   [developer dashboard](https://chrome.google.com/webstore/devconsole).
2. Click **"New item"**.
3. Upload `dist/clipboard-1.0.0.zip`.
4. Wait for the package to validate.

## 4. Fill the listing

Open [STORE_LISTING.md](STORE_LISTING.md) in another window and copy each
section into the dashboard's matching fields:

- **Item details → Description.** Paste the detailed description.
- **Item details → Category.** *Productivity*.
- **Item details → Language.** *English*.
- **Item details → Store icon.** Upload `extension/icons/icon-128.png`.
- **Item details → Screenshots.** Upload your 1–5 captures.
- **Privacy practices → Single purpose.** Paste the single-purpose line.
- **Privacy practices → Permission justifications.** Paste each from
  [PERMISSIONS.md](PERMISSIONS.md).
- **Privacy practices → Data usage.** Mark every data category accurately
  (see STORE_LISTING.md → "Privacy practices form").
- **Privacy practices → Privacy policy URL.** Paste your hosted PRIVACY.md
  URL.
- **Distribution.** Public, all regions (or restrict if you prefer).

## 5. Submit for review

Click **"Submit for review"**. First-time reviews typically take **a few
days to ~2 weeks**. Google may email follow-up questions; respond from the
dashboard's messaging panel.

Common rejection reasons (and how this build avoids them):

| Reason | Mitigation |
|---|---|
| Overly broad permissions | We dropped `activeTab`, `scripting`, and unused `host_permissions`. |
| Remote code | We bundle all JS; the only remote request is for favicon images. |
| Missing single-purpose disclosure | Listed in [PERMISSIONS.md](PERMISSIONS.md). |
| Misleading metadata | Name, description, and screenshots all describe the actual feature. |
| Privacy policy missing | We ship [PRIVACY.md](PRIVACY.md). |

## 6. After approval

- The store URL becomes `https://chromewebstore.google.com/detail/{ID}`,
  where `{ID}` is the 32-char identifier Chrome assigns on first review.
  This identifier does not exist before review — bookmark the URL once
  Chrome shows it to you, then record it in `BRAND.md` under "Web Store
  listing URL".
- Future updates: bump `version` in `manifest.json`, run `./scripts/build.sh`,
  upload the new ZIP. Version bumps must be strictly increasing
  (`1.0.0` → `1.0.1` → `1.1.0` …).
- Crash reports and install metrics show up in the dashboard.

## 7. Self-hosted sync server (optional, separate from the store)

The store distributes only the extension. The optional sync server lives
at [server/](server/) — your users (or you) run it separately. Document
that link from the listing if you publish the source.
