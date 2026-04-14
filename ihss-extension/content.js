// Content script — injected into IHSS timesheet page
// Reads DOM state and fills form inputs. No scheduling logic.
'use strict';

/**
 * Scan the DOM for all active (in-period) workdays.
 * Iterates timesheet-active-payperiod-{W}-{D} and timesheet-out-of-payperiod-{W}-{D}
 * until neither exists for a given (W, D) pair.
 *
 * @returns {Array<{week, dayIdx, dateText, hoursId, minutesId}>}
 */
function collectActiveDays() {
  const activeDays = [];

  for (let w = 0; ; w++) {
    let foundAnyInWeek = false;

    for (let d = 0; ; d++) {
      const activeEl = document.getElementById(`timesheet-active-payperiod-${w}-${d}`);
      const outEl    = document.getElementById(`timesheet-out-of-payperiod-${w}-${d}`);

      if (!activeEl && !outEl) break; // no more days in this week
      foundAnyInWeek = true;

      if (activeEl) {
        const labelEl = document.getElementById(`hours-label-a11y-${w}-${d}`);
        activeDays.push({
          week:       w,
          dayIdx:     d,
          dateText:   labelEl ? labelEl.textContent.trim() : `Week ${w} Day ${d}`,
          hoursId:    `hours-${w}-${d}`,
          minutesId:  `minutes-${w}-${d}`,
        });
      }
    }

    if (!foundAnyInWeek) break; // no more weeks
  }

  return activeDays;
}

/**
 * Build a human-readable period label from the first and last active day dates.
 * e.g. "Apr 1 – Apr 15"
 */
function buildPeriodLabel(activeDays) {
  if (!activeDays.length) return 'Current period';
  const extract = text => {
    const m = text.match(/([A-Za-z]+ \d+),/);
    return m ? m[1] : text.trim();
  };
  return `${extract(activeDays[0].dateText)} – ${extract(activeDays[activeDays.length - 1].dateText)}`;
}

/**
 * Read page state and return it to the popup.
 * Always returns a non-null object with a `status` field.
 * On failure, `status` is 'error' and `reason` describes what was missing.
 */
function getPageInfo() {
  const activeDays = collectActiveDays();
  if (!activeDays.length) {
    const sample = Array.from(document.querySelectorAll('[id]'))
      .slice(0, 20).map(el => el.id).join(', ');
    return {
      status: 'error',
      reason: `No active workdays found. Make sure a pay period is selected and the page is fully loaded. First 20 IDs on page: ${sample || '(none)'}`,
    };
  }

  const weekNums = [...new Set(activeDays.map(d => d.week))];
  return {
    status: 'ok',
    activeDays,
    weekCount:   weekNums.length,
    periodLabel: buildPeriodLabel(activeDays),
  };
}

/**
 * Fill all time inputs from a schedule array.
 * Uses the native HTMLInputElement setter + event dispatch to satisfy Angular's
 * reactive forms, which ignore direct .value assignment.
 *
 * @param {Array<{hoursId, minutesId, hours, minutes}>} schedule
 * @returns {{filled: number}}
 */
function fillSchedule(schedule) {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  ).set;

  function setInput(id, value) {
    const el = document.getElementById(id);
    if (!el) return false;
    nativeSetter.call(el, String(value));
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  let filled = 0;
  for (const entry of schedule) {
    const h = setInput(entry.hoursId,   entry.hours);
    const m = setInput(entry.minutesId, entry.minutes);
    if (h && m) filled++;
  }
  return { filled };
}

/**
 * Click the save button for a given workweek.
 *
 * @param {number} weekIndex
 * @returns {{ok: boolean}}
 */
function saveWorkweek(weekIndex) {
  const btn = document.getElementById(`save-timesheet-button-${weekIndex}`);
  if (!btn) return { ok: false };
  btn.click();
  return { ok: true };
}

/**
 * Expand all collapsed workweek panels.
 * Clicks any mat-expansion-panel-header that is currently in a collapsed panel.
 *
 * @returns {{expanded: number}}
 */
function expandAllWeeks() {
  const headers = document.querySelectorAll(
    'mat-expansion-panel:not(.mat-expanded) mat-expansion-panel-header'
  );
  headers.forEach(h => h.click());
  return { expanded: headers.length };
}

// Message dispatcher
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'getPageInfo') {
    sendResponse(getPageInfo());
  } else if (msg.action === 'fillSchedule') {
    sendResponse(fillSchedule(msg.schedule));
  } else if (msg.action === 'saveWorkweek') {
    sendResponse(saveWorkweek(msg.weekIndex));
  } else if (msg.action === 'expandAllWeeks') {
    sendResponse(expandAllWeeks());
  } else {
    return false; // not our message
  }
  return false; // synchronous response already sent
});
