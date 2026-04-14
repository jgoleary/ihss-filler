// Content script — injected into IHSS timesheet page
// Reads DOM state and fills form inputs. No scheduling logic.
'use strict';

/**
 * Parse the monthly available hours from the display element.
 * Tries "HH:MM" format first, then a plain integer.
 *
 * NOTE: Inspect #available-ts-hours on the live page to confirm the text format.
 * If this returns null, the format doesn't match — update the regex accordingly.
 *
 * @returns {{hours: number, minutes: number}|null}
 */
function parseAvailableHours() {
  const el = document.getElementById('available-ts-hours');
  if (!el) return null;
  const text = el.textContent.trim();

  // "283:30" format
  const colonMatch = text.match(/(\d+):(\d+)/);
  if (colonMatch) {
    return { hours: parseInt(colonMatch[1], 10), minutes: parseInt(colonMatch[2], 10) };
  }
  // Plain integer hours
  const intMatch = text.match(/^(\d+)$/);
  if (intMatch) {
    return { hours: parseInt(intMatch[1], 10), minutes: 0 };
  }
  return null;
}

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
 * Returns null if the available-hours element is not found (page not ready).
 */
function getPageInfo() {
  const available = parseAvailableHours();
  if (!available) return null;

  const activeDays = collectActiveDays();
  const weekNums   = [...new Set(activeDays.map(d => d.week))];

  return {
    available,
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

// Message dispatcher
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'getPageInfo') {
    sendResponse(getPageInfo());
  } else if (msg.action === 'fillSchedule') {
    sendResponse(fillSchedule(msg.schedule));
  } else if (msg.action === 'saveWorkweek') {
    sendResponse(saveWorkweek(msg.weekIndex));
  } else {
    return false; // not our message
  }
  return false; // synchronous response already sent
});
