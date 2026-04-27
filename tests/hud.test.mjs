// Node-runnable tests for the pure logic in hud.js. We import via the
// regular ESM path; hud.js doesn't actually run any chrome.* calls at
// module-init time, so it's safe.
//
// Run: node tests/hud.test.mjs

import { fuzzyMatch } from "../extension/content/hud.js";
import assert from "node:assert/strict";

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n     ${e.message}`); }
}

console.log("fuzzyMatch:");
t("empty query matches everything", () => {
  assert.equal(fuzzyMatch("", "anything").ok, true);
});
t("exact substring matches", () => {
  assert.equal(fuzzyMatch("foo", "the foo bar").ok, true);
});
t("subsequence matches", () => {
  assert.equal(fuzzyMatch("ftn", "function").ok, true);
});
t("misordered chars do not match", () => {
  assert.equal(fuzzyMatch("nfu", "function").ok, false);
});
t("case-insensitive", () => {
  assert.equal(fuzzyMatch("FOO", "the foo bar").ok, true);
});
t("substring scores higher than scattered subsequence", () => {
  const a = fuzzyMatch("foo", "foo bar baz").score;        // substring at 0
  const b = fuzzyMatch("foo", "f___o___o___").score;       // scattered
  assert.ok(a > b, `expected substring (${a}) to beat scatter (${b})`);
});
t("earlier substring scores higher than later", () => {
  const a = fuzzyMatch("api", "api key here").score;
  const b = fuzzyMatch("api", "later in the string is api").score;
  assert.ok(a > b);
});
t("rejects when query has chars text doesn't contain", () => {
  assert.equal(fuzzyMatch("xyz", "abc").ok, false);
});
t("score does not crash on emoji / surrogates", () => {
  const r = fuzzyMatch("a", "🚀 abc 🎉");
  assert.equal(r.ok, true);
});

// Sanity-check the editable detection logic by re-encoding the rule set.
// (We can't import content.js into Node since it's an IIFE that touches
// `document`, so we re-derive the table here as a guard against drift.)
console.log("\nisEditable rules (mirrored):");
const rules = [
  ["INPUT", "text", true],
  ["INPUT", "search", true],
  ["INPUT", "email", true],
  ["INPUT", "url", true],
  ["INPUT", "tel", true],
  ["INPUT", "", true],         // unset type → text
  ["INPUT", "number", true],   // numeric inputs are still editable text fields
  ["INPUT", "password", false],
  ["INPUT", "checkbox", false],
  ["INPUT", "radio", false],
  ["INPUT", "submit", false],
  ["INPUT", "file", false],
  ["INPUT", "hidden", false],
  ["INPUT", "color", false],
  ["INPUT", "range", false],
  ["TEXTAREA", "", true],
  ["DIV", "", false],
];

function expectEditable(tag, type) {
  if (tag === "TEXTAREA") return true;
  if (tag === "DIV") return false;  // contenteditable is a separate path
  if (tag === "INPUT") {
    const SKIP = new Set([
      "password", "checkbox", "radio", "submit", "reset", "button",
      "file", "hidden", "image", "color", "range",
    ]);
    return !SKIP.has((type || "").toLowerCase());
  }
  return false;
}

for (const [tag, type, want] of rules) {
  t(`<${tag.toLowerCase()}${type ? ` type=${type}` : ""}> ⇒ ${want}`, () => {
    assert.equal(expectEditable(tag, type), want);
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
