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
    id TEXT NOT NULL,
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
    client_updated_at INTEGER NOT NULL DEFAULT 0,
    extra_json TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// v1 used `id` as a global primary key and coerced timestamps through `| 0`.
// Rebuild that table once so IDs are user-scoped and milliseconds stay intact.
const tableInfo = db.prepare("PRAGMA table_info(items)").all();
const primaryKeyCols = tableInfo.filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => c.name);
if (primaryKeyCols.join(",") === "id") {
  db.transaction(() => {
    db.exec(`
      ALTER TABLE items RENAME TO items_v1;
      CREATE TABLE items (
        id TEXT NOT NULL,
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
        client_updated_at INTEGER NOT NULL DEFAULT 0,
        extra_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT INTO items (
        id, user_id, kind, text, data_url, width, height, ts, pinned, source,
        vaulted, iv, ct, client_updated_at, extra_json, updated_at
      ) SELECT
        id, user_id, kind, text, data_url, width, height, ts, pinned, source,
        COALESCE(vaulted, 0), iv, ct, ts, '{}', updated_at
      FROM items_v1;
      DROP TABLE items_v1;
    `);
  })();
}

const cols = new Set(db.prepare("PRAGMA table_info(items)").all().map(c => c.name));
for (const [name, ddl] of [
  ["vaulted", "ALTER TABLE items ADD COLUMN vaulted INTEGER NOT NULL DEFAULT 0"],
  ["iv", "ALTER TABLE items ADD COLUMN iv TEXT"],
  ["ct", "ALTER TABLE items ADD COLUMN ct TEXT"],
  ["client_updated_at", "ALTER TABLE items ADD COLUMN client_updated_at INTEGER NOT NULL DEFAULT 0"],
  ["extra_json", "ALTER TABLE items ADD COLUMN extra_json TEXT NOT NULL DEFAULT '{}'"],
]) {
  if (!cols.has(name)) db.exec(ddl);
}

db.exec(`
  UPDATE items SET client_updated_at = ts WHERE client_updated_at = 0;
  CREATE INDEX IF NOT EXISTS idx_items_user_ts ON items(user_id, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_items_user_updated ON items(user_id, updated_at DESC);
`);

const stmts = {
  insertUser: db.prepare(`INSERT INTO users (token, device, created_at) VALUES (?, ?, ?)`),
  getUserByToken: db.prepare(`SELECT * FROM users WHERE token = ?`),
  upsertItem: db.prepare(`
    INSERT INTO items (
      id, user_id, kind, text, data_url, width, height, ts, pinned, source,
      vaulted, iv, ct, client_updated_at, extra_json, updated_at
    ) VALUES (
      @id, @user_id, @kind, @text, @data_url, @width, @height, @ts, @pinned,
      @source, @vaulted, @iv, @ct, @client_updated_at, @extra_json, @updated_at
    )
    ON CONFLICT(user_id, id) DO UPDATE SET
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
      client_updated_at = excluded.client_updated_at,
      extra_json = excluded.extra_json,
      updated_at = excluded.updated_at
    WHERE excluded.client_updated_at >= items.client_updated_at
  `),
  itemsSince: db.prepare(`
    SELECT id, kind, text, data_url, width, height, ts, pinned, source,
           vaulted, iv, ct, client_updated_at, extra_json
    FROM items
    WHERE user_id = ? AND updated_at > ?
    ORDER BY ts DESC
    LIMIT 500
  `),
  countItems: db.prepare(`SELECT COUNT(*) as n FROM items WHERE user_id = ?`),
};

function finiteInteger(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function extraFields(item) {
  const base = new Set([
    "id", "kind", "text", "dataUrl", "width", "height", "ts", "pinned",
    "source", "vaulted", "iv", "ct", "updatedAt",
  ]);
  return Object.fromEntries(Object.entries(item || {}).filter(([key]) => !base.has(key)));
}

export function createUser(token, device) {
  stmts.insertUser.run(token, device || "", Date.now());
  return stmts.getUserByToken.get(token);
}

export function findUserByToken(token) {
  return stmts.getUserByToken.get(token);
}

export const upsertItems = db.transaction((userId, items) => {
  const serverNow = Date.now();
  for (const item of items) {
    if (!item?.id) continue;
    const ts = finiteInteger(item.ts, serverNow);
    const clientUpdatedAt = finiteInteger(item.updatedAt, ts);
    stmts.upsertItem.run({
      id: String(item.id),
      user_id: userId,
      kind: item.kind || "text",
      text: item.text || "",
      data_url: item.dataUrl || "",
      width: finiteInteger(item.width),
      height: finiteInteger(item.height),
      ts,
      pinned: item.pinned ? 1 : 0,
      source: item.source || "",
      vaulted: item.vaulted ? 1 : 0,
      iv: item.iv || "",
      ct: item.ct || "",
      client_updated_at: clientUpdatedAt,
      extra_json: JSON.stringify(extraFields(item)),
      updated_at: serverNow,
    });
  }
});

export function itemsForUserSince(userId, since) {
  const watermark = Math.max(0, finiteInteger(since));
  return stmts.itemsSince.all(userId, watermark).map(row => {
    let extra = {};
    try { extra = JSON.parse(row.extra_json || "{}"); } catch {}
    return {
      ...extra,
      id: row.id,
      kind: row.kind,
      text: row.text,
      dataUrl: row.data_url,
      width: row.width,
      height: row.height,
      ts: row.ts,
      pinned: !!row.pinned,
      source: row.source,
      vaulted: !!row.vaulted,
      iv: row.iv || "",
      ct: row.ct || "",
      updatedAt: row.client_updated_at,
    };
  });
}

export function itemCount(userId) {
  return stmts.countItems.get(userId).n;
}

export default db;
