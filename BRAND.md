# BRAND.md — Single source of truth for shipping URLs / identifiers

> **This is the only file you need to edit if you publish under a
> different GitHub handle, organization, or domain.** Update the
> values in the table below, then run `./scripts/build.sh` and ship.

The shipping default below assumes the project lives at
`https://github.com/daniellambo/stash`. **Verify that URL before
submitting** — if the repo lives somewhere else, change the values
here, run a search-and-replace across the four files listed at the
end of this document, and rebuild.

## Canonical values

| Identifier | Value |
|---|---|
| Product name (full) | `Stash — Smart Clipboard for Power Users` |
| Product name (short) | `Stash` |
| Repo URL | `https://github.com/daniellambo/stash` |
| Issues URL | `https://github.com/daniellambo/stash/issues` |
| Privacy policy URL (hosted, plain-text) | `https://github.com/daniellambo/stash/blob/main/PRIVACY_POLICY.md` |
| Privacy policy URL (in-product) | `chrome-extension://<id>/privacy.html` (the `<id>` is assigned by Chrome on first install) |
| Support email | _none required — use the Issues URL_ |
| Web Store listing URL | Assigned by Chrome after first review; pin it here once known. |

## Files that reference these values

If you change anything above, update the same value in:

1. `extension/manifest.json` — `homepage_url`, `name`, `short_name`,
   `description`.
2. `STORE_LISTING.md` — every dashboard form snippet.
3. `PRIVACY_POLICY.md` — header + Contact section.
4. `extension/privacy.html` — Contact section.

## Pre-submission checklist

- [ ] All four files above match the canonical values in this table.
- [ ] `PRIVACY_POLICY.md` is publicly reachable at the URL listed
  here (a GitHub blob URL is acceptable).
- [ ] No `example.com`, `<your-handle>`, `TODO`, or angle-bracket
  placeholders remain anywhere in the package — verify with:
  ```
  grep -rniE 'example\.com|<your[-_]|TODO|FIXME|XXX' \
    extension/ STORE_LISTING.md PRIVACY_POLICY.md PERMISSIONS.md \
    BRAND.md README.md
  ```
- [ ] `homepage_url` in the built `manifest.json` is reachable in a
  browser before you click Submit.
