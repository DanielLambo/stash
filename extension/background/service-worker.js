// MV3 service worker. Receives capture events from content scripts,
// stores them, and pushes/pulls from the sync backend on a schedule.
//
// SAFETY GUARANTEES:
//   • Only acts on capture, sync, screenshot, status, and health messages.
//     Anything else is ignored.
//   • The capture handler is event-driven: it runs only when the
//     content script forwards a `copy`/`cut` event the user themselves
//     triggered, or when the popup user-initiates a manual capture.
//     There is no polling.
//   • Before storage, sensitive items are detected and either
//     encrypted (Vault unlocked), flagged for the user (Vault not set
//     up), or dropped with a visible 🔒 badge (Vault locked).
//   • Sync only runs when `syncEnabled === true` AND `syncUrl` is
//     non-empty — so a fresh install makes zero network requests.
//   • This file logs only HTTP-level errors, never clipboard contents.

import {
  addItem, getItems, getSettings, setItems,
} from "../lib/storage.js";
import { pushItems, pullItems } from "../lib/api.js";
import { detectSensitive, describeKind } from "../lib/sensitive.js";
import { encryptItem, isUnlocked, isSetup } from "../lib/crypto.js";

const SYNC_ALARM = "clipboard-sync";
const SYNC_RETRY_ALARM = "clipboard-sync-retry";
const SYNC_STATUS_KEY = "clipboard_sync_status";
let syncPromise = null;

async function writeSyncStatus(patch) {
  const current = (await chrome.storage.local.get(SYNC_STATUS_KEY))[SYNC_STATUS_KEY] || {};
  const next = { ...current, ...patch, updatedAt: Date.now() };
  await chrome.storage.local.set({ [SYNC_STATUS_KEY]: next });
  return next;
}

async function scheduleRetry(error) {
  const current = (await chrome.storage.local.get(SYNC_STATUS_KEY))[SYNC_STATUS_KEY] || {};
  const attempts = Math.min(10, (Number(current.attempts) || 0) + 1);
  const delayMinutes = Math.min(30, Math.pow(2, attempts - 1));
  const nextRetryAt = Date.now() + delayMinutes * 60000;
  await writeSyncStatus({
    state: typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "retrying",
    attempts,
    nextRetryAt,
    error: String(error?.message || error || "Sync failed"),
  });
  chrome.alarms.create(SYNC_RETRY_ALARM, { when: nextRetryAt });
}

// Hard ceiling for stored image data URLs. ~5 MB of base64 is roughly a
// 3.7 MB binary image — well above typical screenshots, and still safe with
// the unlimitedStorage permission.
const MAX_IMAGE_DATA_URL_BYTES = 5 * 1024 * 1024;

