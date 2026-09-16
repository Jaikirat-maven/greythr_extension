import {
  applyTheme,
  ACCENTS,
  DEFAULT_REQUIRED_MINUTES,
  DEFAULT_LEAVE_MINUTES,
  DEFAULT_HEADSUP_MINUTES,
  DEFAULT_AUTO_OPEN_MINUTES,
  DEFAULT_THEME,
  DEFAULT_ACCENT,
  DEFAULT_STATE_COLORS,
} from "./shared.js";

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");

let theme = DEFAULT_THEME;
let accent = DEFAULT_ACCENT; // a preset key ("blue") or a hex ("#3b82f6")
let colors = { ...DEFAULT_STATE_COLORS };

// The single hex the colour wheel should show for the current accent.
function effectiveAccentHex() {
  if (ACCENTS[accent]) return ACCENTS[accent][0];
  if (typeof accent === "string" && accent[0] === "#") return accent;
  return DEFAULT_ACCENT;
}

// Applies the live CSS (theme + accent + status colours) and highlights the
// active theme button / preset swatch.
function applyVars() {
  applyTheme(theme, accent, colors);
  document.querySelectorAll("#themeSeg button").forEach((b) =>
    b.classList.toggle("active", b.dataset.themeVal === theme)
  );
  const acc = String(accent).toLowerCase();
  document.querySelectorAll(".swatch").forEach((s) => {
    const key = s.dataset.accent;
    const active =
      accent === key || (ACCENTS[key] && ACCENTS[key][0].toLowerCase() === acc);
    s.classList.toggle("active", active);
  });
}

// Pushes the current state into the input controls (wheel + status pickers).
// Kept separate from applyVars so we don't stomp an input mid-drag.
function syncControls() {
  if ($("accentCustom")) $("accentCustom").value = effectiveAccentHex();
  if ($("colDone")) $("colDone").value = colors.done;
  if ($("colWaiting")) $("colWaiting").value = colors.waiting;
  if ($("colOver")) $("colOver").value = colors.over;
}

function paintAppearance() {
  applyVars();
  syncControls();
}

function buildSwatches() {
  const box = $("accentSwatches");
  box.innerHTML = "";
  for (const [key, [a1, a2]] of Object.entries(ACCENTS)) {
    const b = document.createElement("button");
    b.className = "swatch";
    b.dataset.accent = key;
    b.title = key;
    b.style.background = `linear-gradient(135deg, ${a1}, ${a2})`;
    b.addEventListener("click", () => {
      accent = key;
      chrome.storage.local.set({ accent });
      paintAppearance();
    });
    box.appendChild(b);
  }
}

// Wire the colour wheel + status-colour pickers (static elements in the HTML).
function wireColorControls() {
  const wheel = $("accentCustom");
  if (wheel) {
    wheel.addEventListener("input", () => {
      accent = wheel.value;
      applyVars(); // live preview; don't re-sync the wheel we're dragging
    });
    wheel.addEventListener("change", () => {
      accent = wheel.value;
      chrome.storage.local.set({ accent });
      applyVars();
    });
  }
  const map = { colDone: "done", colWaiting: "waiting", colOver: "over" };
  for (const [id, key] of Object.entries(map)) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener("input", () => {
      colors = { ...colors, [key]: el.value };
      applyVars();
    });
    el.addEventListener("change", () => {
      colors = { ...colors, [key]: el.value };
      chrome.storage.local.set({ colors });
    });
  }
  const reset = $("resetColors");
  if (reset) {
    reset.addEventListener("click", (e) => {
      e.preventDefault();
      colors = { ...DEFAULT_STATE_COLORS };
      chrome.storage.local.set({ colors });
      paintAppearance();
    });
  }
}

$("themeSeg").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-theme-val]");
  if (!b) return;
  theme = b.dataset.themeVal;
  chrome.storage.local.set({ theme });
  paintAppearance();
});

async function restore() {
  const store = await chrome.storage.local.get([
    "requiredMinutes",
    "leaveMinutes",
    "headsUpMinutes",
    "autoOpenMinutes",
    "subdomain",
    "empId",
    "theme",
    "accent",
    "colors",
    "gtUser",
    "gtPass",
    "autoLogin",
  ]);
  theme = store.theme || DEFAULT_THEME;
  accent = store.accent || DEFAULT_ACCENT;
  colors = { ...DEFAULT_STATE_COLORS, ...(store.colors || {}) };
  buildSwatches();
  wireColorControls();
  paintAppearance();

  const total = store.requiredMinutes || DEFAULT_REQUIRED_MINUTES;
  $("hours").value = Math.floor(total / 60);
  $("minutes").value = total % 60;
  const lv = store.leaveMinutes ?? DEFAULT_LEAVE_MINUTES;
  $("leaveTime").value = `${pad(Math.floor(lv / 60))}:${pad(lv % 60)}`;
  $("headsUp").value = store.headsUpMinutes ?? DEFAULT_HEADSUP_MINUTES;
  $("autoOpen").value = store.autoOpenMinutes ?? DEFAULT_AUTO_OPEN_MINUTES;
  $("subdomain").value = store.subdomain || "";
  $("empId").value = store.empId || "";
  $("gtUser").value = store.gtUser || "";
  $("gtPass").value = store.gtPass || "";
  $("autoLogin").checked = store.autoLogin !== false;
  paintCredState(!!store.gtUser);
}

