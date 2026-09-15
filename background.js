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
        // A fresh authenticated call also means an in-flight auto-login
        // worked — close its tab (the user asked for it to disappear).
        closeAutoLoginTab();
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
    // Session expired → try a silent re-login if the user saved credentials.
    if (e.code === 401 && subdomain) {
      try {
        await requestAutoLogin(subdomain, "badge-401");
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

chrome.runtime.onMessage.addListener((msg, sender) => {
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
  chrome.alarms.create("refresh", { periodInMinutes: 5 });
  updateBadge();
});
chrome.runtime.onStartup.addListener(updateBadge);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "refresh") updateBadge();
});
