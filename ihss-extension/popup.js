// Popup script — scheduling algorithm + UI state machine
'use strict';

// ── Pure scheduling functions (also exported for Node.js unit tests) ─────────

function computePeriodBudget(totalMinutes, isFirstHalf) {
  return isFirstHalf ? Math.ceil(totalMinutes / 2) : totalMinutes;
}

function detectPayPeriod(activeDays) {
  if (activeDays.length === 0) throw new Error('detectPayPeriod: no active days');
  const dayNums = activeDays.map(d => {
    const m = d.dateText.match(/(\d+),\s*\d{4}/);
    return m ? parseInt(m[1], 10) : 0;
  });
  return Math.max(...dayNums) <= 15;
}

function distribute(activeDays, periodBudget, maxPerWeekMinutes) {
  const weekMap = new Map();
  for (const day of activeDays) {
    if (!weekMap.has(day.week)) weekMap.set(day.week, []);
    weekMap.get(day.week).push(day);
  }
  for (const [, days] of weekMap) {
    days.sort((a, b) => a.dayIdx - b.dayIdx);
  }
  const weekKeys = Array.from(weekMap.keys()).sort((a, b) => a - b);

  let remaining = periodBudget;
  const schedule = [];

  for (const weekKey of weekKeys) {
    const days = weekMap.get(weekKey);
    const weekBudget   = Math.min(remaining, maxPerWeekMinutes);
    remaining         -= weekBudget;
    const weekHours    = Math.floor(weekBudget / 60);
    const weekMins     = weekBudget % 60;
    const hoursPerDay  = Math.floor(weekHours / days.length);
    const extraHours   = weekHours % days.length;

    days.forEach((day, i) => {
      schedule.push({
        ...day,
        hours:   hoursPerDay + (i < extraHours ? 1 : 0),
        minutes: i === days.length - 1 ? weekMins : 0,
      });
    });
  }

  return schedule;
}

if (typeof module !== 'undefined') {
  module.exports = { computePeriodBudget, detectPayPeriod, distribute };
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

function loadMaxPerWeek() {
  return new Promise(resolve => {
    chrome.storage.local.get('maxPerWeek', ({ maxPerWeek }) => resolve(maxPerWeek ?? 40));
  });
}

function saveMaxPerWeek(value) {
  return new Promise(resolve => chrome.storage.local.set({ maxPerWeek: value }, resolve));
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

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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

  document.getElementById('max-per-week').value = await loadMaxPerWeek();

  currentPageInfo = await sendToContent(currentTab.id, { action: 'getPageInfo' });

  if (!currentPageInfo?.available) {
    showState('not-ready');
    return;
  }

  const { available, activeDays, periodLabel } = currentPageInfo;
  const totalMins  = available.hours * 60 + available.minutes;
  const isFirst    = detectPayPeriod(activeDays);
  const budget     = computePeriodBudget(totalMins, isFirst);

  document.getElementById('ready-period').textContent =
    `Pay period: ${periodLabel}` +
    (isFirst ? ' (1st half — planning half your monthly hours)' : '');
  document.getElementById('ready-available').textContent =
    `Monthly total: ${fmtTime(available.hours, available.minutes)} — Planning ${fmtMins(budget)} this period`;
  document.getElementById('ready-days').textContent =
    `Active days: ${activeDays.length} across ${currentPageInfo.weekCount} week(s)`;

  showState('ready');
});

// ── Calculate ────────────────────────────────────────────────────────────────

document.getElementById('btn-calculate').addEventListener('click', async () => {
  const maxPerWeek = parseInt(document.getElementById('max-per-week').value, 10);
  if (!maxPerWeek || maxPerWeek < 1) return;
  await saveMaxPerWeek(maxPerWeek);

  const { available, activeDays } = currentPageInfo;
  const totalMins        = available.hours * 60 + available.minutes;
  const isFirst          = detectPayPeriod(activeDays);
  const budget           = computePeriodBudget(totalMins, isFirst);
  const maxPerWeekMins   = maxPerWeek * 60;
  const weekCount        = new Set(activeDays.map(d => d.week)).size;
  const maxPossible      = weekCount * maxPerWeekMins;

  const capWarning = document.getElementById('preview-cap-warning');
  if (maxPossible < budget) {
    capWarning.textContent =
      `Warning: weekly cap allows at most ${fmtMins(maxPossible)} this period but ` +
      `${fmtMins(budget)} is available. ${fmtMins(budget - maxPossible)} will not be scheduled.`;
    capWarning.style.display = 'block';
  } else {
    capWarning.style.display = 'none';
  }

  currentSchedule = distribute(activeDays, budget, maxPerWeekMins);

  const tbody = document.getElementById('preview-table-body');
  tbody.innerHTML = '';
  for (const entry of currentSchedule) {
    const tr = document.createElement('tr');
    const dateLabel = entry.dateText.replace(/Hours for/i, '').trim();
    tr.innerHTML = `<td>${dateLabel}</td><td>${entry.hours}</td><td>${entry.minutes}</td>`;
    tbody.appendChild(tr);
  }

  const scheduledTotal = currentSchedule.reduce((s, d) => s + d.hours * 60 + d.minutes, 0);
  document.getElementById('preview-summary').textContent =
    `Total scheduled: ${fmtMins(scheduledTotal)}`;

  showState('preview');
});

// ── Back ─────────────────────────────────────────────────────────────────────

document.getElementById('btn-back').addEventListener('click', () => showState('ready'));

// ── Fill & Save ──────────────────────────────────────────────────────────────

document.getElementById('btn-fill').addEventListener('click', async () => {
  document.getElementById('btn-fill').disabled = true;

  await sendToContent(currentTab.id, { action: 'fillSchedule', schedule: currentSchedule });

  const weekNums  = [...new Set(currentSchedule.map(d => d.week))].sort((a, b) => a - b);
  let savedCount  = 0;

  for (const w of weekNums) {
    const result = await sendToContent(currentTab.id, { action: 'saveWorkweek', weekIndex: w });
    if (result?.ok) savedCount++;
    await delay(400);
  }

  document.getElementById('done-message').textContent =
    `Filled ${currentSchedule.length} day(s) and saved ${savedCount} of ${weekNums.length} workweek(s).`;
  showState('done');
});

} // end browser-only block
