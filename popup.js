import {
  fetchSwipes,
  fetchInsights,
  fetchCalendar,
  computeAttendance,
  applyBadge,
  maybeNotifyLeave,
  maybeNotifyHeadsUp,
  maybeNotifyBreak,
  saveCache,
  loadCache,
  fmtAge,
  fmtDuration,
  fmtClock,
  clockFromSeconds,
  todayStr,
  monthStartStr,
  DEFAULT_REQUIRED_MINUTES,
  DEFAULT_LEAVE_MINUTES,
  DEFAULT_HEADSUP_MINUTES,
} from "./shared.js";

const $ = (id) => document.getElementById(id);
const RING_C = 2 * Math.PI * 52; // circumference of the progress ring

let selected = startOfDay(new Date()); // currently viewed day
let lastData = null; // raw swipes response for `selected`
let cfg = {
  requiredMinutes: DEFAULT_REQUIRED_MINUTES,
  leaveMinutes: DEFAULT_LEAVE_MINUTES,
  headsUpMinutes: DEFAULT_HEADSUP_MINUTES,
};
let tick = null;
let monthLoadedKey = null; // "YYYY-M" currently rendered in the month panel
let centerKey = "till"; // which metric the ring center shows
let lastRenderedKey = null; // to animate only on view switch, not every tick

function animateSwap(el) {
  el.classList.remove("swap");
  void el.offsetWidth; // force reflow so the animation restarts
  el.classList.add("swap");
}

const MODES_LIVE = ["till", "worked", "breakLeft", "breakTaken"];
const MODES_PAST = ["worked", "breakTaken"];
const currentModes = (live) => (live ? MODES_LIVE : MODES_PAST);

