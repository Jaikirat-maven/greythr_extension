// Shared logic used by both the popup and the background service worker.

export const DEFAULT_REQUIRED_MINUTES = 510; // 8h30m — change in Options to match your policy.
export const DEFAULT_LEAVE_MINUTES = 19 * 60; // 7:00 PM — earliest you can leave.
export const DEFAULT_HEADSUP_MINUTES = 10; // "N min till you can leave" heads-up.

// --- Theming --------------------------------------------------------------
export const DEFAULT_THEME = "auto"; // auto | light | dark
export const DEFAULT_ACCENT = "#3b82f6"; // hex; a preset key is also accepted
export const ACCENTS = {
  blue: ["#3b82f6", "#6366f1"],
  violet: ["#8b5cf6", "#6366f1"],
  green: ["#10b981", "#059669"],
  teal: ["#14b8a6", "#0ea5e9"],
  rose: ["#f43f5e", "#ec4899"],
  amber: ["#f59e0b", "#f97316"],
};
// Per-state colors (the ring/pill change with the situation).
export const DEFAULT_STATE_COLORS = {
  done: "#22c55e", // complete / ready to leave
  waiting: "#f59e0b", // clocked out / work done, waiting for leave time
  over: "#ef4444", // over the break budget
};

// --- small hex/HSL helpers (for deriving a gradient from one accent color) --
function hexToRgb(h) {
  h = String(h).replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h * 360, s, l];
}
function hslToRgb(h, s, l) {
  h /= 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3) * 255, hue2rgb(p, q, h) * 255, hue2rgb(p, q, h - 1 / 3) * 255];
}
// A single accent hex → a pleasant two-stop gradient (hue-shifted second stop).
export function deriveGradient(hex) {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const [r2, g2, b2] = hslToRgb((h + 18) % 360, s, Math.min(1, l * 1.03));
  return [hex, rgbToHex(r2, g2, b2)];
}

// Applies theme (resolving "auto" against the OS), accent and state colors to
// <html>. Only call from a document context (popup/options), not the SW.
export function applyTheme(theme = DEFAULT_THEME, accent = DEFAULT_ACCENT, colors) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const resolved =
    theme === "auto"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme || "light";
  root.setAttribute("data-theme", resolved);

  let a1, a2;
  if (accent && ACCENTS[accent]) [a1, a2] = ACCENTS[accent];
  else if (typeof accent === "string" && accent[0] === "#") [a1, a2] = deriveGradient(accent);
  else [a1, a2] = deriveGradient(DEFAULT_ACCENT);
  root.style.setProperty("--blue", a1);
  root.style.setProperty("--indigo", a2);

  const c = colors || {};
  root.style.setProperty("--green", c.done || DEFAULT_STATE_COLORS.done);
  root.style.setProperty("--amber", c.waiting || DEFAULT_STATE_COLORS.waiting);
  root.style.setProperty("--red", c.over || DEFAULT_STATE_COLORS.over);
}

// greytHR sends punchDateTime as ISO *without* a timezone, but the value is UTC.
// Parsing it as UTC keeps a live "still clocked in" segment correct against local `now`.
export function parseUtc(s) {
  return new Date(s.endsWith("Z") ? s : s + "Z");
}

