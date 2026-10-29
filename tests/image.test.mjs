import test from "node:test";
import assert from "node:assert/strict";
import { findAlphaBounds } from "../extension/lib/image.js";

test("findAlphaBounds trims transparent signature padding", () => {
  const width = 5, height = 4;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (const [x, y] of [[1, 1], [3, 1], [2, 2]]) pixels[(y * width + x) * 4 + 3] = 255;
  assert.deepEqual(findAlphaBounds(pixels, width, height), {
    left: 1, right: 3, top: 1, bottom: 2,
  });
});

test("findAlphaBounds rejects empty and malformed input", () => {
  assert.equal(findAlphaBounds(new Uint8ClampedArray(4 * 4 * 4), 4, 4), null);
  assert.equal(findAlphaBounds(new Uint8ClampedArray(3), 4, 4), null);
});
