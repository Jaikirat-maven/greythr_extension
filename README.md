# greytHR Time Remaining

A Chrome (Manifest V3) extension that shows how much working time you have left
today, computed from your greytHR attendance swipes.

## How it works

- greytHR's portal fetches your swipes from
  `https://<subdomain>.greythr.com/latte/v3/attendance/info/<empId>/swipes`.
- The extension calls the **same endpoint** with `credentials: 'include'`, so it
  reuses your existing greytHR login (session cookies). No passwords are stored.
- `swipePairs[].actualHours` are in **seconds**; the API also sums them as
  `totalActualHours`. If your last swipe is an IN with no matching OUT, the
  extension adds live time up to *now*.
- `remaining = requiredHours − workedSoFar`. When clocked in, it also shows a
  **Leave by** time.

`punchDateTime` is UTC despite having no `Z`, so live "clocked in" time is parsed
as UTC to stay correct in IST.

## Setup

1. Go to `chrome://extensions`, enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Open your greytHR attendance page once
   (`/v3/portal/ess/attendance/attendance-info`) so the extension can
   auto-detect your subdomain + employee ID.
4. Click the extension icon — it shows worked / remaining / leave-by. The
   toolbar badge shows remaining minutes/hours and refreshes every 5 min.

## Settings

Open **Settings** (from the popup) to set your **required hours** (default
8h 30m), or to override the auto-detected subdomain / employee ID.

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 config, permissions, host access to `*.greythr.com` |
| `shared.js` | Fetch + the worked/remaining calculation (used by popup & background) |
| `background.js` | Auto-detects empId via `webRequest`; keeps the toolbar badge updated |
| `popup.html/.js/.css` | The main UI |
| `options.html/.js` | Settings |
