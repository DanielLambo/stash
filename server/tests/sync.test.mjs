import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(tmpdir(), "stash-sync-"));
process.env.DB_PATH = path.join(dir, "test.sqlite");
const { createUser, upsertItems, itemsForUserSince } = await import("../db.js");

test.after(() => rm(dir, { recursive: true, force: true }));

test("preserves full millisecond timestamps", () => {
  const user = createUser("token-a", "device-a");
  const ts = 1793232325123;
  upsertItems(user.id, [{ id: "clip", kind: "text", text: "hello", ts, updatedAt: ts }]);
  const [item] = itemsForUserSince(user.id, 0);
  assert.equal(item.ts, ts);
  assert.equal(item.updatedAt, ts);
});

test("newer device edit wins even when its recency timestamp is older", () => {
  const user = createUser("token-b", "device-b");
  upsertItems(user.id, [{
    id: "shared", kind: "text", text: "device A", ts: 1793232325000,
    updatedAt: 1793232326000, collectionId: "work",
  }]);
  upsertItems(user.id, [{
    id: "shared", kind: "text", text: "device B stale", ts: 1793232327000,
    updatedAt: 1793232325500, collectionId: "personal",
  }]);
  assert.equal(itemsForUserSince(user.id, 0).find(i => i.id === "shared").text, "device A");

  upsertItems(user.id, [{
    id: "shared", kind: "text", text: "device B newest", ts: 1793232324000,
    updatedAt: 1793232328000, collectionId: "projects",
  }]);
  const item = itemsForUserSince(user.id, 0).find(i => i.id === "shared");
  assert.equal(item.text, "device B newest");
  assert.equal(item.collectionId, "projects");
});

test("the same clip id is isolated between accounts", () => {
  const a = createUser("token-c", "device-c");
  const b = createUser("token-d", "device-d");
  upsertItems(a.id, [{ id: "same-id", kind: "text", text: "A", ts: 10, updatedAt: 10 }]);
  upsertItems(b.id, [{ id: "same-id", kind: "text", text: "B", ts: 20, updatedAt: 20 }]);
  assert.equal(itemsForUserSince(a.id, 0)[0].text, "A");
  assert.equal(itemsForUserSince(b.id, 0)[0].text, "B");
});