function paintCredState(saved) {
  const el = $("credState");
  if (el) el.textContent = saved ? "Login saved on this device." : "No login saved.";
}

async function save() {
  const h = parseInt($("hours").value, 10) || 0;
  const m = parseInt($("minutes").value, 10) || 0;
  const patch = {
    requiredMinutes: h * 60 + m,
    subdomain: $("subdomain").value.trim() || "mavenvista",
    theme,
    accent,
    colors,
  };
  const lv = $("leaveTime").value; // "HH:MM"
  if (lv && /^\d{2}:\d{2}$/.test(lv)) {
    const [lh, lm] = lv.split(":").map(Number);
    patch.leaveMinutes = lh * 60 + lm;
  }
  patch.headsUpMinutes = Math.max(0, parseInt($("headsUp").value, 10) || 0);
  patch.autoOpenMinutes = Math.max(0, parseInt($("autoOpen").value, 10) || 0);
  const empId = $("empId").value.trim();
  if (empId) patch.empId = empId;

  // ESS credentials for auto re-login (device-local only). Saving new values
  // resets the failure backoff so a corrected password retries immediately.
  const gtUser = $("gtUser").value.trim();
  const gtPass = $("gtPass").value;
  if (gtUser && gtPass) {
    patch.gtUser = gtUser;
    patch.gtPass = gtPass;
    patch.autoLoginFailCount = 0;
  } else if (!gtUser && !gtPass) {
    // Both blank → leave stored creds untouched (user may only tweak hours).
  } else {
    $("saved").textContent = "Enter both username and password (or neither).";
    return;
  }
  patch.autoLogin = $("autoLogin").checked;

  await chrome.storage.local.set(patch);
  paintCredState(!!(gtUser || (await chrome.storage.local.get("gtUser")).gtUser));
  $("saved").textContent = "Saved ✓";
  setTimeout(() => ($("saved").textContent = ""), 1500);
}

// Keep appearance in sync if changed elsewhere / by system in auto mode.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", paintAppearance);

// Reflects Chrome's notification permission level (denied => nothing will ever
// show, regardless of our code — the #1 "notifications don't work" cause).
function checkNotifyPermission() {
  const el = $("notifyState");
  if (!el || !chrome.notifications || !chrome.notifications.getPermissionLevel) return;
  chrome.notifications.getPermissionLevel((level) => {
    if (level === "denied") {
      el.textContent = "⚠ Chrome/Windows is blocking notifications for this extension.";
      el.style.color = "#ef4444";
    } else {
      el.textContent = "";
    }
  });
}

$("save").addEventListener("click", save);
$("testNotify").addEventListener("click", () => {
  const el = $("notifyState");
  el.style.color = "";
  el.textContent = "Sending…";
  chrome.notifications.create(
    "test-" + Date.now(),
    {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: "Test notification 🔔",
      message: "If you see this, extension notifications work on this machine.",
      priority: 2,
    },
    (id) => {
      const err = chrome.runtime.lastError;
      if (err || !id) {
        el.style.color = "#ef4444";
        el.textContent = "Failed: " + (err ? err.message : "blocked by the OS/Chrome.");
      } else {
        el.style.color = "";
        el.textContent = "Sent — check your notification tray.";
        setTimeout(() => (el.textContent = ""), 4000);
      }
    }
  );
});
$("refreshNow").addEventListener("click", async () => {
  const el = $("refreshState");
  el.textContent = "Pinging background worker…";
  try {
    await chrome.runtime.sendMessage({ type: "GT_REFRESH_NOW" });
  } catch {
    el.textContent = "No response — the background worker looks dead. Check chrome://extensions → Errors, then reload the extension.";
    return;
  }
  setTimeout(async () => {
    const s = await chrome.storage.local
      .get(["lastBgRunAt", "lastBgStatus", "lastBgError"])
      .catch(() => ({}));
    if (!s.lastBgRunAt) {
      el.textContent = "Worker never reported a run. Check chrome://extensions → Errors.";
      return;
    }
    const secs = Math.max(0, Math.round((Date.now() - s.lastBgRunAt) / 1000));
    el.textContent =
      `Background ran ${secs}s ago: ${s.lastBgStatus}` +
      (s.lastBgStatus === "error" && s.lastBgError ? ` (${s.lastBgError})` : "");
  }, 4000);
});
$("clearCreds").addEventListener("click", async () => {
  await chrome.storage.local.remove([
    "gtUser",
    "gtPass",
    "autoLoginPendingAt",
    "autoLoginTabId",
    "autoLoginReason",
    "autoLoginFailCount",
  ]);
  $("gtUser").value = "";
  $("gtPass").value = "";
  paintCredState(false);
  $("saved").textContent = "Login forgotten ✓";
  setTimeout(() => ($("saved").textContent = ""), 1500);
});
restore();
checkNotifyPermission();
