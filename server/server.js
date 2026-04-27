import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import {
  createUser, findUserByToken,
  upsertItems, itemsForUserSince, itemCount,
} from "./db.js";

const app = express();
const PORT = process.env.PORT || 8787;

app.use(cors({
  origin: true,
  credentials: false,
}));
// Allow up to 20MB so reasonable images can sync.
app.use(express.json({ limit: "20mb" }));

app.get("/api/health", (req, res) => {
  res.json({ ok: true, ts: Date.now(), service: "clipboard-sync" });
});

// Anonymous device registration -> opaque bearer token
app.post("/api/auth/register", (req, res) => {
  const device = (req.body?.device || "").slice(0, 200);
  const token = crypto.randomBytes(24).toString("base64url");
  createUser(token, device);
  res.json({ token });
});

function requireAuth(req, res, next) {
  const h = req.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/);
  if (!m) return res.status(401).json({ error: "missing bearer token" });
  const user = findUserByToken(m[1]);
  if (!user) return res.status(401).json({ error: "invalid token" });
  req.user = user;
  next();
}

// Pull: items updated after ?since=<ms>
app.get("/api/items", requireAuth, (req, res) => {
  const since = parseInt(req.query.since, 10) || 0;
  const items = itemsForUserSince(req.user.id, since);
  res.json({ items, ts: Date.now() });
});

// Push: merge items from this device. Server returns latest items so the
// client can reconcile in a single roundtrip.
app.post("/api/items", requireAuth, (req, res) => {
  const incoming = Array.isArray(req.body?.items) ? req.body.items : [];
  // Trim to 100 items per request as a sanity guard
  const trimmed = incoming.slice(0, 100);
  upsertItems(req.user.id, trimmed);
  const items = itemsForUserSince(req.user.id, 0).slice(0, 50);
  res.json({ ok: true, count: itemCount(req.user.id), items, ts: Date.now() });
});

// Friendly root for browser visits
app.get("/", (req, res) => {
  res.type("html").send(`<!doctype html>
    <meta charset="utf-8">
    <title>Clipboard Sync</title>
    <style>
      body { font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 60px auto; color: #1d1d1f; padding: 0 20px; }
      h1 { letter-spacing: -0.02em; }
      code { background: #f2f2f7; padding: 2px 6px; border-radius: 4px; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 13px; }
      .ok { color: #30d158; }
    </style>
    <h1>Clipboard Sync <span class="ok">●</span></h1>
    <p>Server is running on port <code>${PORT}</code>.</p>
    <p>Add this URL in the extension's settings to enable cross-device sync.</p>
    <p>Endpoints: <code>/api/health</code>, <code>/api/auth/register</code>, <code>/api/items</code>.</p>
  `);
});

app.listen(PORT, () => {
  console.log(`Clipboard sync server listening on http://localhost:${PORT}`);
});
