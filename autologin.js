// greytHR auto-login content script.
//
// Runs on *.greythr.com. If the user saved ESS credentials + auto-login is on
// and this page shows a login form, fill it and submit. The background worker
// closes this tab once the session is back (it watches for authenticated API
// calls); on failure the tab is left open (and foregrounded) so the user can
// see the error / solve any captcha.
//
// The login page is an Angular SPA, so the form renders async — we watch the
// DOM for a while instead of checking once.

(async () => {
  let st;
  try {
    st = await chrome.storage.local.get([
      "gtUser",
      "gtPass",
      "autoLogin",
      "autoLoginPendingAt",
    ]);
  } catch {
    return;
  }
  const user = (st.gtUser || "").trim();
  const pass = st.gtPass || "";
  if (st.autoLogin === false || !user || !pass) return;
  // Safety: these credentials belong to greytHR only. The script is injected
  // on all tabs (per manifest), but it must never type them into any other
  // site's form.
  const host = location.hostname.toLowerCase();
  if (host !== "greythr.com" && !host.endsWith(".greythr.com")) return;
  // Only act when a login was actually requested (a 401 happened recently) OR
  // the user just landed on the login root with no session. The timestamp
  // guard stops us from hijacking a deliberate manual logout for very long.
  const pendingFresh =
    st.autoLoginPendingAt && Date.now() - st.autoLoginPendingAt < 10 * 60 * 1000;
  const looksLikeLoginUrl =
    /\/login|\/uas|\/auth|\/$|\/v3\/portal/.test(location.pathname) ||
    document.title.toLowerCase().includes("login");
  if (!pendingFresh && !looksLikeLoginUrl) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function findUserField() {
    const inputs = [...document.querySelectorAll("input")].filter((el) => el.offsetParent !== null);
    return (
      inputs.find((el) =>
        /user|login|emp|email/i.test(
          `${el.name} ${el.id} ${el.placeholder} ${el.getAttribute("formcontrolname") || ""}`
        )
      ) ||
      inputs.find((el) => ["text", "email", ""].includes(el.type) && el.type !== "password") ||
      null
    );
  }
  const findPassField = () =>
    [...document.querySelectorAll('input[type="password"]')].find(
      (el) => el.offsetParent !== null
    ) || null;

  function findLoginButton() {
    const btns = [...document.querySelectorAll("button, input[type=submit]")].filter(
      (el) => el.offsetParent !== null
    );
    return (
      btns.find((el) => /log\s?in|sign\s?in/i.test(el.textContent || el.value || "")) ||
      document.querySelector("button[type=submit]") ||
      null
    );
  }

  // Wait (SPA) for the form to appear.
  let userEl = null;
  let passEl = null;
  for (let i = 0; i < 50 && (!userEl || !passEl); i++) {
    userEl = findUserField();
    passEl = findPassField();
    if (userEl && passEl) break;
    await sleep(500);
  }
  if (!userEl || !passEl) return; // not a login page (e.g. already in portal)
  // If the username is already filled with a *different* value, don't stomp it.
  if (userEl.value && userEl.value.trim() && userEl.value.trim() !== user) return;

  const setVal = (el, v) => {
    el.focus();
    // Angular listens to native input events; try execCommand first to keep
    // its binding happy, but never let its deprecation throw abort the fill.
    try {
      el.value = "";
      document.execCommand("selectAll", false, null);
    } catch { /* deprecated — fall through to direct set */ }
    el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    // Nudge Angular's ngModel via the property setter as well.
    try {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      setter?.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } catch { /* non-fatal */ }
  };

  // Fill (re-finding fields in case the SPA re-rendered) and submit once.
  async function submitOnce() {
    const u = findUserField();
    const p = findPassField();
    if (!p) return false;
    if (u && (!u.value || u.value.trim() !== user)) setVal(u, user);
    setVal(p, pass);
    await sleep(600);
    const btn = findLoginButton();
    if (btn) btn.click();
    else if (p.form) p.form.requestSubmit?.() ?? p.form.submit();
    else p.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    return true;
  }

  try {
    await chrome.runtime.sendMessage({ type: "GT_AUTOLOGIN_SUBMITTED" });
  } catch { /* SW may be asleep — non-fatal */ }

  await submitOnce();

  // Watch the outcome. Retry the submit once if the first attempt errors or
  // stalls on the form — covers transient 500s and a background tab that
  // wasn't ready yet (a manual foreground tab "just works" for this reason).
  const t0 = Date.now();
  let attempts = 1;
  let retrying = false;
  let done = false;
  const report = (type) => {
    if (done) return;
    done = true;
    chrome.runtime.sendMessage({ type }).catch(() => {});
  };
  const findErr = () =>
    [...document.querySelectorAll("[class*=error], [class*=invalid], .toast, mat-error, .alert-danger")].find(
      (el) =>
        el.offsetParent !== null &&
        /invalid|incorrect|fail|wrong|denied|locked|error|500|try again/i.test(el.textContent || "")
    );
  const timer = setInterval(async () => {
    if (retrying) return;
    const url = location.href;
    if (/\/v3\/portal|\/ess\/|dashboard|home/i.test(url) && !findPassField()) {
      clearInterval(timer);
      report("GT_AUTOLOGIN_SUCCESS");
      return;
    }
    const err = findErr();
    const elapsed = Date.now() - t0;
    // One retry if it errored or stalled while still on the login form.
    if ((err || elapsed > 8000) && findPassField() && attempts < 2) {
      attempts++;
      retrying = true;
      await sleep(1200); // let a transient server error settle
      await submitOnce();
      retrying = false;
      return;
    }
    if (err) {
      clearInterval(timer);
      report("GT_AUTOLOGIN_FAILED");
      return;
    }
    if (elapsed > 28000) {
      clearInterval(timer);
      // Still on a login form → likely failed (or a captcha/MFA appeared).
      report(findPassField() ? "GT_AUTOLOGIN_FAILED" : "GT_AUTOLOGIN_SUCCESS");
    }
  }, 1000);
})();
