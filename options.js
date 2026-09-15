const DEFAULT_REQUIRED_MINUTES = 510; // keep in sync with shared.js
const DEFAULT_LEAVE_MINUTES = 19 * 60; // 7:00 PM
const DEFAULT_HEADSUP_MINUTES = 10;

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");

async function restore() {
  const { requiredMinutes, leaveMinutes, headsUpMinutes, subdomain, empId } =
    await chrome.storage.local.get([
      "requiredMinutes",
      "leaveMinutes",
      "headsUpMinutes",
      "subdomain",
      "empId",
    ]);
  const total = requiredMinutes || DEFAULT_REQUIRED_MINUTES;
  $("hours").value = Math.floor(total / 60);
  $("minutes").value = total % 60;
  const lv = leaveMinutes ?? DEFAULT_LEAVE_MINUTES;
  $("leaveTime").value = `${pad(Math.floor(lv / 60))}:${pad(lv % 60)}`;
  $("headsUp").value = headsUpMinutes ?? DEFAULT_HEADSUP_MINUTES;
  $("subdomain").value = subdomain || "";
  $("empId").value = empId || "";
}

async function save() {
  const h = parseInt($("hours").value, 10) || 0;
  const m = parseInt($("minutes").value, 10) || 0;
  const patch = {
    requiredMinutes: h * 60 + m,
    subdomain: $("subdomain").value.trim() || "mavenvista",
  };
  const lv = $("leaveTime").value; // "HH:MM"
  if (lv && /^\d{2}:\d{2}$/.test(lv)) {
    const [lh, lm] = lv.split(":").map(Number);
    patch.leaveMinutes = lh * 60 + lm;
  }
  patch.headsUpMinutes = Math.max(0, parseInt($("headsUp").value, 10) || 0);
  const empId = $("empId").value.trim();
  if (empId) patch.empId = empId;

  await chrome.storage.local.set(patch);
  $("saved").textContent = "Saved ✓";
  setTimeout(() => ($("saved").textContent = ""), 1500);
}

$("save").addEventListener("click", save);
restore();
