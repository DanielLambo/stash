import {
  getSettings, setSettings, getItems, setItems,
  getSnippets, upsertSnippet, removeSnippet,
} from "../lib/storage.js";
import { pingServer } from "../lib/api.js";
import { isSetup as vaultIsSetup, isUnlocked as vaultIsUnlocked, setupVault, lockVault } from "../lib/crypto.js";

const $ = sel => document.querySelector(sel);
const saveStatus = $("#saveStatus");

let settings;

function applyTheme(theme) {
  if (theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

function flashSaved() {
  saveStatus.textContent = "Saved";
  saveStatus.classList.add("flash");
  clearTimeout(flashSaved._t);
  flashSaved._t = setTimeout(() => {
    saveStatus.textContent = "All changes saved automatically";
    saveStatus.classList.remove("flash");
  }, 1200);
}

async function load() {
  settings = await getSettings();
  applyTheme(settings.theme);
  $("#enabled").checked = settings.enabled;
  $("#captureImages").checked = settings.captureImages;
  $("#capturePages").checked = settings.capturePages;
  $("#showNotifications").checked = settings.showNotifications;
  $("#syncEnabled").checked = settings.syncEnabled;
  $("#syncUrl").value = settings.syncUrl || "";
  $("#blocklist").value = (settings.blocklist || []).join("\n");
  $("#maxItems").value = settings.maxItems;
  $("#maxValue").textContent = settings.maxItems;
  $("#maxLabel").textContent = settings.maxItems;
  $("#snippetsEnabled").checked = settings.snippetsEnabled !== false;
  $("#autoVault").checked = settings.autoVault !== false;
  document.querySelectorAll("#theme button").forEach(b => {
    b.classList.toggle("active", b.dataset.value === settings.theme);
  });
  await renderSnippets();
  await renderVaultStatus();
}

async function renderVaultStatus() {
  const setup = await vaultIsSetup();
  const unlocked = await vaultIsUnlocked();
  const status = $("#vault-setup-status");
  const btn = $("#vault-setup-btn");
  const lockBtn = $("#vault-lock-btn");
  if (!setup) {
    status.textContent = "Not set up. Choose a password to enable encryption.";
    btn.textContent = "Set master password";
    btn.hidden = false;
    lockBtn.hidden = true;
  } else {
    status.textContent = unlocked
      ? "Set up · vault is unlocked for this session."
      : "Set up · vault is locked. Click any vaulted item in the popup to unlock.";
    btn.hidden = true;
    lockBtn.hidden = !unlocked;
  }
}

async function update(patch) {
  settings = await setSettings(patch);
  flashSaved();
}

/* Wiring */
$("#enabled").addEventListener("change", e => update({ enabled: e.target.checked }));
$("#captureImages").addEventListener("change", e => update({ captureImages: e.target.checked }));
$("#capturePages").addEventListener("change", e => update({ capturePages: e.target.checked }));
$("#showNotifications").addEventListener("change", e => update({ showNotifications: e.target.checked }));
$("#syncEnabled").addEventListener("change", e => update({ syncEnabled: e.target.checked }));

$("#syncUrl").addEventListener("change", e => {
  let v = e.target.value.trim();
  if (v && !/^https?:\/\//.test(v)) v = "http://" + v;
  v = v.replace(/\/+$/, "");
  e.target.value = v;
  update({ syncUrl: v, syncToken: "" }); // reset token when server changes
});

$("#blocklist").addEventListener("change", e => {
  const list = e.target.value.split("\n").map(s => s.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean);
  update({ blocklist: list });
});

$("#maxItems").addEventListener("input", e => {
  $("#maxValue").textContent = e.target.value;
  $("#maxLabel").textContent = e.target.value;
});
$("#maxItems").addEventListener("change", e => update({ maxItems: parseInt(e.target.value, 10) }));

document.querySelectorAll("#theme button").forEach(b => {
  b.addEventListener("click", () => {
    document.querySelectorAll("#theme button").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    update({ theme: b.dataset.value });
    applyTheme(b.dataset.value);
  });
});

$("#testSync").addEventListener("click", async () => {
  $("#syncStatus").textContent = "Testing…";
  const ok = await pingServer();
  $("#syncStatus").textContent = ok ? "Connected ✓" : "Could not reach server.";
  $("#syncStatus").style.color = ok ? "var(--success)" : "var(--danger)";
});

$("#syncNow").addEventListener("click", async () => {
  $("#syncStatus").textContent = "Syncing…";
  const r = await chrome.runtime.sendMessage({ type: "sync-now" });
  if (r?.ok) {
    $("#syncStatus").textContent = r.skipped ? "Sync is disabled." : `Synced. Pulled ${r.pulled} item${r.pulled === 1 ? "" : "s"}.`;
    $("#syncStatus").style.color = "var(--success)";
  } else {
    $("#syncStatus").textContent = "Sync failed.";
    $("#syncStatus").style.color = "var(--danger)";
  }
});

$("#resetToken").addEventListener("click", async () => {
  await update({ syncToken: "" });
  $("#syncStatus").textContent = "Token reset.";
  $("#syncStatus").style.color = "var(--text-secondary)";
});

$("#exportBtn").addEventListener("click", async () => {
  const items = await getItems();
  const blob = new Blob([JSON.stringify({ items, exportedAt: Date.now() }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `clipboard-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$("#clearAllBtn").addEventListener("click", async () => {
  if (!confirm("Remove ALL clipboard items, including pinned?")) return;
  await setItems([]);
  flashSaved();
});

/* Vault */
$("#autoVault").addEventListener("change", e => update({ autoVault: e.target.checked }));

// Vault setup uses a styled in-page overlay rather than `window.prompt`.
// Both inputs are `type=password` so the OS / password manager treats
// them as masked, the user can copy/paste from a manager, and the flow
// supports retry + cancel without losing input.
function openVaultSetupOverlay() {
  const overlay = $("#vault-setup-overlay");
  const pw1 = $("#vault-setup-pw");
  const pw2 = $("#vault-setup-pw2");
  const err = $("#vault-setup-err");
  pw1.value = ""; pw2.value = ""; err.textContent = "";
  overlay.classList.remove("hidden");
  setTimeout(() => pw1.focus(), 60);
}
function closeVaultSetupOverlay() {
  $("#vault-setup-overlay").classList.add("hidden");
}

async function submitVaultSetup() {
  const pw1 = $("#vault-setup-pw").value;
  const pw2 = $("#vault-setup-pw2").value;
  const err = $("#vault-setup-err");
  if (!pw1) { err.textContent = "Password required."; $("#vault-setup-pw").focus(); return; }
  if (pw1.length < 6) { err.textContent = "Use at least 6 characters."; $("#vault-setup-pw").focus(); return; }
  if (pw1 !== pw2) { err.textContent = "Passwords don't match."; $("#vault-setup-pw2").focus(); $("#vault-setup-pw2").select(); return; }
  err.textContent = "Setting up…";
  try {
    await setupVault(pw1);
    closeVaultSetupOverlay();
    await renderVaultStatus();
    flashSaved();
  } catch (e) {
    err.textContent = `Setup failed: ${e.message || e}`;
  }
}

$("#vault-setup-btn").addEventListener("click", openVaultSetupOverlay);
$("#vault-setup-cancel").addEventListener("click", closeVaultSetupOverlay);
$("#vault-setup-confirm").addEventListener("click", submitVaultSetup);
// Enter on either field submits; Escape cancels.
for (const id of ["vault-setup-pw", "vault-setup-pw2"]) {
  $("#" + id).addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); submitVaultSetup(); }
    if (e.key === "Escape") { e.preventDefault(); closeVaultSetupOverlay(); }
  });
}

$("#vault-lock-btn").addEventListener("click", async () => {
  await lockVault();
  await renderVaultStatus();
  flashSaved();
});

/* Snippets */
$("#snippetsEnabled").addEventListener("change", e => update({ snippetsEnabled: e.target.checked }));

$("#snippet-new").addEventListener("click", () => {
  const list = $("#snippets-list");
  const draft = makeSnippetRow({ id: "", trigger: "", body: "" }, /*isDraft*/ true);
  list.prepend(draft);
  draft.querySelector(".trigger").focus();
});

async function renderSnippets() {
  const list = $("#snippets-list");
  list.innerHTML = "";
  const all = await getSnippets();
  for (const s of all) list.appendChild(makeSnippetRow(s, false));
}

function makeSnippetRow(s, isDraft) {
  const row = document.createElement("div");
  row.className = "snippet-row";
  row.dataset.id = s.id || "";
  row.innerHTML = `
    <input class="trigger" type="text" placeholder=";trigger" spellcheck="false" />
    <textarea class="body" rows="1" placeholder="Expanded text. Use {cursor}, {date}, {clipboard}, {input:Label}."></textarea>
    <div class="actions">
      <button class="icon-btn save" title="Save">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      </button>
      <button class="icon-btn danger delete" title="Delete">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </div>
    <div class="err" hidden></div>
  `;
  row.querySelector(".trigger").value = s.trigger || "";
  row.querySelector(".body").value = s.body || "";

  const err = row.querySelector(".err");
  function showErr(msg) {
    err.textContent = msg || "";
    err.hidden = !msg;
  }

  async function save() {
    const trigger = row.querySelector(".trigger").value.trim();
    const body = row.querySelector(".body").value;
    if (!trigger) { showErr("Trigger required."); return; }
    if (!body) { showErr("Body required."); return; }
    try {
      const saved = await upsertSnippet({
        id: row.dataset.id || undefined,
        trigger, body,
      });
      row.dataset.id = saved.id;
      showErr("");
      flashSaved();
    } catch (e) {
      showErr(String(e.message || e));
    }
  }

  row.querySelector(".save").addEventListener("click", save);
  row.querySelector(".delete").addEventListener("click", async () => {
    if (!row.dataset.id) {
      // unsaved draft — just remove from DOM
      row.remove();
      return;
    }
    if (!confirm(`Delete snippet "${row.querySelector(".trigger").value || row.dataset.id}"?`)) return;
    await removeSnippet(row.dataset.id);
    row.remove();
    flashSaved();
  });

  // Save on Enter from the trigger field; Cmd/Ctrl+Enter from body.
  row.querySelector(".trigger").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); save(); }
  });
  row.querySelector(".body").addEventListener("keydown", e => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); save(); }
  });

  return row;
}

load();
