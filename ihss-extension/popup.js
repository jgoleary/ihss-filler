// Popup script — scheduling algorithm + UI state machine
'use strict';

// ── Pure scheduling functions (also exported for Node.js unit tests) ──────────

/**
 * Auto-detect pay period from active day date labels.
 * First half = every active day falls on a calendar day ≤ 15.
 * Date labels look like " Hours for Apr 1, 2026 ".
 *
 * @param {Array<{dateText: string}>} activeDays
 * @returns {boolean}
 */
function detectPayPeriod(activeDays) {
  const dayNums = activeDays.map(d => {
    const m = d.dateText.match(/(\d+),\s*\d{4}/);
    return m ? parseInt(m[1], 10) : 0;
  });
  return Math.max(...dayNums) <= 15;
}

/**
 * Distribute periodBudget minutes across activeDays, respecting maxWeekMinutes.
 *
 * Behavior:
 * - Greedy by week: earlier weeks fill to cap before later weeks receive anything
 * - Within each week: every day gets the same whole number of hours (0 minutes)
 * - The very last active day of the period carries all remaining minutes from
 *   floor-division remainders across all weeks — only one day ever has a
 *   fractional hour
 *
 * @param {Array<{week:number, dayIdx:number, dateText:string, hoursId:string, minutesId:string}>} activeDays
 * @param {number} periodBudget     Total minutes to schedule this period
 * @param {number} maxWeekMinutes   Weekly cap in minutes
 * @returns {Array<{week, dayIdx, dateText, hoursId, minutesId, hours, minutes}>}
 */
function distribute(activeDays, periodBudget, maxWeekMinutes) {
  const weekMap = new Map();
  for (const day of activeDays) {
    if (!weekMap.has(day.week)) weekMap.set(day.week, []);
    weekMap.get(day.week).push(day);
  }
  for (const [, days] of weekMap) {
    days.sort((a, b) => a.dayIdx - b.dayIdx);
  }
  const weekKeys = Array.from(weekMap.keys()).sort((a, b) => a - b);

  let remaining    = periodBudget;
  let deferredMins = 0; // sub-hour minute remainders, collected across all weeks
  const schedule   = [];

  for (const weekKey of weekKeys) {
    const days       = weekMap.get(weekKey);
    const weekBudget = Math.min(remaining, maxWeekMinutes);
    remaining       -= weekBudget;

    const weekHours  = Math.floor(weekBudget / 60);
    deferredMins    += weekBudget % 60; // fractional minutes deferred to last day

    const hoursPerDay = Math.floor(weekHours / days.length);
    const extraHours  = weekHours % days.length; // distribute to first days

    days.forEach((day, i) => {
      schedule.push({ ...day, hours: hoursPerDay + (i < extraHours ? 1 : 0), minutes: 0 });
    });
  }

  // Sub-hour minutes accumulated across all weeks go to the last active day
  if (schedule.length > 0) {
    const last = schedule[schedule.length - 1];
    last.hours   += Math.floor(deferredMins / 60);
    last.minutes  = deferredMins % 60;
  }

  return schedule;
}

if (typeof module !== 'undefined') {
  module.exports = { detectPayPeriod, distribute };
}

// ── Browser UI (not executed in Node.js) ─────────────────────────────────────
if (typeof document === 'undefined') { /* running in Node.js — stop here */ }
else {

// ── UI helpers ───────────────────────────────────────────────────────────────

const STATES = ['wrong-page', 'not-ready', 'ready', 'preview', 'done'];

function showState(name) {
  STATES.forEach(s => {
    document.getElementById(`state-${s}`).style.display = s === name ? 'block' : 'none';
  });
}

function fmtTime(hours, minutes) {
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function fmtMins(totalMins) {
  return fmtTime(Math.floor(totalMins / 60), totalMins % 60);
}

// ── Storage ──────────────────────────────────────────────────────────────────

function loadMaxMonthlyMins() {
  return new Promise(resolve => {
    chrome.storage.local.get('maxMonthlyMins', ({ maxMonthlyMins }) => resolve(maxMonthlyMins ?? 9600)); // default 160h
  });
}

function saveMaxMonthlyMins(totalMins) {
  return new Promise(resolve => chrome.storage.local.set({ maxMonthlyMins: totalMins }, resolve));
}

// ── Messaging ────────────────────────────────────────────────────────────────

function getActiveTab() {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => resolve(tab));
  });
}

function sendToContent(tabId, msg) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, msg, response => {
      resolve(chrome.runtime.lastError ? null : response);
    });
  });
}

