# greytHR Time Remaining

A Chrome (Manifest V3) extension that shows how much working time you have left
today, computed from your greytHR attendance swipes.

## How it works

- greytHR's portal fetches your swipes from
  `https://<subdomain>.greythr.com/latte/v3/attendance/info/<empId>/swipes`.
- The extension calls the **same endpoint** with `credentials: 'include'`, so it
  reuses your existing greytHR login (session cookies). By default no passwords
  are stored; if you opt in on the Settings page, your ESS username/password
  are kept in device-local browser storage and used to sign you back in
  automatically when the session expires (the login tab closes itself).
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

## Install (for users, no build needed)

1. Download the latest `greythr-time-remaining-v*.zip` from the repo's
   [Releases](../../releases) page and unzip it to a permanent folder.
2. Open `chrome://extensions`, turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select the unzipped folder.
4. Click the extension icon → **Connect greytHR** → sign in if asked. Done.

To update later, download the newer zip and repeat (or just replace the folder
and hit the reload ↻ on the extension card).

## Releasing (maintainers)

Everything is one command — it bumps the version, builds the zip, commits,
tags, and pushes:

```
powershell -ExecutionPolicy Bypass -File release.ps1 0.11.0
```

Then on GitHub → **Releases** → draft a release for the new `v0.11.0` tag and
attach `dist/greythr-time-remaining-v0.11.0.zip`. Tags give you a clean
latest/previous history (`git tag` to list them).

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 config, permissions, host access to `*.greythr.com` |
| `shared.js` | Fetch + the worked/remaining calculation (used by popup & background) |
| `background.js` | Auto-detects empId via `webRequest`; keeps the toolbar badge updated |
| `popup.html/.js/.css` | The main UI |
| `options.html/.js` | Settings |
| `build.ps1` / `release.ps1` | Build the zip / cut a tagged release |