// One metric view for the ring center: { label, value, progress, state, neg }
function metricFor(key, r, live) {
  const workState = r.completed
    ? "st-done"
    : live && r.clockedIn
    ? "st-in"
    : "st-out";

  if (key === "worked") {
    return { label: "worked", value: fmtDuration(r.workedSec), progress: r.progress, state: workState };
  }

  if (key === "till") {
    const done = live && r.canLeave;
    const secs = live && r.tillLeaveSec != null ? r.tillLeaveSec : r.remainingSec;
    return {
      label: done ? "" : "till leave",
      value: done ? "Go home 🎉" : fmtDuration(secs),
      progress: r.progress,
      state: done ? "st-done" : live && r.clockedIn ? "st-in" : "st-out",
    };
  }

  // break left — only meaningful on today (needs a live budget)
  if (key === "breakLeft") {
    if (!live || r.breakBudgetSec == null || r.breakLeftSec == null) {
      return { label: "break left", value: "--", progress: 0, state: "st-out" };
    }
    const over = r.breakTakenSec > r.breakBudgetSec + 0.5;
    const prog =
      r.breakBudgetSec > 0
        ? Math.min(1, r.breakTakenSec / r.breakBudgetSec)
        : r.breakTakenSec > 0
        ? 1
        : 0;
    return over
      ? {
          label: "over break",
          value: "+" + fmtDuration(r.breakTakenSec - r.breakBudgetSec),
          progress: 1,
          state: "st-over",
          neg: true,
        }
      : { label: "break left", value: fmtDuration(r.breakLeftSec), progress: prog, state: "st-in" };
  }

  // break taken — works today and on past days
  if (r.breakTakenSec == null) {
    return { label: "break taken", value: "--", progress: 0, state: "st-out" };
  }
  const budget = live ? r.breakBudgetSec : null; // only compare to budget on today
  const over = budget != null && r.breakTakenSec > budget + 0.5;
  const prog = budget ? Math.min(1, r.breakTakenSec / budget) : 0;
  return {
    label: "break taken",
    value: fmtDuration(r.breakTakenSec),
    progress: prog,
    state: over ? "st-over" : "st-in",
    neg: over,
  };
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function isToday(d) {
  return startOfDay(d).getTime() === startOfDay(new Date()).getTime();
}
function dateKey(d) {
  return todayStr(d);
}

function dateLabel(d) {
  const t = startOfDay(new Date()).getTime();
  const diff = Math.round((startOfDay(d).getTime() - t) / 86400000);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

function stopTick() {
  if (tick) { clearInterval(tick); tick = null; }
}

function showState(html, isError = false) {
  stopTick();
  hideNotice();
  const el = $("state");
  el.innerHTML = html;
  el.className = "state" + (isError ? " error" : "");
  el.classList.remove("hidden");
  $("main").classList.add("hidden");
  el.querySelectorAll("a[data-portal]").forEach((a) =>
    a.addEventListener("click", openPortal)
  );
}

function showNotice(html, type = "warn") {
  const el = $("notice");
  el.innerHTML = html;
  el.className = "notice " + type;
  el.querySelectorAll("a[data-portal]").forEach((a) =>
    a.addEventListener("click", openPortal)
  );
}
function hideNotice() {
  $("notice").className = "notice hidden";
}

function render() {
  if (!lastData) return;
  const live = isToday(selected);
  const r = computeAttendance(lastData, cfg.requiredMinutes * 60, {
    countLive: live,
    now: new Date(),
    leaveMinutes: cfg.leaveMinutes,
  });

  $("state").classList.add("hidden");
  $("main").classList.remove("hidden");

  const canGo = live && r.canLeave != null ? r.canLeave : r.completed;

  // Pick the metric to show in the ring center (tap the ring to cycle).
  const modes = currentModes(live);
  if (!modes.includes(centerKey)) centerKey = modes[0];
  const m = metricFor(centerKey, r, live);

  // Ring
  const ring = $("ringFg");
  ring.style.strokeDasharray = RING_C;
  ring.style.strokeDashoffset = RING_C * (1 - m.progress);

  // Ring color state (drives gradient/glow via CSS)
  const app = $("app");
  app.classList.remove("st-in", "st-out", "st-done", "st-over");
  app.classList.add(m.state);

  // Center
  $("centerLabel").textContent = m.label;
  $("centerValue").textContent = m.value;
  $("centerValue").className = "ringvalue" + (m.neg ? " neg" : "");

  // Animate the swap only when the view actually changed (not every tick).
  if (centerKey !== lastRenderedKey) {
    animateSwap($("centerLabel"));
    animateSwap($("centerValue"));
    lastRenderedKey = centerKey;
  }

  // Mode dots
  const dotsEl = $("modeDots");
  if (modes.length > 1) {
    dotsEl.style.display = "flex";
    dotsEl.innerHTML = modes
      .map((k) => `<span class="dot-m${k === centerKey ? " active" : ""}"></span>`)
      .join("");
  } else {
    dotsEl.style.display = "none";
  }

  const pill = $("statusPill");
  if (canGo) {
    pill.textContent = "Ready to leave";
    pill.className = "pill done";
  } else if (live && r.completed) {
    pill.textContent = "Work done · waiting";
    pill.className = "pill out";
  } else if (live && r.clockedIn) {
    pill.textContent = "Clocked in";
    pill.className = "pill in";
  } else if (r.hasData) {
    pill.textContent = "Clocked out";
    pill.className = "pill out";
  } else {
    pill.textContent = "No swipes";
    pill.className = "pill";
  }

  // Stats — two middle cells adapt to today vs a past day.
  $("worked").textContent = fmtDuration(r.workedSec);
  $("firstIn").textContent = fmtClock(r.firstIn);
  if (live && r.breakLeftSec != null) {
    $("lblB").textContent = "Break left";
    $("statB").textContent = fmtDuration(r.breakLeftSec);
    $("lblC").textContent = "Leave at";
    $("statC").textContent = fmtClock(r.earliestLeave);
  } else {
    $("lblB").textContent = "Required";
    $("statB").textContent = fmtDuration(r.requiredSec);
    $("lblC").textContent = r.lastIsOut ? "Last out" : "Last swipe";
    $("statC").textContent = fmtClock(r.lastSwipe);
  }

  // Timeline
  const tl = $("timeline");
  tl.innerHTML = "";
  $("tlHead").classList.toggle("hidden", r.segments.length === 0);
  for (const s of r.segments) {
    const div = document.createElement("div");
    div.className = "tl" + (s.open ? " open" : "");
    div.innerHTML =
      `<span class="dot"></span>` +
      `<span class="time">${fmtClock(s.in)} → ${s.open ? "now" : fmtClock(s.out)}</span>` +
      `<span class="dur">${fmtDuration(s.sec)}</span>`;
    tl.appendChild(div);
  }

  // Keep the toolbar badge in sync from the data we already have (no fetch).
  if (live) {
    applyBadge(r);
    maybeNotifyLeave(r);
    maybeNotifyHeadsUp(r, cfg.headsUpMinutes);
  }

  // Live countdown today until you can actually leave (covers clocked-in work,
  // the 7pm wait, and break time being consumed while clocked out).
  stopTick();
  if (live && !canGo) {
    tick = setInterval(render, 1000);
  }
}

async function load() {
  updateNav();
  if (!$("monthPanel").classList.contains("hidden")) loadMonth();
  const store = await chrome.storage.local.get([
    "subdomain",
    "empId",
    "requiredMinutes",
    "leaveMinutes",
    "headsUpMinutes",
    "centerKey",
  ]);
  cfg.requiredMinutes = store.requiredMinutes || DEFAULT_REQUIRED_MINUTES;
  cfg.leaveMinutes = store.leaveMinutes ?? DEFAULT_LEAVE_MINUTES;
  cfg.headsUpMinutes = store.headsUpMinutes ?? DEFAULT_HEADSUP_MINUTES;
  if (store.centerKey) centerKey = store.centerKey;

  if (!store.subdomain || !store.empId) {
    await showSetup();
    return;
  }

  const key = dateKey(selected);

  // 1. Instant paint from cache — the timer keeps ticking from the last state.
  const cache = await loadCache();
  const cached = cache[key];
  if (cached && computeAttendance(cached.data, 1).hasData) {
    lastData = cached.data;
    hideNotice();
    render();
  } else {
    $("state").classList.remove("hidden");
    $("state").className = "state";
    $("state").textContent = "Loading…";
    $("main").classList.add("hidden");
  }

  // 2. Revalidate in the background (auto-refresh if the session is alive).
  try {
    const data = await fetchSwipes(store.subdomain, store.empId, key);
    lastData = data;
    await saveCache(key, data);
    if (!computeAttendance(data, 1).hasData) {
      showState(
        isToday(selected) ? "No swipes recorded yet today." : "No swipes on this day."
      );
      return;
    }
    hideNotice();
    render();
    // Break-return check runs on fresh data (breaks only change on a new swipe).
    if (isToday(selected)) {
      maybeNotifyBreak(
        computeAttendance(data, cfg.requiredMinutes * 60, {
          leaveMinutes: cfg.leaveMinutes,
        })
      );
    }
  } catch (e) {
    if (cached) {
      // Keep showing the last known state; just tell the user it's stale.
      if (e.code === 401) {
        showNotice(
          `Session expired — <a data-portal href="#">sign in to greytHR</a> to update. Showing last state (${fmtAge(cached.at)}).`,
          "error"
        );
      } else {
        showNotice(`Couldn't refresh — showing last state (${fmtAge(cached.at)}).`, "warn");
      }
    } else if (e.code === 401) {
      showState(
        'Your greytHR session has expired.' +
          '<a class="btn" data-portal href="#">Sign in to greytHR</a>' +
          '<span class="hintsm">Live updates resume automatically once you sign in.</span>',
        true
      );
    } else {
      showState(
        "Couldn't reach greytHR: " + e.message +
          '<span class="hintsm">Check your connection and hit ⟳.</span>',
        true
      );
    }
  }
}

function updateNav() {
  $("dateLabel").textContent = dateLabel(selected);
  $("nextDay").disabled = isToday(selected);
}

function shiftDay(delta) {
  const next = startOfDay(selected);
  next.setDate(next.getDate() + delta);
  if (next.getTime() > startOfDay(new Date()).getTime()) return;
  selected = next;
  load();
}

// --- Month overview (lazy-loaded calendar + insights) ---------------------
function dayStatus(info) {
  const l = info.session1hLabel || info.session2hLabel;
  if (l === "P") return { k: "p", t: "Present" };
  if (l === "A") return { k: "a", t: "Absent" };
  if (l === "H") return { k: "h", t: "Holiday" };
  if (l === "O") return { k: "o", t: "Week off" };
  if (info.dayType && info.dayType.code === "O") return { k: "o", t: "Week off" };
  return { k: "none", t: "" };
}

function chip(label, val) {
  return `<div class="chip"><span>${label}</span><b>${val}</b></div>`;
}

function renderMonth(calData, ins) {
  const cal = calData.calendar;
  const monthStr = (cal.month || cal.startDate).slice(0, 7);
  const todayKey = todayStr();

  let cells = "";
  for (const e of cal.entries) {
    const st = dayStatus(e.info);
    const inMonth = e.date.slice(0, 7) === monthStr;
    const day = parseInt(e.date.slice(8, 10), 10);
    const isToday = e.date === todayKey;
    const clickable = e.date <= todayKey;
    cells +=
      `<button class="mcell s-${st.k}${inMonth ? "" : " out"}${isToday ? " today" : ""}" ` +
      `${clickable ? `data-date="${e.date}"` : "disabled"} ` +
      `title="${e.date}${st.t ? " · " + st.t : ""}">${day}</button>`;
  }

  const wd = ["M", "T", "W", "T", "F", "S", "S"]
    .map((d) => `<span class="wd">${d}</span>`)
    .join("");

  const legend =
    `<div class="legend">` +
    `<span><i class="lg-p"></i>Present</span>` +
    `<span><i class="lg-a"></i>Absent</span>` +
    `<span><i class="lg-h"></i>Holiday</span></div>`;

  let chips = "";
  if (ins) {
    const P = ins.monthlyStatusInfo ? Math.round(ins.monthlyStatusInfo.P || 0) : "–";
    const A = ins.monthlyStatusInfo ? Math.round(ins.monthlyStatusInfo.A || 0) : "–";
    chips =
      `<div class="chips">` +
      chip("Present", P) +
      chip("Absent", A) +
      chip("Late-ins", ins.lateInDays ?? "–") +
      chip("Avg in", clockFromSeconds(ins.avgInTime)) +
      chip("Avg out", clockFromSeconds(ins.avgOutTime)) +
      chip("Avg work", fmtDuration(ins.avgActualWorkHours || 0)) +
      `</div>`;
  }

  const panel = $("monthPanel");
  panel.innerHTML =
    `<div class="wdrow">${wd}</div><div class="cells">${cells}</div>${legend}${chips}`;
  panel.querySelectorAll(".mcell[data-date]").forEach((b) =>
    b.addEventListener("click", () => {
      selected = startOfDay(new Date(b.dataset.date + "T00:00:00"));
      closeMonth(); // return to the day view for the picked date
      load();
    })
  );
}

function closeMonth() {
  $("monthPanel").classList.add("hidden");
  $("monthToggle").classList.remove("open");
  $("app").classList.remove("month-open");
  $("monthToggle").querySelector("span").textContent = "Month overview";
}

async function loadMonth() {
  const panel = $("monthPanel");
  panel.classList.remove("hidden");
  const { subdomain, empId } = await chrome.storage.local.get(["subdomain", "empId"]);
  if (!subdomain || !empId) {
    panel.innerHTML = `<div class="mloading">Link your account first.</div>`;
    return;
  }
  const y = selected.getFullYear();
  const m = selected.getMonth() + 1;
  const key = `${y}-${m}`;
  if (monthLoadedKey === key) return; // already showing this month

  panel.innerHTML = `<div class="mloading">Loading month…</div>`;
  try {
    const [cal, ins] = await Promise.all([
      fetchCalendar(subdomain, empId, y, m),
      fetchInsights(subdomain, empId, monthStartStr(selected)).catch(() => null),
    ]);
    renderMonth(cal, ins);
    monthLoadedKey = key;
  } catch (e) {
    monthLoadedKey = null;
    panel.innerHTML = `<div class="mloading">Couldn't load month${
      e.code === 401 ? " — sign in" : ""
    }.</div>`;
  }
}

// --- First-run setup ------------------------------------------------------
// Defaults to the mavenvista tenant; the subdomain stays editable in Settings.
const DEFAULT_SUBDOMAIN = "mavenvista";

async function showSetup() {
  stopTick();
  hideNotice();
  closeMonth();
  $("main").classList.add("hidden");

  const el = $("state");
  el.className = "state setup setup-center";
  el.classList.remove("hidden");
  el.innerHTML =
    `<div class="setup-logo"><span class="dotmark"></span></div>` +
    `<div class="setup-title">greytHR Time Remaining</div>` +
    `<div class="setup-desc">Connect your greytHR account to see how much working time you have left today.</div>` +
    `<button id="setupConnect" class="btn setup-btn">Connect greytHR</button>` +
    `<div class="setup-hint">Sign in if asked — we'll detect your details automatically.</div>` +
    `<a id="setupManual" class="setup-manual">Trouble? Enter employee ID</a>` +
    `<div id="setupManualBox" class="hidden">` +
    `<input id="setupEmp" type="text" placeholder="Employee ID (e.g. 93)" spellcheck="false" />` +
    `<button id="setupSave" class="btn setup-btn setup-save">Save & link</button>` +
    `</div>`;

  $("setupConnect").addEventListener("click", onConnect);
  $("setupManual").addEventListener("click", () =>
    $("setupManualBox").classList.toggle("hidden")
  );
  $("setupSave").addEventListener("click", onManualSave);
}

async function onConnect() {
  const { subdomain } = await chrome.storage.local.get("subdomain");
  const sub = subdomain || DEFAULT_SUBDOMAIN;
  await chrome.storage.local.set({ subdomain: sub });
  chrome.tabs.create({
    url: `https://${sub}.greythr.com/v3/portal/ess/attendance/attendance-info`,
  });
}

async function onManualSave() {
  const emp = $("setupEmp").value.trim();
  if (!emp) {
    $("setupEmp").focus();
    return;
  }
  const { subdomain } = await chrome.storage.local.get("subdomain");
  await chrome.storage.local.set({ subdomain: subdomain || DEFAULT_SUBDOMAIN, empId: emp });
  load();
}

async function openPortal(e) {
  if (e) e.preventDefault();
  const { subdomain } = await chrome.storage.local.get("subdomain");
  const sub = subdomain || "mavenvista";
  chrome.tabs.create({
    url: `https://${sub}.greythr.com/v3/portal/ess/attendance/attendance-info`,
  });
}

$("prevDay").addEventListener("click", () => shiftDay(-1));
$("nextDay").addEventListener("click", () => shiftDay(1));
$("dateLabel").addEventListener("click", () => {
  selected = startOfDay(new Date());
  load();
});
// If the background refresh (or a fresh login) warms the cache while the popup
// is open, pick it up live without the user doing anything.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  // Employee ID just got detected (e.g. right after first-time sign-in) → link now.
  if (changes.empId && changes.empId.newValue && !changes.empId.oldValue) {
    load();
    return;
  }
  if (!changes.cache) return;
  const c = changes.cache.newValue && changes.cache.newValue[dateKey(selected)];
  if (c && computeAttendance(c.data, 1).hasData) {
    lastData = c.data;
    hideNotice();
    render();
  }
});

$("ringBtn").addEventListener("click", () => {
  if (!lastData) return;
  const modes = currentModes(isToday(selected));
  const i = modes.indexOf(centerKey);
  centerKey = modes[(i + 1) % modes.length];
  chrome.storage.local.set({ centerKey });
  render();
});

$("monthToggle").addEventListener("click", () => {
  const willOpen = $("monthPanel").classList.contains("hidden");
  if (willOpen) {
    $("monthToggle").classList.add("open");
    $("app").classList.add("month-open");
    $("monthToggle").querySelector("span").textContent = "Back to day view";
    loadMonth();
    window.scrollTo(0, 0);
  } else {
    closeMonth();
  }
});

$("refresh").addEventListener("click", load);
$("openPortal").addEventListener("click", openPortal);
$("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

load();