async function isBlocked(host) {
  if (!host) return false;
  const { blocklist = [] } = await getSettings();
  return blocklist.some(h => host === h || host.endsWith(`.${h}`));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "capture" || msg?.type === "capture-manual") {
        const manual = msg.type === "capture-manual";
        const settings = await getSettings();
        if (!settings.enabled || (!manual && !settings.capturePages)) return sendResponse({ ok: false });
        if (msg.payload.kind === "image" && !settings.captureImages) return sendResponse({ ok: false });
        if (msg.payload.kind === "image" && (msg.payload.dataUrl || "").length > MAX_IMAGE_DATA_URL_BYTES) {
          return sendResponse({ ok: false, reason: "image_too_large" });
        }
        if (!manual && await isBlocked(msg.payload.source)) return sendResponse({ ok: false });

        // Vault: detect sensitive text and encrypt before it ever lands
        // in chrome.storage.local. If vault is locked or unconfigured,
        // refuse to capture and notify (rather than store plaintext).
        let payload = msg.payload;
        if (!settings.captureRichText && ["rich", "table"].includes(payload.kind)) {
          payload = { ...payload, kind: "text", html: "", tableCsv: "", tableMarkdown: "" };
        }
        if (!settings.capturePageContext) {
          payload = { ...payload, sourceUrl: "", sourceTitle: "" };
        }
        if (settings.autoVault && !["image", "file"].includes(payload.kind)) {
          const det = payload.sensitiveHint === "password"
            ? { sensitive: true, kind: "password", confidence: 1 }
            : detectSensitive(payload.text || "");
          // This capture-only hint is never persisted or synced.
          if (Object.prototype.hasOwnProperty.call(payload, "sensitiveHint")) {
            const { sensitiveHint: _sensitiveHint, ...cleanPayload } = payload;
            payload = cleanPayload;
          }
          if (det.sensitive) {
            // POLICY: a sensitive item never lands in chrome.storage as
            // plaintext. We refuse to store it unless the Vault is set
            // up AND unlocked at this moment. Any other state drops
            // the capture and surfaces a 🔒 badge so the user knows.
            if (!(await isSetup())) {
              try {
                chrome.action.setBadgeText({ text: "🔒" });
                chrome.action.setBadgeBackgroundColor({ color: "#ff9f0a" });
                setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2500);
              } catch {}
              // Persist a one-shot flag so the popup can show a
              // banner inviting the user to set up Vault. The flag
              // is metadata only — it never contains the captured
              // plaintext.
              await chrome.storage.local.set({
                sensitive_capture_pending: { ts: Date.now(), kind: det.kind },
              });
              return sendResponse({ ok: false, reason: "vault_not_setup" });
            } else if (await isUnlocked()) {
              const encrypted = await encryptItem({
                ...payload,
                vaultMeta: { kind: det.kind, label: describeKind(det.kind) },
              });
              if (encrypted) payload = encrypted;
              else {
                // Encryption failed for some reason; refuse to store
                // plaintext as a fallback.
                return sendResponse({ ok: false, reason: "encrypt_failed" });
              }
            } else {
              // Vault is set up but locked. Drop the capture; alert
              // via badge.
              try {
                chrome.action.setBadgeText({ text: "🔒" });
                chrome.action.setBadgeBackgroundColor({ color: "#ff453a" });
                setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2500);
              } catch {}
              await chrome.storage.local.set({
                sensitive_capture_pending: { ts: Date.now(), kind: det.kind, reason: "vault_locked" },
              });
              return sendResponse({ ok: false, reason: "vault_locked" });
            }
          }
        }

        const saved = await addItem(payload);
        if (saved) {
          await pushDebounced();
          if (settings.showNotifications) {
            try {
              chrome.action.setBadgeText({ text: "•" });
              chrome.action.setBadgeBackgroundColor({ color: "#0a84ff" });
              setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1200);
            } catch {}
          }
        }
        return sendResponse({ ok: true, saved });
      }
      if (msg?.type === "sync-now") {
        const r = await syncRoundtrip();
        return sendResponse(r);
      }
      if (msg?.type === "sync-status") {
        const status = (await chrome.storage.local.get(SYNC_STATUS_KEY))[SYNC_STATUS_KEY] || { state: "idle" };
        return sendResponse({ ok: true, status });
      }
      if (msg?.type === "capture-screenshot") {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const dataUrl = await chrome.tabs.captureVisibleTab(activeTab?.windowId, { format: "png" });
        return sendResponse({ ok: true, dataUrl });
      }
      if (msg?.type === "ping") {
        return sendResponse({ ok: true, ts: Date.now() });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // async sendResponse
});

// Debounced push so we don't hammer the server on rapid copies.
let pushTimer = null;
async function pushDebounced() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try {
      const items = await getItems();
      const settings = await getSettings();
      if (!settings.syncEnabled) return;
      await pushItems(items);
      await chrome.storage.local.set({ clipboard_last_sync_error: "" });
      await writeSyncStatus({ state: "synced", attempts: 0, nextRetryAt: 0, error: "", lastSuccessAt: Date.now() });
    } catch (e) {
      await chrome.storage.local.set({ clipboard_last_sync_error: String(e?.message || e) });
      await scheduleRetry(e);
    }
  }, 800);
}

