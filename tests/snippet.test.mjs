// Tests for the pure helpers in snippet.js (placeholder parsing,
// substitution, and trigger matching). Run: node tests/snippet.test.mjs
//
// snippet.js doesn't reference chrome.* at module-init time so it imports
// safely in Node — refresh()/install() are only called by content.js.

import {
  parseBody, expandSegments, applyInputs, formatDate, findMatchingTrigger,
} from "../extension/content/snippet.js";
import assert from "node:assert/strict";

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n     ${e.message}`); }
}

console.log("formatDate:");
t("default ISO", () => {
  const d = new Date("2026-04-26T15:09:07Z");
  // Use local components rather than UTC: format uses local time. Reconstruct
  // expected from the same Date the function will see.
  const out = formatDate(undefined, d);
  // The default is YYYY-MM-DD; so it should be 10 chars, 2 dashes.
  assert.match(out, /^\d{4}-\d{2}-\d{2}$/);
});
t("custom HH:mm", () => {
  const d = new Date(2026, 3, 26, 9, 7);
  assert.equal(formatDate("HH:mm", d), "09:07");
});
t("literal text passes through", () => {
  const d = new Date(2026, 0, 1);
  assert.equal(formatDate("Today is YYYY/MM/DD!", d), "Today is 2026/01/01!");
});

console.log("\nparseBody:");
t("plain text → single segment", () => {
  const segs = parseBody("hello world");
  assert.deepEqual(segs, [{ kind: "text", value: "hello world" }]);
});
t("single placeholder mid-string", () => {
  const segs = parseBody("a {cursor} b");
  assert.equal(segs.length, 3);
  assert.equal(segs[0].kind, "text");
  assert.equal(segs[1].kind, "cursor");
  assert.equal(segs[2].kind, "text");
});
t("date with format", () => {
  const segs = parseBody("at {date:HH:mm}");
  assert.equal(segs[1].kind, "date");
  assert.equal(segs[1].value, "HH:mm");
});
t("date without format defaults to ISO", () => {
  const segs = parseBody("on {date}");
  assert.equal(segs[1].kind, "date");
  assert.equal(segs[1].value, "YYYY-MM-DD");
});
t("clipboard placeholder", () => {
  const segs = parseBody("paste: {clipboard} done");
  assert.equal(segs[1].kind, "clipboard");
});
t("input with label", () => {
  const segs = parseBody("Hi {input:Recipient}, …");
  assert.equal(segs[1].kind, "input");
  assert.equal(segs[1].value, "Recipient");
});
t("two placeholders preserve text between", () => {
  const segs = parseBody("{cursor} foo {clipboard}");
  assert.equal(segs.length, 3);
  assert.equal(segs[1].value, " foo ");
});
t("unknown placeholder kept as text", () => {
  const segs = parseBody("hi {bogus} bye");
  // Our regex won't match {bogus}, so the whole string should be one text segment.
  assert.equal(segs.length, 1);
  assert.equal(segs[0].value, "hi {bogus} bye");
});

console.log("\nexpandSegments:");
t("substitutes date and clipboard", () => {
  const segs = parseBody("{date:YYYY} {clipboard}");
  const out = expandSegments(segs, { now: new Date(2026, 0, 1), clipboard: "hi" });
  assert.equal(out.text, "2026 hi");
  assert.equal(out.cursorOffset, -1);
  assert.equal(out.inputs.length, 0);
});
t("first {cursor} sets offset; second is ignored", () => {
  const segs = parseBody("a{cursor}b{cursor}c");
  const out = expandSegments(segs, { now: new Date(), clipboard: "" });
  assert.equal(out.text, "abc");
  assert.equal(out.cursorOffset, 1);
});
t("input markers track positions in the produced text", () => {
  const segs = parseBody("Dear {input:Name}, the date is {date:YYYY}.");
  const out = expandSegments(segs, { now: new Date(2026, 0, 1), clipboard: "" });
  assert.equal(out.text, "Dear , the date is 2026.");
  assert.equal(out.inputs.length, 1);
  // Marker should be just after "Dear " — that's position 5
  assert.equal(out.inputs[0].marker, 5);
  assert.equal(out.inputs[0].label, "Name");
});

console.log("\napplyInputs:");
t("inserts answer at marker", () => {
  const r = applyInputs("Dear , end", [{ marker: 5, label: "" }], ["Alice"], -1);
  assert.equal(r.text, "Dear Alice, end");
  assert.equal(r.cursorOffset, -1);
});
t("inserts in reverse so multiple inputs all land right", () => {
  // Text: "Hello [name1], from [name2]"
  // After parseBody+expandSegments the markers would be the length of
  // "Hello " (6) and "Hello , from " (13).
  const text = "Hello , from ";
  const inputs = [{ marker: 6, label: "n1" }, { marker: 13, label: "n2" }];
  const r = applyInputs(text, inputs, ["Alice", "Bob"], -1);
  assert.equal(r.text, "Hello Alice, from Bob");
});
t("cursor offset shifts forward when inputs precede it", () => {
  // text "X Y" with cursor between X and Y at offset 2; an input marker
  // at offset 0 with answer "AAA" should push cursor to 5.
  const r = applyInputs("X Y", [{ marker: 0, label: "" }], ["AAA"], 2);
  assert.equal(r.text, "AAAX Y");
  assert.equal(r.cursorOffset, 5);
});

console.log("\nfindMatchingTrigger:");
t("longest trigger wins", () => {
  const snippets = [
    { trigger: ";sig", body: "a" },
    { trigger: ";signature", body: "b" },
  ].sort((a, b) => b.trigger.length - a.trigger.length);
  const m = findMatchingTrigger("xyz;signature", snippets);
  assert.equal(m.trigger, ";signature");
});
t("returns null when nothing matches", () => {
  const m = findMatchingTrigger("nothing here", [{ trigger: ";sig", body: "" }]);
  assert.equal(m, null);
});
t("only matches at end of buffer", () => {
  const m = findMatchingTrigger(";sig and more", [{ trigger: ";sig", body: "" }]);
  assert.equal(m, null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
