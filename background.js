import {
  fetchSwipes,
  computeAttendance,
  applyBadge,
  maybeNotifyLeave,
  maybeNotifyHeadsUp,
  maybeNotifyBreak,
  saveCache,
  todayStr,
  requestAutoLogin,
  clearAutoLoginState,
  maybeAutoOpen,
  DEFAULT_REQUIRED_MINUTES,
  DEFAULT_LEAVE_MINUTES,
  DEFAULT_HEADSUP_MINUTES,
  DEFAULT_AUTO_OPEN_MINUTES,
} from "./shared.js";

// --- Employee-ID / subdomain auto-discovery -------------------------------
// The portal itself calls these endpoints with the empId in the URL. We watch
// for them and cache the values so the popup never needs a hardcoded ID.
const DISCOVERY = [
  // notifications fires on the home page right after login — best signal.
  /https:\/\/([^./]+)\.greythr\.com\/v3\/api\/notifications\/(\d+)/,
  /https:\/\/([^./]+)\.greythr\.com\/latte\/v3\/attendance\/info\/(\d+)\/swipes/,
  /https:\/\/([^./]+)\.greythr\.com\/v3\/api\/empinfo\/personal\/data\/(\d+)/,
];

// setTimeout is unreliable in an MV3 worker (it can be torn down before the
// timer fires), so debounce with a timestamp instead and refresh immediately.
let lastDiscoverRun = 0;
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Ignore the extension's OWN fetches (service worker/popup: tabId < 0 or a
    // chrome-extension initiator). Otherwise our swipes fetch would re-trigger
    // this listener → schedule another fetch → infinite loop.
    if (
      details.tabId < 0 ||
      (details.initiator && details.initiator.startsWith("chrome-extension://"))
    ) {
      return;
    }
    for (const re of DISCOVERY) {
      const m = details.url.match(re);
      if (m) {
        chrome.storage.local.set({ subdomain: m[1], empId: m[2] });
        // A fresh authenticated call also means an in-flight auto-login
        // worked — close its tab (the user asked for it to disappear).
        closeAutoLoginTab();
        // These calls only fire when the greytHR session is valid — so this is
        // also our cue to refresh right after a fresh login. Debounced by time.
        const nowTs = Date.now();
        if (nowTs - lastDiscoverRun > 3000) {
          lastDiscoverRun = nowTs;
          updateBadge();
        }
        break;
      }
    }
  },
  {
    urls: [
      "https://*.greythr.com/v3/api/notifications/*",
      "https://*.greythr.com/latte/v3/attendance/info/*/swipes*",
      "https://*.greythr.com/v3/api/empinfo/personal/data/*",
    ],
  }
);

// --- Periodic refresh: must survive reloads ---------------------------------
// The tick used to be created only in onInstalled. If the alarm ever goes
// missing (e.g. unpacked reload after a manifest change), the worker never
// wakes on its own: badge freezes and notifications only fire on popup
// clicks. So re-ensure it on every worker start, not just on install.
const REFRESH_ALARM = "refresh";
const REFRESH_MINUTES = 1;

function ensureAlarm() {
  try {
    chrome.alarms.get(REFRESH_ALARM, (a) => {
      if (!a) chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_MINUTES });
    });
  } catch {
    // alarms API unavailable — popup-driven refresh still works
  }
}
ensureAlarm();

// --- Precise, self-correcting notification timing ---------------------------
// Rather than relying only on the 1-min poll (which can fire up to a minute
// late), we schedule one-shot alarms at the *exact* moments computed from the
// data: heads-up at (earliestLeave − N min) and "ready" at earliestLeave. When
// one fires we re-fetch and re-check before sending — so a new swipe / break
// that moved the target just reschedules instead of sending a wrong time.
const NOTIFY_ALARMS = {
  leave: "at-leave",
  headsup: "at-headsup",
  autoopen: "at-autoopen",
};
const NOTIFY_ALARM_NAMES = Object.values(NOTIFY_ALARMS);
const SCHEDULE_EPS_MS = 1500; // don't schedule for the immediate past

