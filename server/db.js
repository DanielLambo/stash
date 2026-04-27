import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "clipboard.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    device TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    text TEXT,
    data_url TEXT,
    width INTEGER,
    height INTEGER,
    ts INTEGER NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    source TEXT,
    vaulted INTEGER NOT NULL DEFAULT 0,
    iv TEXT,
    ct TEXT,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_items_user_ts ON items(user_id, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_items_user_updated ON items(user_id, updated_at DESC);
`);

// Migrate older databases that don't have the vault columns yet.
const cols = db.prepare("PRAGMA table_info(items)").all().map(c => c.name);
for (const [name, ddl] of [
  ["vaulted", "ALTER TABLE items ADD COLUMN vaulted INTEGER NOT NULL DEFAULT 0"],
  ["iv",      "ALTER TABLE items ADD COLUMN iv TEXT"],
  ["ct",      "ALTER TABLE items ADD COLUMN ct TEXT"],
]) {
  if (!cols.includes(name)) db.exec(ddl);
}

const stmts = {
  insertUser: db.prepare(
    `INSERT INTO users (token, device, created_at) VALUES (?, ?, ?)`
  ),
  getUserByToken: db.prepare(`SELECT * FROM users WHERE token = ?`),

  upsertItem: db.prepare(`
    INSERT INTO items (id, user_id, kind, text, data_url, width, height, ts, pinned, source, vaulted, iv, ct, updated_at)
    VALUES (@id, @user_id, @kind, @text, @data_url, @width, @height, @ts, @pinned, @source, @vaulted, @iv, @ct, @updated_at)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind,
      text = excluded.text,
      data_url = excluded.data_url,
      width = excluded.width,
      height = excluded.height,
      ts = excluded.ts,
      pinned = excluded.pinned,
      source = excluded.source,
      vaulted = excluded.vaulted,
      iv = excluded.iv,
      ct = excluded.ct,
      updated_at = excluded.updated_at
    WHERE items.user_id = excluded.user_id AND excluded.ts >= items.ts
  `),

  itemsSince: db.prepare(`
    SELECT id, kind, text, data_url, width, height, ts, pinned, source, vaulted, iv, ct
    FROM items
    WHERE user_id = ? AND updated_at > ?
    ORDER BY ts DESC
    LIMIT 200
  `),

  countItems: db.prepare(`SELECT COUNT(*) as n FROM items WHERE user_id = ?`),
};

export function createUser(token, device) {
  stmts.insertUser.run(token, device || "", Date.now());
  return stmts.getUserByToken.get(token);
}

export function findUserByToken(token) {
  return stmts.getUserByToken.get(token);
}

export const upsertItems = db.transaction((userId, items) => {
  const now = Date.now();
  for (const i of items) {
    stmts.upsertItem.run({
      id: i.id,
      user_id: userId,
      kind: i.kind || "text",
      text: i.text || "",
      data_url: i.dataUrl || "",
      width: i.width | 0,
      height: i.height | 0,
      ts: i.ts | 0,
      pinned: i.pinned ? 1 : 0,
      source: i.source || "",
      vaulted: i.vaulted ? 1 : 0,
      iv: i.iv || "",
      ct: i.ct || "",
      updated_at: now,
    });
  }
});

export function itemsForUserSince(userId, since) {
  const rows = stmts.itemsSince.all(userId, since | 0);
  return rows.map(r => ({
    id: r.id,
    kind: r.kind,
    text: r.text,
    dataUrl: r.data_url,
    width: r.width,
    height: r.height,
    ts: r.ts,
    pinned: !!r.pinned,
    source: r.source,
    vaulted: !!r.vaulted,
    iv: r.iv || "",
    ct: r.ct || "",
  }));
}

export function itemCount(userId) {
  return stmts.countItems.get(userId).n;
}

export default db;