// Local YYYY-MM-DD for the swipes query (matches what the portal sends).
export function todayStr(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function monthStartStr(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`;
}

// Shared GET against the greytHR API using the user's session cookies.
async function apiGet(url) {
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: {
      accept: "application/json",
      "x-requested-with": "XMLHttpRequest",
      "csrf-token": "",
      "api-scope": "web",
    },
  });
  if (res.status === 401 || res.status === 403) {
    const e = new Error("Not signed in to greytHR");
    e.code = 401;
    throw e;
  }
  if (!res.ok) {
    const e = new Error("greytHR returned HTTP " + res.status);
    e.code = res.status;
    throw e;
  }
  return res.json();
}

export function buildSwipesUrl(subdomain, empId, date = todayStr()) {
  return `https://${subdomain}.greythr.com/latte/v3/attendance/info/${empId}` +
    `/swipes?startDate=${date}&endDate=&systemSwipes=true&swipePairs=true`;
}

// Today's (or a given day's) swipes.
export function fetchSwipes(subdomain, empId, date = todayStr()) {
  return apiGet(buildSwipesUrl(subdomain, empId, date));
}

// Monthly aggregate stats (avg in/out, late-ins, present/absent counts, ...).
export function fetchInsights(subdomain, empId, monthStart) {
  return apiGet(
    `https://${subdomain}.greythr.com/latte/v3/attendance/info/${empId}` +
      `/insights?startDate=${monthStart}&endDate=&shiftType=regular_shift&session=`
  );
}

// Month calendar grid (per-day status). month is 1-based.
export function fetchCalendar(subdomain, empId, year, month) {
  return apiGet(
    `https://${subdomain}.greythr.com/latte/v3/attendance/info/calendar/${month}/${year}/${empId}`
  );
}

// Turns a swipes response into worked/remaining figures.
// requiredSec is the daily target (net worked seconds, breaks excluded).
// opts.now    — reference time for live "clocked in" counting (default now)
// opts.countLive — add live time for a dangling IN (default true; pass false for past dates)
export function computeAttendance(data, requiredSec, opts = {}) {
  const now = opts.now || new Date();
  const countLive = opts.countLive !== false;

  const pairs = Array.isArray(data.swipePairs) ? data.swipePairs : [];
  let workedSec = 0;
  const segments = [];
  for (const p of pairs) {
    let sec;
    if (typeof p.actualHours === "number") {
      sec = p.actualHours; // already seconds
    } else {
      sec = Math.max(0, (parseUtc(p.outSwipe) - parseUtc(p.inSwipe)) / 1000);
    }
    workedSec += sec;
    segments.push({
      in: parseUtc(p.inSwipe),
      out: parseUtc(p.outSwipe),
      sec,
      open: false,
    });
  }

  const swipes = (Array.isArray(data.swipe) ? data.swipe : [])
    .slice()
    .sort((a, b) => parseUtc(a.punchDateTime) - parseUtc(b.punchDateTime));
  const last = swipes[swipes.length - 1];

  // Last swipe is an IN with no matching OUT => still clocked in.
  let clockedIn = false;
  let openInTime = null;
  if (last && last.inOutIndicator === 1) {
    clockedIn = true;
    openInTime = parseUtc(last.punchDateTime);
    if (countLive) {
      const liveSec = Math.max(0, (now - openInTime) / 1000);
      workedSec += liveSec;
      segments.push({ in: openInTime, out: null, sec: liveSec, open: true });
    } else {
      segments.push({ in: openInTime, out: null, sec: 0, open: true });
    }
  }

  const remainingSec = Math.max(0, requiredSec - workedSec);
  const completed = workedSec >= requiredSec;
  const firstIn = swipes.length ? parseUtc(swipes[0].punchDateTime) : null;

  // Break bookkeeping: every IN after the first marks a returned-from break.
  const inCount = swipes.reduce((n, s) => n + (s.inOutIndicator === 1 ? 1 : 0), 0);
  const breakCount = Math.max(0, inCount - 1);
  let lastBreakSec = null;
  let lastInIdx = -1;
  for (let i = 0; i < swipes.length; i++) if (swipes[i].inOutIndicator === 1) lastInIdx = i;
  if (lastInIdx > 0) {
    lastBreakSec = Math.max(
      0,
      (parseUtc(swipes[lastInIdx].punchDateTime) - parseUtc(swipes[lastInIdx - 1].punchDateTime)) / 1000
    );
  }

  // Leave-time floor + break budget.
  // You can't leave before `leaveMinutes` (clock time), and you still owe
  // `requiredSec` of work. Break budget is the slack between the two.
  // Break taken is independent of the leave time, so it works on past days too.
  // Reference: live now while clocked in / today; else the last swipe of the day.
  let breakTakenSec = null;
  if (firstIn) {
    const refEnd = clockedIn || countLive
      ? now
      : last
      ? parseUtc(last.punchDateTime)
      : now;
    breakTakenSec = Math.max(0, (refEnd - firstIn) / 1000 - workedSec);
  }

  const leaveMinutes = opts.leaveMinutes;
  let earliestLeave = null;
  let tillLeaveSec = null;
  let canLeave = null;
  let breakBudgetSec = null;
  let breakLeftSec = null;
  if (leaveMinutes != null && firstIn) {
    const leaveAt = new Date(now);
    leaveAt.setHours(0, 0, 0, 0);
    leaveAt.setMinutes(leaveMinutes);
    const completeAt = new Date(now.getTime() + remainingSec * 1000);
    earliestLeave = new Date(Math.max(leaveAt.getTime(), completeAt.getTime()));
    tillLeaveSec = Math.max(0, (earliestLeave - now) / 1000);
    canLeave = tillLeaveSec <= 0;
    breakBudgetSec = Math.max(0, (leaveAt - firstIn) / 1000 - requiredSec);
    breakLeftSec = Math.max(0, breakBudgetSec - (breakTakenSec || 0));
  }

  return {
    workedSec,
    remainingSec,
    requiredSec,
    progress: requiredSec > 0 ? Math.min(1, workedSec / requiredSec) : 0,
    clockedIn,
    completed,
    firstIn,
    earliestLeave,
    tillLeaveSec,
    canLeave,
    breakBudgetSec,
    breakTakenSec,
    breakLeftSec,
    breakCount,
    lastBreakSec,
    segments,
    lastSwipe: last ? parseUtc(last.punchDateTime) : null,
    lastIsOut: last ? last.inOutIndicator === 0 : false,
    pairCount: pairs.length,
    hasData: swipes.length > 0,
  };
}

// --- Cache (stale-while-revalidate) ---------------------------------------
// Keyed by date string so the popup can paint instantly from the last state
// while it revalidates in the background. Capped to a few recent days.
const CACHE_MAX_DAYS = 5;

export async function loadCache() {
  const { cache } = await chrome.storage.local.get("cache");
  return cache || {};
}

export async function saveCache(dateKey, data) {
  const cache = await loadCache();
  cache[dateKey] = { data, at: Date.now() };
  for (const k of Object.keys(cache).sort().slice(0, -CACHE_MAX_DAYS)) {
    delete cache[k];
  }
  await chrome.storage.local.set({ cache });
  return cache[dateKey];
}

export function fmtAge(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

// Sets the toolbar badge from a computeAttendance result. Works from both the
// popup and the service worker (chrome.action is available in both).
export function applyBadge(r) {
  if (typeof chrome === "undefined" || !chrome.action) return;
  // Prefer "time until you can leave" (honours the 7pm floor); fall back to work remaining.
  const done = r.canLeave != null ? r.canLeave : r.completed;
  const secs = r.tillLeaveSec != null ? r.tillLeaveSec : r.remainingSec;
  if (done) {
    chrome.action.setBadgeText({ text: "✓" });
    chrome.action.setBadgeBackgroundColor({ color: "#2e7d32" });
    return;
  }
  const mins = Math.round(secs / 60);
  const text = mins >= 60 ? `${Math.floor(mins / 60)}h` : `${mins}m`;
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: r.clockedIn ? "#1565c0" : "#9e9e9e" });
}