function scheduleOne(name, whenMs, enabled) {
  try {
    if (enabled && whenMs != null && whenMs > Date.now() + SCHEDULE_EPS_MS) {
      chrome.alarms.create(name, { when: whenMs });
    } else {
      chrome.alarms.clear(name);
    }
  } catch {
    /* alarms unavailable */
  }
}

// (Re)schedules the leave / heads-up / auto-open alarms from the current
// computed state. A small buffer past each threshold makes sure that when the
// alarm fires we're just *inside* the window, so the re-check actually sends.
const SCHEDULE_BUFFER_MS = 3000;
function scheduleNotifyAlarms(r, headsUpMinutes, autoOpenMinutes) {
  const leaveMs = r && r.earliestLeave ? r.earliestLeave.getTime() : null;
  const active = !!leaveMs && !r.canLeave; // nothing to schedule once free to leave
  const B = SCHEDULE_BUFFER_MS;
  scheduleOne(NOTIFY_ALARMS.leave, leaveMs != null ? leaveMs + B : null, active);
  scheduleOne(
    NOTIFY_ALARMS.headsup,
    leaveMs != null ? leaveMs - headsUpMinutes * 60000 + B : null,
    active && headsUpMinutes > 0
  );
  scheduleOne(
    NOTIFY_ALARMS.autoopen,
    leaveMs != null ? leaveMs - autoOpenMinutes * 60000 + B : null,
    active && autoOpenMinutes > 0
  );
}

// --- Badge: keep remaining time visible on the toolbar icon ----------------
// Runs tab-independently (service worker + alarm): no greytHR tab needs to be
// open or active. Writes a diagnostic after each run so the popup can show
// whether the background tick is alive.
async function updateBadge() {
  const { subdomain, empId, requiredMinutes, leaveMinutes, headsUpMinutes, autoOpenMinutes } =
    await chrome.storage.local.get([
      "subdomain",
      "empId",
      "requiredMinutes",
      "leaveMinutes",
      "headsUpMinutes",
      "autoOpenMinutes",
    ]);

  if (!subdomain || !empId) {
    chrome.action.setBadgeText({ text: "" });
    NOTIFY_ALARM_NAMES.forEach((n) => chrome.alarms.clear(n));
    await chrome.storage.local.set({ lastBgRunAt: Date.now(), lastBgStatus: "setup" });
    return;
  }

  try {
    const data = await fetchSwipes(subdomain, empId);
    await saveCache(todayStr(), data); // keep popup's cache warm & fresh
    const r = computeAttendance(
      data,
      (requiredMinutes || DEFAULT_REQUIRED_MINUTES) * 60,
      { leaveMinutes: leaveMinutes ?? DEFAULT_LEAVE_MINUTES }
    );

    const headsUp = headsUpMinutes ?? DEFAULT_HEADSUP_MINUTES;
    const autoOpen = autoOpenMinutes ?? DEFAULT_AUTO_OPEN_MINUTES;

    applyBadge(r);
    // We just fetched fresh data, so this IS the "check there are no new swipes
    // before sending" step. Fire anything already due (guards keep it once/day).
    await Promise.allSettled([
      maybeNotifyLeave(r),
      maybeNotifyHeadsUp(r, headsUp),
      maybeNotifyBreak(r),
      maybeAutoOpen(r, autoOpen),
    ]);
    // Schedule the exact-time wake-ups for anything still in the future.
    scheduleNotifyAlarms(r, headsUp, autoOpen);
    await chrome.storage.local.set({ lastBgRunAt: Date.now(), lastBgStatus: "ok" });
  } catch (e) {
    chrome.action.setBadgeText({ text: e.code === 401 ? "•" : "!" });
    chrome.action.setBadgeBackgroundColor({
      color: e.code === 401 ? "#9e9e9e" : "#c62828",
    });
    await chrome.storage.local.set({
      lastBgRunAt: Date.now(),
      lastBgStatus: e.code === 401 ? "expired" : "error",
      lastBgError: String((e && e.message) || e),
    });
    // greytHR often answers an expired/invalid session with 403 or a 5xx
    // instead of a clean 401, so treat those as "session might be dead" and
    // try a silent re-login too. Guarded by cooldown + max-fails, so a real
    // outage won't loop; and if the session was actually fine, the login page
    // just redirects to the portal and the tab closes itself.
    const authLike =
      e.code === 401 || e.code === 403 || (e.code >= 500 && e.code <= 599);
    if (authLike && subdomain) {
      try {
        await requestAutoLogin(subdomain, "badge-" + e.code);
      } catch {
        // Never let auto-login break the badge loop.
      }
    }
  }
}

