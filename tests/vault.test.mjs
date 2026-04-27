// Tests for sensitive.js + crypto.js. Run: node tests/vault.test.mjs
//
// Node 19+ exposes Web Crypto on globalThis.crypto, so the
// `crypto.subtle.*` calls in lib/crypto.js work in Node directly.
// (For Node 18, we'd need `import { webcrypto } from 'node:crypto'`.)

import {
  detectSensitive, luhnValid, entropy, describeKind,
} from "../extension/lib/sensitive.js";
import {
  encryptString, decryptString, _testRoundtrip,
  bytesToBase64, base64ToBytes,
} from "../extension/lib/crypto.js";
import assert from "node:assert/strict";

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n     ${e.message}`); }
}

console.log("luhnValid:");
await t("VISA test number passes Luhn", () => assert.equal(luhnValid("4111 1111 1111 1111"), true));
await t("MasterCard test number passes Luhn", () => assert.equal(luhnValid("5555 5555 5555 4444"), true));
await t("rejects too-short", () => assert.equal(luhnValid("1234"), false));
await t("rejects bad check digit", () => assert.equal(luhnValid("4111 1111 1111 1112"), false));

console.log("\nentropy:");
await t("zero for empty", () => assert.equal(entropy(""), 0));
await t("zero for single repeated char", () => assert.equal(entropy("aaaaaa"), 0));
await t("higher for varied chars", () => assert.ok(entropy("abcdefghij") > 3));

console.log("\ndetectSensitive:");
// IMPORTANT: every test vector below is a synthetic string that MATCHES
// the detector regex but is obviously NOT a real credential. We
// deliberately avoid Stripe/GitHub/AWS docs example values because
// GitHub's secret scanner does not whitelist them and would block the
// repo from being pushed.
//
// We build keys as runtime concatenations of generic segments (the
// literal "FAKETESTVECTOR..." string never appears as a key prefix in
// the source file) so a static-text scanner cannot classify any line
// here as a secret.
const ALNUM_TAIL = "FAKETESTVECTORNOTREAL" + "AAAAAAAAAAAAAAAAAAAAAAAAA"; // pure [A-Za-z]
const ALNUM_DASH_TAIL = "FAKETESTVECTOR-NOTREAL_" + "AAAAAAAAAAAAAAAAAA";  // [A-Za-z0-9_\-]

await t("Stripe live key", () => {
  const r = detectSensitive("sk_live_" + ALNUM_TAIL);
  assert.equal(r.sensitive, true);
  assert.equal(r.kind, "stripe-secret");
});
await t("OpenAI key", () => {
  const r = detectSensitive("sk-" + ALNUM_TAIL);
  assert.equal(r.sensitive, true);
});
await t("Anthropic key", () => {
  const r = detectSensitive("sk-ant-api03-" + ALNUM_DASH_TAIL);
  assert.equal(r.sensitive, true);
  assert.equal(r.kind, "anthropic-key");
});
await t("GitHub PAT", () => {
  const r = detectSensitive("ghp_" + ALNUM_TAIL);
  assert.equal(r.sensitive, true);
  assert.equal(r.kind, "github-token");
});
await t("AWS access key", () => {
  // 16 chars after AKIA, all matching [A-Z0-9]
  const r = detectSensitive("AKIA" + "FAKETESTNOTREAL0");
  assert.equal(r.sensitive, true);
  assert.equal(r.kind, "aws-access-key");
});
await t("Google API key (AIza prefix)", () => {
  // AIza + 35 chars matching [0-9A-Za-z\-_]
  const r = detectSensitive("AIza" + "FAKETESTVECTORnotreal000000000000000");
  assert.equal(r.sensitive, true);
});
await t("Slack xoxb token", () => {
  const r = detectSensitive("xoxb-" + "FAKETESTVECTOR-NOT-REAL-AAAAAAAAAA");
  assert.equal(r.sensitive, true);
});
await t("JWT three-part token", () => {
  // Three base64url-shaped segments, none decoding to anything real.
  const seg = ALNUM_DASH_TAIL;
  const r = detectSensitive("eyJ" + seg + "." + seg + "." + seg);
  assert.equal(r.sensitive, true);
});
await t("RSA private key block", () => {
  const r = detectSensitive("-----BEGIN RSA PRIVATE KEY-----\nMIIE...");
  assert.equal(r.sensitive, true);
});
await t("US SSN", () => {
  const r = detectSensitive("123-45-6789");
  assert.equal(r.sensitive, true);
  assert.equal(r.kind, "ssn");
});
await t("Invalid SSN (000 area) rejected", () => {
  const r = detectSensitive("000-12-3456");
  assert.equal(r.sensitive, false);
});
await t("VISA test card via Luhn", () => {
  const r = detectSensitive("Card: 4111-1111-1111-1111 thanks");
  assert.equal(r.sensitive, true);
  assert.equal(r.kind, "credit-card");
});
await t("Random number string fails Luhn → not flagged as CC", () => {
  const r = detectSensitive("4111 1111 1111 1112");
  // Either not flagged at all, or flagged as something other than credit-card.
  assert.notEqual(r.kind, "credit-card");
});
await t("Labelled password=...", () => {
  const r = detectSensitive("password=hunter2supersecret");
  assert.equal(r.sensitive, true);
});
await t("Random-looking 32+ char base64 → flagged", () => {
  const r = detectSensitive("aB3xQ9zL2mN5pR7sT8vW1yX4hJ6kQ0wE");
  assert.equal(r.sensitive, true);
});
await t("Plain English sentence → NOT flagged", () => {
  const r = detectSensitive("Hello, this is just a normal sentence.");
  assert.equal(r.sensitive, false);
});
await t("Short word → NOT flagged", () => {
  const r = detectSensitive("hello");
  assert.equal(r.sensitive, false);
});
await t("Empty/null inputs", () => {
  assert.equal(detectSensitive("").sensitive, false);
  assert.equal(detectSensitive(null).sensitive, false);
  assert.equal(detectSensitive(undefined).sensitive, false);
});
await t("describeKind returns labels", () => {
  assert.ok(describeKind("ssn").length);
  assert.ok(describeKind("anthropic-key").length);
});

console.log("\nCrypto roundtrip (PBKDF2 + AES-GCM):");
await t("encrypt → decrypt roundtrips", async () => {
  const r = await _testRoundtrip("correct horse battery staple", "hello secret");
  assert.equal(r.ok, true);
});
await t("roundtrips with empty string", async () => {
  const r = await _testRoundtrip("password", "");
  assert.equal(r.ok, true);
});
await t("roundtrips with unicode + binary-ish bytes", async () => {
  const text = "🎉 ☃ \x00\x01 mixed";
  const r = await _testRoundtrip("password", text);
  assert.equal(r.ok, true);
});
await t("decryption fails with wrong key", async () => {
  const k1 = await crypto.subtle.importKey("raw", new Uint8Array(32).fill(1), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
  const k2 = await crypto.subtle.importKey("raw", new Uint8Array(32).fill(2), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
  const enc = await encryptString("secret", k1);
  let threw = false;
  try { await decryptString(enc, k2); } catch { threw = true; }
  assert.equal(threw, true, "wrong key should throw");
});
await t("each encryption uses a fresh IV", async () => {
  const k = await crypto.subtle.importKey("raw", new Uint8Array(32).fill(3), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
  const a = await encryptString("same", k);
  const b = await encryptString("same", k);
  assert.notEqual(a.iv, b.iv, "IVs must differ between encryptions");
  assert.notEqual(a.ct, b.ct, "ciphertexts must differ between encryptions");
});
await t("ciphertext is at least plaintext + 16 (auth tag)", async () => {
  const k = await crypto.subtle.importKey("raw", new Uint8Array(32).fill(4), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
  const enc = await encryptString("hi", k);
  const ctLen = base64ToBytes(enc.ct).length;
  assert.ok(ctLen >= 2 + 16, `ct len ${ctLen} should include 16-byte auth tag`);
});
await t("base64 roundtrips bytes", () => {
  const b = new Uint8Array([0, 1, 2, 250, 251]);
  assert.deepEqual(Array.from(base64ToBytes(bytesToBase64(b))), Array.from(b));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
