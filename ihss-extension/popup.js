// Popup script — scheduling algorithm + UI state machine
'use strict';

// ── Pure scheduling functions (testable in Node.js) ─────────────────────────

/**
 * Determine how many minutes to schedule in the current pay period.
 * First half uses ceil(total/2) so any odd minute goes to the first period.
 * Second half uses the full available total.
 *
 * @param {number} totalMinutes  Full monthly authorization in minutes
 * @param {boolean} isFirstHalf  Whether the current period is days 1–15
 * @returns {number}
 */
function computePeriodBudget(totalMinutes, isFirstHalf) {
  return isFirstHalf ? Math.ceil(totalMinutes / 2) : totalMinutes;
}

/**
 * Auto-detect pay period from active day date labels.
 * First half = every active day falls on a calendar day ≤ 15.
 * Date labels look like " Hours for Apr 1, 2026 ".
 *
 * @param {Array<{dateText: string}>} activeDays
 * @returns {boolean}
 */
function detectPayPeriod(activeDays) {
  if (activeDays.length === 0) throw new Error('detectPayPeriod: no active days');
  const dayNums = activeDays.map(d => {
    const m = d.dateText.match(/(\d+),\s*\d{4}/);
    return m ? parseInt(m[1], 10) : 0;
  });
  return Math.max(...dayNums) <= 15;
}

/**
 * Distribute periodBudget minutes across activeDays, respecting maxPerWeekMinutes.
 *
 * Behavior:
 * - Greedy by week: earlier weeks fill to cap before later weeks receive anything
 * - Within each week: whole hours distributed as evenly as possible; first days
 *   receive any extra whole hour; the last active day carries the minute remainder
 *
 * @param {Array<{week:number, dayIdx:number, dateText:string, hoursId:string, minutesId:string}>} activeDays
 * @param {number} periodBudget        Total minutes to schedule this period
 * @param {number} maxPerWeekMinutes   Weekly cap in minutes
 * @returns {Array<{week, dayIdx, dateText, hoursId, minutesId, hours, minutes}>}
 */
function distribute(activeDays, periodBudget, maxPerWeekMinutes) {
  // Group days by week, preserving insertion order within each week
  const weekMap = new Map();
  for (const day of activeDays) {
    if (!weekMap.has(day.week)) weekMap.set(day.week, []);
    weekMap.get(day.week).push(day);
  }
  // Sort days within each week by dayIdx so minute remainder always lands on the last day
  for (const [, days] of weekMap) {
    days.sort((a, b) => a.dayIdx - b.dayIdx);
  }
  const weekKeys = Array.from(weekMap.keys()).sort((a, b) => a - b);

  let remaining = periodBudget;
  const schedule = [];

  for (const weekKey of weekKeys) {
    const days = weekMap.get(weekKey);
    const weekBudget = Math.min(remaining, maxPerWeekMinutes);
    remaining -= weekBudget;

    const weekHours   = Math.floor(weekBudget / 60);
    const weekMins    = weekBudget % 60;
    const hoursPerDay = Math.floor(weekHours / days.length);
    const extraHours  = weekHours % days.length; // given to the first N days

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

// Node.js export guard — allows unit testing without a browser
if (typeof module !== 'undefined') {
  module.exports = { computePeriodBudget, detectPayPeriod, distribute };
}