// --- Auto-login tab lifecycle ------------------------------------------------
async function closeAutoLoginTab() {
  const { autoLoginTabId } = await chrome.storage.local.get("autoLoginTabId");
  if (autoLoginTabId == null) return;
  await clearAutoLoginState();
  // Full reset: a success must not leave a cooldown behind, or the *next*
  // expiry within 5 minutes would be swallowed (the "only works once" bug).
  await chrome.storage.local.remove("autoLoginLastAttempt");
  await chrome.storage.local.set({ autoLoginFailCount: 0 });
  try {
    await chrome.tabs.remove(autoLoginTabId);
  } catch {
    // Already closed by the user — fine.
  }
  updateBadge();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Manual poke from the Settings page ("Run background refresh now") — proves
  // the worker is alive. Reply only after the refresh completes.
  if (msg && msg.type === "GT_REFRESH_NOW") {
    updateBadge().finally(() => {
      try {
        sendResponse({ ok: true });
      } catch {
        /* channel already closed */
      }
    });
    return true; // keep the message channel open for the async reply
  }
  // First-run "Connect" with saved credentials → start the auto-login flow.
  if (msg && msg.type === "GT_START_AUTOLOGIN") {
    requestAutoLogin(msg.subdomain, "setup-connect").finally(() => {
      try {
        sendResponse({ ok: true });
      } catch {
        /* channel already closed */
      }
    });
    return true;
  }
  if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("GT_AUTOLOGIN_")) {
    return;
  }
  (async () => {
    const { autoLoginTabId } = await chrome.storage.local.get("autoLoginTabId");
    const isOurs = sender.tab && sender.tab.id === autoLoginTabId;
    if (msg.type === "GT_AUTOLOGIN_SUCCESS") {
      if (isOurs || autoLoginTabId != null) await closeAutoLoginTab();
      else {
        await clearAutoLoginState();
        await chrome.storage.local.remove("autoLoginLastAttempt");
        await chrome.storage.local.set({ autoLoginFailCount: 0 });
        updateBadge();
      }
    } else if (msg.type === "GT_AUTOLOGIN_FAILED") {
      const { autoLoginFailCount } = await chrome.storage.local.get("autoLoginFailCount");
      await chrome.storage.local.set({ autoLoginFailCount: (autoLoginFailCount || 0) + 1 });
      await clearAutoLoginState();
      // Leave the tab open and bring it forward so the user can see the
      // error / solve any captcha. Keep the tab id cleared so we don't loop.
      if (sender.tab && sender.tab.id != null) {
        try {
          await chrome.tabs.update(sender.tab.id, { active: true });
        } catch { /* ignore */ }
      }
    }
    // GT_AUTOLOGIN_SUBMITTED needs no action.
  })();
});

// If the user closes the auto-login tab themselves, drop the pending state
// (cooldown in lastAttempt still prevents an instant re-open loop).
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { autoLoginTabId } = await chrome.storage.local.get("autoLoginTabId");
  if (tabId === autoLoginTabId) await clearAutoLoginState();
});

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_MINUTES });
  updateBadge();
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  updateBadge();
});
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name === REFRESH_ALARM) {
    ensureAlarm(); // self-heal in case the schedule was cleared
    // Awaiting keeps the worker alive through the fetch + notifications.
    await updateBadge();
    return;
  }
  // A precise notification alarm fired: re-fetch and re-verify before sending
  // (updateBadge fetches fresh, fires anything due, and reschedules the rest).
  if (NOTIFY_ALARM_NAMES.includes(a.name)) {
    await updateBadge();
  }
});