// Creates a notification and resolves only once Chrome confirms it — awaiting
// this keeps the MV3 worker alive until the notification actually exists.
// Returns true on success so callers can set their once-per-day guard AFTER
// the notification fired (so a killed worker retries instead of silently
// suppressing it for the rest of the day).
export function notify(id, { title, message, priority = 1 }) {
  return new Promise((resolve) => {
    if (typeof chrome === "undefined" || !chrome.notifications) {
      resolve(false);
      return;
    }
    const iconUrl =
      chrome.runtime && chrome.runtime.getURL
        ? chrome.runtime.getURL("icons/icon128.png")
        : "icons/icon128.png";
    try {
      chrome.notifications.create(id, { type: "basic", iconUrl, title, message, priority }, () => {
        // lastError is read to avoid an "unchecked runtime.lastError" warning.
        void chrome.runtime.lastError;
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

// Fires a one-per-day desktop notification the moment you're free to leave.
export async function maybeNotifyLeave(r) {
  if (typeof chrome === "undefined" || !chrome.notifications) return;
  if (!r || !r.canLeave) return;
  const today = todayStr();
  const { notifiedLeaveDate } = await chrome.storage.local.get("notifiedLeaveDate");
  if (notifiedLeaveDate === today) return;
  const ok = await notify("leave-" + today, {
    title: "Ready to leave 🎉",
    message: "You've completed your hours and it's past your leave time.",
    priority: 2,
  });
  if (ok) await chrome.storage.local.set({ notifiedLeaveDate: today });
}

// Gentle "almost there" heads-up, once per day, when you're within `minutes`
// of being able to leave.
export async function maybeNotifyHeadsUp(r, minutes = DEFAULT_HEADSUP_MINUTES) {
  if (typeof chrome === "undefined" || !chrome.notifications) return;
  if (!r || minutes <= 0 || r.tillLeaveSec == null || r.canLeave) return;
  if (r.tillLeaveSec > minutes * 60 || r.tillLeaveSec <= 0) return;
  const today = todayStr();
  const { headsUpDate } = await chrome.storage.local.get("headsUpDate");
  if (headsUpDate === today) return;
  const mins = Math.max(1, Math.round(r.tillLeaveSec / 60));
  const ok = await notify("headsup-" + today, {
    title: `${mins} min till you can leave`,
    message: "Almost there — start wrapping up.",
    priority: 1,
  });
  if (ok) await chrome.storage.local.set({ headsUpDate: today });
}

// When you return from a break (a new IN appears), tell you how long it was and
// your updated earliest-leave time. Baselines silently on the first sync of the
// day so pre-existing breaks don't fire on load.
export async function maybeNotifyBreak(r) {
  if (typeof chrome === "undefined" || !chrome.notifications) return;
  if (!r || !r.hasData) return;
  const today = todayStr();
  const breaks = r.breakCount || 0;
  const { breakNotify } = await chrome.storage.local.get("breakNotify");

  if (!breakNotify || breakNotify.date !== today) {
    await chrome.storage.local.set({ breakNotify: { date: today, count: breaks } });
    return; // baseline only
  }
  if (breaks <= breakNotify.count) {
    if (breaks !== breakNotify.count) {
      await chrome.storage.local.set({ breakNotify: { date: today, count: breaks } });
    }
    return;
  }
  const dur = r.lastBreakSec != null ? fmtDuration(r.lastBreakSec) : "a";
  const leaveStr = r.earliestLeave ? fmtClock(r.earliestLeave) : null;
  const ok = await notify("break-" + today + "-" + breaks, {
    title: `Back from a ${dur} break`,
    message: leaveStr ? `You can now leave at ${leaveStr}.` : "Back on the clock.",
    priority: 1,
  });
  if (ok) await chrome.storage.local.set({ breakNotify: { date: today, count: breaks } });
}

// --- Auto-login (credential autofill via the real login page) ----------------
// Credentials are stored in chrome.storage.local (this device only, never
// synced or sent anywhere except the greytHR login form). There is no secure
// enclave available to MV3 extensions, so this is opt-in plaintext storage.
const AUTO_LOGIN_COOLDOWN_MS = 5 * 60 * 1000;
const AUTO_LOGIN_MAX_FAILS = 3;

export async function getAutoLoginSettings() {
  const s = await chrome.storage.local.get([
    "gtUser",
    "gtPass",
    "autoLogin",
    "autoLoginPendingAt",
    "autoLoginTabId",
    "autoLoginLastAttempt",
    "autoLoginFailCount",
  ]);
  return {
    user: (s.gtUser || "").trim(),
    pass: s.gtPass || "",
    enabled: s.autoLogin !== false && !!(s.gtUser && s.gtPass),
    pendingAt: s.autoLoginPendingAt || 0,
    tabId: s.autoLoginTabId ?? null,
    lastAttempt: s.autoLoginLastAttempt || 0,
    failCount: s.autoLoginFailCount || 0,
  };
}

// Called on a 401 (or from the popup's "sign in" state). Opens the greytHR
// login page in a background tab; autologin.js fills + submits it, and the
// background worker closes the tab once the session is back. Returns true if
// a login tab was (or is already) in flight.
export async function requestAutoLogin(subdomain, reason = "") {
  if (!subdomain) return false;
  const s = await getAutoLoginSettings();
  if (!s.enabled) return false;
  if (s.failCount >= AUTO_LOGIN_MAX_FAILS) return false; // bad creds — stop looping
  // Reuse the in-flight tab if it's still around (checked before the
  // cooldown so concurrent 401s don't report "no login happening").
  if (s.tabId != null) {
    try {
      await chrome.tabs.get(s.tabId);
      return true;
    } catch {
      // tab is gone — fall through and open a fresh one (subject to cooldown)
    }
  }
  const now = Date.now();
  // Cooling down after a recent attempt that is no longer in flight (e.g. it
  // failed and its tab is gone). Return false so callers show the manual
  // sign-in path instead of claiming a login is happening.
  if (now - s.lastAttempt < AUTO_LOGIN_COOLDOWN_MS) return false;
  const url = `https://${subdomain}.greythr.com/`;
  const tab = await chrome.tabs.create({ url, active: false });
  await chrome.storage.local.set({
    autoLoginPendingAt: now,
    autoLoginLastAttempt: now,
    autoLoginTabId: tab.id,
    autoLoginReason: reason,
  });
  return true;
}

export async function clearAutoLoginState() {
  await chrome.storage.local.remove([
    "autoLoginPendingAt",
    "autoLoginTabId",
    "autoLoginReason",
  ]);
}

// --- Auto-open popup window -------------------------------------------------
// Opens the popup UI in a focused window once per day when little time is
// left. Called only from the background worker (never from the popup itself,
// which is already open). 0 / unset = disabled.
export const DEFAULT_AUTO_OPEN_MINUTES = 10;

export async function maybeAutoOpen(r, minutes) {
  if (typeof chrome === "undefined" || !chrome.windows || !chrome.runtime) return;
  if (!r || !(minutes > 0)) return;
  const done = r.canLeave != null ? r.canLeave : r.completed;
  if (done) return; // already free to leave — the leave notification covers it
  const secs = r.tillLeaveSec != null ? r.tillLeaveSec : r.remainingSec;
  if (secs == null || secs <= 0 || secs > minutes * 60) return;
  const today = todayStr();
  const { autoOpenedDate } = await chrome.storage.local.get("autoOpenedDate");
  if (autoOpenedDate === today) return; // once per day
  await chrome.storage.local.set({ autoOpenedDate: today });
  try {
    await chrome.windows.create({
      url: chrome.runtime.getURL("popup.html"),
      type: "popup",
      focused: true,
      width: 380,
      height: 620,
    });
  } catch {
    // Window blocked/failed — stays "opened" for today to avoid spawn loops.
  }
}

export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function fmtClock(date) {
  if (!date) return "--";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// insights avgInTime/avgOutTime are seconds-from-midnight in local (IST) time.
export function clockFromSeconds(sec) {
  if (sec == null) return "--";
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setSeconds(Math.round(sec));
  return fmtClock(d);
}
