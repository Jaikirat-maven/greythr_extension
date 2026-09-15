import {
  fetchSwipes,
  computeAttendance,
  applyBadge,
  maybeNotifyLeave,
  maybeNotifyHeadsUp,
  maybeNotifyBreak,
  saveCache,
  todayStr,
  DEFAULT_REQUIRED_MINUTES,
  DEFAULT_LEAVE_MINUTES,
  DEFAULT_HEADSUP_MINUTES,
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

let discoverTimer = null;
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
        // These calls only fire when the greytHR session is valid — so this is
        // also our cue to refresh right after a fresh login. Debounced.
        clearTimeout(discoverTimer);
        discoverTimer = setTimeout(updateBadge, 1500);
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

// --- Badge: keep remaining time visible on the toolbar icon ----------------
async function updateBadge() {
  const { subdomain, empId, requiredMinutes, leaveMinutes, headsUpMinutes } =
    await chrome.storage.local.get([
      "subdomain",
      "empId",
      "requiredMinutes",
      "leaveMinutes",
      "headsUpMinutes",
    ]);

  if (!subdomain || !empId) {
    chrome.action.setBadgeText({ text: "" });
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

    applyBadge(r);
    maybeNotifyLeave(r);
    maybeNotifyHeadsUp(r, headsUpMinutes ?? DEFAULT_HEADSUP_MINUTES);
    maybeNotifyBreak(r);
  } catch (e) {
    chrome.action.setBadgeText({ text: e.code === 401 ? "•" : "!" });
    chrome.action.setBadgeBackgroundColor({
      color: e.code === 401 ? "#9e9e9e" : "#c62828",
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("refresh", { periodInMinutes: 5 });
  updateBadge();
});
chrome.runtime.onStartup.addListener(updateBadge);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "refresh") updateBadge();
});