async function syncRoundtrip() {
  if (syncPromise) return syncPromise;
  syncPromise = performSyncRoundtrip().finally(() => { syncPromise = null; });
  return syncPromise;
}

async function performSyncRoundtrip() {
  const settings = await getSettings();
  if (!settings.syncEnabled || !settings.syncUrl) {
    await writeSyncStatus({ state: "disabled", attempts: 0, nextRetryAt: 0, error: "" });
    return { ok: true, skipped: true };
  }
  await writeSyncStatus({ state: "syncing", error: "" });

  const localItems = await getItems();
  let pushOk = true;
  let pushErr = null;
  try {
    var pushed = await pushItems(localItems);
  } catch (e) {
    pushOk = false;
    pushErr = e;
  }

  const lastSync = (await chrome.storage.local.get("clipboard_last_sync")).clipboard_last_sync || 0;
  let remote = null;
  let pullErr = null;
  try {
    remote = await pullItems(lastSync);
  } catch (e) {
    pullErr = e;
  }

  const incoming = [...(pushed?.items || []), ...(remote?.items || [])];
  if (incoming.length) {
    // Merge by mutation timestamp. ts controls display recency; updatedAt
    // controls conflict resolution so an older clip edited later still wins.
    const byId = new Map();
    for (const i of localItems) byId.set(i.id, i);
    for (const i of incoming) {
      const cur = byId.get(i.id);
      const remoteVersion = Number(i.updatedAt) || Number(i.ts) || 0;
      const localVersion = Number(cur?.updatedAt) || Number(cur?.ts) || 0;
      if (!cur || remoteVersion > localVersion) byId.set(i.id, i);
    }
    const merged = [...byId.values()].sort((a, b) => b.ts - a.ts);
    const pinned = merged.filter(i => i.pinned);
    const unpinned = merged.filter(i => !i.pinned).slice(0, settings.maxItems);
    const final = merged.filter(i => i.pinned || unpinned.includes(i));
    await setItems(final);
  }

  // Only advance the lastSync watermark when the pull actually succeeded —
  // otherwise we'd permanently miss whatever happened during a network blip.
  if (!pullErr) {
    await chrome.storage.local.set({
      clipboard_last_sync: remote?.ts || Date.now(),
      clipboard_last_sync_error: pushOk ? "" : String(pushErr?.message || pushErr),
    });
  } else {
    await chrome.storage.local.set({
      clipboard_last_sync_error: String(pullErr?.message || pullErr),
    });
  }

  if (pushOk && !pullErr) {
    await writeSyncStatus({
      state: "synced", attempts: 0, nextRetryAt: 0, error: "",
      lastSuccessAt: Date.now(), pushed: localItems.length, pulled: incoming.length,
    });
    chrome.alarms.clear(SYNC_RETRY_ALARM);
  } else {
    await scheduleRetry(pullErr || pushErr);
  }

  return {
    ok: pushOk && !pullErr,
    pulled: incoming.length,
    error: pullErr ? String(pullErr.message || pullErr) : pushOk ? null : String(pushErr.message || pushErr),
  };
}

function ensureAlarm() {
  chrome.alarms.get(SYNC_ALARM, a => {
    if (!a) chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 5 });
  });
}

chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === SYNC_ALARM || alarm.name === SYNC_RETRY_ALARM) {
    const settings = await getSettings();
    if (settings.syncEnabled) syncRoundtrip().catch(() => {});
  }
});

try {
  self.addEventListener("online", () => syncRoundtrip().catch(() => {}));
} catch {}

// React to settings changes (e.g. user toggled sync) by syncing once.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.clipboard_settings) {
    const next = changes.clipboard_settings.newValue;
    if (next?.syncEnabled) syncRoundtrip().catch(() => {});
  }
});
