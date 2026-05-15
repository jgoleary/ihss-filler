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

function detectFebruary(activeDays) {
  if (activeDays.length === 0) return false;
  const m = activeDays[0].dateText.match(/Hours for (\w+)/i);
  return m ? m[1].toLowerCase().startsWith('feb') : false;
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function distributeNormal(activeDays, periodBudget) {
  const weekMap = new Map();
  for (const day of activeDays) {
    if (!weekMap.has(day.week)) weekMap.set(day.week, []);
    weekMap.get(day.week).push(day);
  }
  for (const [, days] of weekMap) days.sort((a, b) => a.dayIdx - b.dayIdx);
  const weekKeys = Array.from(weekMap.keys()).sort((a, b) => a - b);

  const periodDays   = activeDays.length;
  const periodHours  = Math.floor(periodBudget / 60);
  const leftoverMins = periodBudget % 60;
  const baseHours    = Math.floor(periodHours / periodDays);
  const extraCount   = periodHours % periodDays;

  // Extra-hour slots: first day of each week, round-robin until extraCount is met
  const extraSet = new Set();
  let assigned = 0;
  let pass = 0;
  while (assigned < extraCount) {
    for (const wk of weekKeys) {
      if (assigned >= extraCount) break;
      const days = weekMap.get(wk);
      if (pass < days.length) { extraSet.add(days[pass]); assigned++; }
    }
    pass++;
  }

  const firstDay = weekMap.get(weekKeys[0])[0];

  const schedule = [];
  for (const wk of weekKeys) {
    for (const day of weekMap.get(wk)) {
      schedule.push({
        ...day,
        hours:   baseHours + (extraSet.has(day) ? 1 : 0),
        minutes: day === firstDay ? leftoverMins : 0,
      });
    }
  }
  return schedule;
}

function distributeFebruary(activeDays, maxMonthlyMins) {
  const yearMatch = activeDays[0].dateText.match(/(\d{4})/);
  const year      = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();
  const febDays   = isLeapYear(year) ? 29 : 28;
  const dailyBase   = Math.floor(maxMonthlyMins / febDays);
  const higherCount = maxMonthlyMins % febDays;

  // Build full-month structure. Calendar weeks: days 1-7=wk0, 8-14=wk1, 15-21=wk2, 22-28=wk3, (29=wk4)
  const weekBuckets = new Map();
  for (let calDay = 1; calDay <= febDays; calDay++) {
    const wk = Math.floor((calDay - 1) / 7);
    if (!weekBuckets.has(wk)) weekBuckets.set(wk, []);
    weekBuckets.get(wk).push({ calDay, mins: dailyBase });
  }
  const weekKeys = Array.from(weekBuckets.keys()).sort((a, b) => a - b);

  // Assign higher-minute slots round-robin (first day of each week first)
  let assigned = 0;
  let pass = 0;
  while (assigned < higherCount) {
    for (const wk of weekKeys) {
      if (assigned >= higherCount) break;
      const slots = weekBuckets.get(wk);
      if (pass < slots.length) { slots[pass].mins++; assigned++; }
    }
    pass++;
  }

  // Build calDay → assigned-minutes lookup
  const calDayToMins = new Map();
  for (const slots of weekBuckets.values())
    for (const { calDay, mins } of slots)
      calDayToMins.set(calDay, mins);

  return activeDays.map(day => {
    const m      = day.dateText.match(/(\d+),\s*\d{4}/);
    const calDay = m ? parseInt(m[1], 10) : 1;
    const mins   = calDayToMins.get(calDay) ?? dailyBase;
    return { ...day, hours: Math.floor(mins / 60), minutes: mins % 60 };
  });
}

function distribute(activeDays, periodBudget, maxMonthlyMins) {
  if (detectFebruary(activeDays)) return distributeFebruary(activeDays, maxMonthlyMins);
  return distributeNormal(activeDays, periodBudget);
}

if (typeof module !== 'undefined') {
  module.exports = { detectPayPeriod, detectFebruary, distribute, isLeapYear };
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
