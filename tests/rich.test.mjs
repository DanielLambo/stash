import test from "node:test";
import assert from "node:assert/strict";
import { rowsToCsv, rowsToMarkdown, hasMeaningfulFormatting } from "../extension/lib/rich.js";

test("table rows export as quoted CSV", () => {
  assert.equal(
    rowsToCsv([["Name", "Note"], ["Ada", "hello, world"], ["Lin", 'a "quote"']]),
    'Name,Note\nAda,"hello, world"\nLin,"a ""quote"""'
  );
});

test("table rows export as Markdown and escape pipes", () => {
  assert.equal(
    rowsToMarkdown([["Name", "Role"], ["A | B", "Engineer"]]),
    "| Name | Role |\n| --- | --- |\n| A \\| B | Engineer |"
  );
});

test("meaningful rich text excludes plain wrappers", () => {
  assert.equal(hasMeaningfulFormatting("<span>plain</span>"), false);
  assert.equal(hasMeaningfulFormatting("<strong>bold</strong>"), true);
  assert.equal(hasMeaningfulFormatting("<table><tr><td>x</td></tr></table>"), true);
});
