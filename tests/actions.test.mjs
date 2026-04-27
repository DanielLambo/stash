// Pure-function tests for lib/actions.js. Run: node tests/actions.test.mjs
import {
  urlToMarkdown,
  hexToRgb, rgbToHex, rgbToHsl, rgbToOklch, colorFormatAll,
  isLikelyJson, jsonFormat, jsonMinify,
  detectLanguage, highlight,
  phoneToE164,
  qrMatrix,
  actionsFor,
} from "../extension/lib/actions.js";
import assert from "node:assert/strict";

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n     ${e.message}`); }
}

console.log("urlToMarkdown:");
t("uses host as label", () => {
  assert.equal(urlToMarkdown("https://example.com/foo"), "[example.com](https://example.com/foo)");
});
t("strips www. prefix", () => {
  assert.equal(urlToMarkdown("https://www.example.com/x"), "[example.com](https://www.example.com/x)");
});
t("custom label wins over host", () => {
  assert.equal(urlToMarkdown("https://example.com", "Click me"), "[Click me](https://example.com)");
});

console.log("\nColor conversion:");
t("hexToRgb #fff → 255,255,255", () => {
  assert.deepEqual(hexToRgb("#fff"), { r: 255, g: 255, b: 255 });
});
t("hexToRgb without # works", () => {
  assert.deepEqual(hexToRgb("0a84ff"), { r: 10, g: 132, b: 255 });
});
t("hexToRgb with alpha truncates", () => {
  assert.deepEqual(hexToRgb("#0a84ff80"), { r: 10, g: 132, b: 255 });
});
t("hexToRgb invalid → null", () => {
  assert.equal(hexToRgb("zzz"), null);
});
t("rgbToHex roundtrips", () => {
  assert.equal(rgbToHex({ r: 10, g: 132, b: 255 }), "#0a84ff");
});
t("rgbToHsl matches known value", () => {
  // #0a84ff → hsl(211, 100%, 52%)  (allow ±1)
  const h = rgbToHsl({ r: 10, g: 132, b: 255 });
  assert.ok(Math.abs(h.h - 211) <= 1, `h=${h.h}`);
  assert.ok(Math.abs(h.s - 100) <= 1);
  assert.ok(Math.abs(h.l - 52) <= 1);
});
t("rgbToOklch returns sane numbers for blue", () => {
  const c = rgbToOklch({ r: 10, g: 132, b: 255 });
  assert.ok(c.L > 0 && c.L < 1);
  assert.ok(c.C > 0);
  assert.ok(c.H >= 0 && c.H < 360);
});
t("colorFormatAll returns four formats", () => {
  const all = colorFormatAll("#0a84ff");
  assert.ok(all.hex.startsWith("#"));
  assert.ok(all.rgb.startsWith("rgb("));
  assert.ok(all.hsl.startsWith("hsl("));
  assert.ok(all.oklch.startsWith("oklch("));
});

console.log("\nJSON:");
t("isLikelyJson detects object", () => {
  assert.equal(isLikelyJson('{"a":1}'), true);
});
t("isLikelyJson detects array", () => {
  assert.equal(isLikelyJson("[1,2,3]"), true);
});
t("isLikelyJson rejects garbage", () => {
  assert.equal(isLikelyJson("hello"), false);
});
t("isLikelyJson rejects malformed JSON", () => {
  assert.equal(isLikelyJson('{a: 1}'), false);
});
t("jsonFormat indents", () => {
  const out = jsonFormat('{"a":1}');
  assert.ok(out.includes("\n"));
});
t("jsonMinify strips whitespace", () => {
  assert.equal(jsonMinify('{ "a" : 1 }'), '{"a":1}');
});

console.log("\nLanguage detection:");
t("python def", () => {
  assert.equal(detectLanguage("def hello():\n    pass\n"), "python");
});
t("javascript const + arrow", () => {
  assert.equal(detectLanguage("const f = () => 1;"), "javascript");
});
t("html with closing tags", () => {
  assert.equal(detectLanguage("<div><span>x</span></div>"), "html");
});
t("json", () => {
  assert.equal(detectLanguage('{"a":1}'), "json");
});
t("sql SELECT", () => {
  assert.equal(detectLanguage("SELECT * FROM t WHERE x=1"), "sql");
});
t("plain text falls through", () => {
  assert.equal(detectLanguage("hello world"), "plaintext");
});

console.log("\nHighlight (sanity):");
t("plaintext is HTML-escaped", () => {
  assert.equal(highlight("<x>", "plaintext"), "&lt;x&gt;");
});
t("javascript wraps keywords", () => {
  const html = highlight("const x = 1;", "javascript");
  assert.ok(html.includes('class="hl-kw"'));
  assert.ok(html.includes('class="hl-num"'));
});
t("strings are wrapped", () => {
  const html = highlight('let s = "hi";', "javascript");
  assert.ok(html.includes('class="hl-str"'));
});

console.log("\nphoneToE164:");
t("US 10-digit gets +1", () => {
  assert.equal(phoneToE164("(555) 123-4567"), "+15551234567");
});
t("Already-international preserved", () => {
  assert.equal(phoneToE164("+44 20 7946 0958"), "+442079460958");
});
t("Returns null for too-short", () => {
  assert.equal(phoneToE164("12345"), null);
});

console.log("\nQR encoder smoke:");
t("encodes a short URL without throwing", () => {
  const r = qrMatrix("https://example.com");
  assert.ok(r.size >= 21);
  assert.ok(Array.isArray(r.modules));
  assert.equal(r.modules.length, r.size);
});
t("encodes empty string", () => {
  const r = qrMatrix("");
  assert.ok(r.size > 0);
});

console.log("\nactionsFor (integration):");
t("link items get 3 local-only actions (shortener removed)", () => {
  // The is.gd URL shortener was removed in the final hardening pass —
  // it was the only third-party endpoint and it now serves no purpose
  // in the v1 listing. Stash should make zero outgoing third-party
  // requests, ever.
  const acts = actionsFor({ kind: "text", text: "https://example.com" });
  const ids = acts.map(a => a.id);
  assert.deepEqual(ids.sort(), ["markdown", "open", "qr"].sort());
});
t("color items get 4 conversion actions", () => {
  const acts = actionsFor({ kind: "text", text: "#0a84ff" });
  assert.equal(acts.length, 4);
});
t("phone items dial + e164", () => {
  const acts = actionsFor({ kind: "text", text: "+1 (555) 123-4567" });
  const ids = acts.map(a => a.id);
  assert.deepEqual(ids.sort(), ["dial", "e164"].sort());
});
t("plain text → no actions", () => {
  const acts = actionsFor({ kind: "text", text: "just some text" });
  assert.equal(acts.length, 0);
});
t("image item has no remote-code actions in v1", () => {
  // Earlier drafts shipped an OCR action via remote-code import.
  // CWS policy bans remote code, so v1 ships zero image actions.
  const acts = actionsFor({ kind: "image", dataUrl: "data:image/png;base64,xxx" });
  assert.equal(acts.length, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