// ── State ────────────────────────────────────────────────────────────────────

let currentTab      = null;
let currentPageInfo = null;
let currentSchedule = null;

// ── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  currentTab = await getActiveTab();

  if (!currentTab?.url?.includes('etimesheets.ihss.ca.gov')) {
    showState('wrong-page');
    return;
  }

  const savedMins = await loadMaxMonthlyMins();
  document.getElementById('max-monthly-h').value = Math.floor(savedMins / 60);
  document.getElementById('max-monthly-m').value = savedMins % 60;

  currentPageInfo = await sendToContent(currentTab.id, { action: 'getPageInfo' });

  if (!currentPageInfo || currentPageInfo.status !== 'ok') {
    document.getElementById('not-ready-detail').textContent =
      currentPageInfo?.reason ?? 'Content script did not respond. Reload the IHSS tab and try again.';
    showState('not-ready');
    return;
  }

  const { activeDays, periodLabel } = currentPageInfo;
  document.getElementById('ready-period').textContent = `Pay period: ${periodLabel}`;
  document.getElementById('ready-days').textContent =
    `Active days: ${activeDays.length} across ${currentPageInfo.weekCount} week(s)`;

  showState('ready');
});

// ── Calculate ────────────────────────────────────────────────────────────────

document.getElementById('btn-calculate').addEventListener('click', async () => {
  const h = parseInt(document.getElementById('max-monthly-h').value, 10) || 0;
  const m = parseInt(document.getElementById('max-monthly-m').value, 10) || 0;
  const maxMonthlyMins = h * 60 + m;
  if (maxMonthlyMins < 1) return;
  if (currentPageInfo?.status !== 'ok') return;
  await saveMaxMonthlyMins(maxMonthlyMins);

  const { activeDays } = currentPageInfo;
  const isFirstHalf   = detectPayPeriod(activeDays);
  const periodBudget  = isFirstHalf
    ? Math.ceil(maxMonthlyMins / 2)
    : Math.floor(maxMonthlyMins / 2);
  const maxWeekMins   = Math.ceil(maxMonthlyMins / 4);
  const weekCount     = new Set(activeDays.map(d => d.week)).size;
  const maxPossible   = weekCount * maxWeekMins;

  const capWarning = document.getElementById('preview-cap-warning');
  if (maxPossible < periodBudget) {
    capWarning.textContent =
      `Warning: ${weekCount} week(s) × ${fmtMins(maxWeekMins)}/week allows at most ${fmtMins(maxPossible)} ` +
      `but ${fmtMins(periodBudget)} is budgeted. ${fmtMins(periodBudget - maxPossible)} will not be scheduled.`;
    capWarning.style.display = 'block';
  } else {
    capWarning.style.display = 'none';
  }

  currentSchedule = distribute(activeDays, periodBudget, maxWeekMins);

  const tbody = document.getElementById('preview-table-body');
  tbody.innerHTML = '';
  for (const entry of currentSchedule) {
    const tr = document.createElement('tr');
    const dateLabel = entry.dateText.replace(/Hours for/i, '').trim();
    const td1 = document.createElement('td');
    td1.textContent = dateLabel;
    const td2 = document.createElement('td');
    td2.textContent = entry.hours;
    const td3 = document.createElement('td');
    td3.textContent = entry.minutes;
    tr.append(td1, td2, td3);
    tbody.appendChild(tr);
  }

  const scheduledTotal = currentSchedule.reduce((s, d) => s + d.hours * 60 + d.minutes, 0);
  document.getElementById('preview-summary').textContent =
    `Scheduled: ${fmtMins(scheduledTotal)} of ${fmtMins(periodBudget)} this period`;

  showState('preview');
});

// ── Back ─────────────────────────────────────────────────────────────────────

document.getElementById('btn-back').addEventListener('click', () => showState('ready'));

// ── Fill ─────────────────────────────────────────────────────────────────────

document.getElementById('btn-fill').addEventListener('click', async () => {
  document.getElementById('btn-fill').disabled = true;

  const fillResult = await sendToContent(currentTab.id, { action: 'fillSchedule', schedule: currentSchedule });
  if (!fillResult) {
    document.getElementById('done-message').textContent =
      'Could not reach the IHSS page. Reload the timesheet tab and try again.';
    showState('done');
    return;
  }

  await sendToContent(currentTab.id, { action: 'expandAllWeeks' });

  document.getElementById('done-message').textContent =
    `Filled ${fillResult.filled} day(s). Review the timesheet, then save and submit manually.`;
  showState('done');
});

} // end browser-only block
