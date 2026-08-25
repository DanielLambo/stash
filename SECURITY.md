# Security — Stash

Stash is a local-first Chrome extension. There is no Stash-operated
server and no user accounts on the developer side. Even so, bugs in
the extension, the Vault crypto, or the optional sync server in
`/server` can still put *your* data at risk on *your* machine or on
a server you run. Please report those privately first.

## How to report

**Preferred — private disclosure.** Open a GitHub security advisory:

<https://github.com/daniellambo/stash/security/advisories/new>

That form is not public. Please include:

* A description of the issue and the impact (what an attacker could
  do, and under what assumptions).
* Steps to reproduce, or a proof of concept.
* The extension version (`manifest.json` → `version`) and Chrome
  version, if relevant.
* Whether the issue is in the extension, the Vault (`extension/lib/crypto.js`),
  or the optional sync server.

**Fallback — public issue.** If the advisory form is unavailable, you
can open a GitHub issue at
<https://github.com/daniellambo/stash/issues>.
Please do **not** attach secrets, clipboard dumps, or a full exploit
in a public issue; say you have a security report and ask for a
private channel.

Do not file security reports against a third-party sync server you
did not write — contact that operator instead.

## What to expect

This is a small, volunteer-maintained project. I aim to:

* **Acknowledge** a valid report within **7 days**.
* **Assess** severity and confirm a fix path as soon as I can after
  that, typically within another week for issues that are clearly
  exploitable.
* **Credit** you in the advisory and in `CHANGELOG.md` if you want
  to be named (say so in the report).

Please give me a reasonable window to patch before publishing a
write-up. Coordinated disclosure is appreciated; I will not ask you
to sit on a report indefinitely.

## Scope

In scope:

* The Chrome extension under `extension/` (content scripts, service
  worker, popup, options, Vault crypto).
* The optional sync server under `server/`.
* Privilege-escalation or data-exfiltration bugs that would let a
  website, another extension, or a network attacker read clipboard
  history, Vault plaintext, or the sync bearer token.

Out of scope (unless you can show they lead to one of the above):

* Issues that require physical access to an unlocked machine.
* Chrome or OS bugs (please report those upstream).
* A sync server *you* deployed with an open port and a leaked token
  — that is an operational issue on that host.

## PGP (optional)

A PGP public key is not published yet. GitHub's private advisory
form is encrypted in transit; use that until a key is listed here.

```
-----BEGIN PGP PUBLIC KEY BLOCK-----
(none published yet)
-----END PGP PUBLIC KEY BLOCK-----
```

If a key is added later, reports encrypted to it can still be
opened as private advisories, or attached to a "I have a security
report" issue with no payload in the public body.
