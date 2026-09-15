import {
  applyTheme,
  ACCENTS,
  DEFAULT_REQUIRED_MINUTES,
  DEFAULT_LEAVE_MINUTES,
  DEFAULT_HEADSUP_MINUTES,
  DEFAULT_THEME,
  DEFAULT_ACCENT,
} from "./shared.js";

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");

let theme = DEFAULT_THEME;
let accent = DEFAULT_ACCENT;

function paintAppearance() {
  applyTheme(theme, accent);
  document.querySelectorAll("#themeSeg button").forEach((b) =>
    b.classList.toggle("active", b.dataset.themeVal === theme)
  );
  document.querySelectorAll(".swatch").forEach((s) =>
    s.classList.toggle("active", s.dataset.accent === accent)
  );
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
    "subdomain",
    "empId",
    "theme",
    "accent",
    "gtUser",
    "gtPass",
    "autoLogin",
  ]);
  theme = store.theme || DEFAULT_THEME;
  accent = store.accent || DEFAULT_ACCENT;
  buildSwatches();
  paintAppearance();

  const total = store.requiredMinutes || DEFAULT_REQUIRED_MINUTES;
  $("hours").value = Math.floor(total / 60);
  $("minutes").value = total % 60;
  const lv = store.leaveMinutes ?? DEFAULT_LEAVE_MINUTES;
  $("leaveTime").value = `${pad(Math.floor(lv / 60))}:${pad(lv % 60)}`;
  $("headsUp").value = store.headsUpMinutes ?? DEFAULT_HEADSUP_MINUTES;
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
  };
  const lv = $("leaveTime").value; // "HH:MM"
  if (lv && /^\d{2}:\d{2}$/.test(lv)) {
    const [lh, lm] = lv.split(":").map(Number);
    patch.leaveMinutes = lh * 60 + lm;
  }
  patch.headsUpMinutes = Math.max(0, parseInt($("headsUp").value, 10) || 0);
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

$("save").addEventListener("click", save);
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
