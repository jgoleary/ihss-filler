// Run with: node tests/test-algorithm.js
'use strict';
const assert = require('assert');
const { detectPayPeriod, detectFebruary, distribute, isLeapYear } = require('../ihss-extension/popup.js');

let passed = 0;
let total = 0;
function test(name, fn) {
  total++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.message}`);
    process.exitCode = 1;
  }
}

// Helper: build a minimal activeDays entry
function makeDay(week, dayIdx, dayNum, month = 'Apr', year = 2026) {
  return {
    week,
    dayIdx,
    dateText: ` Hours for ${month} ${dayNum}, ${year} `,
    hoursId: `hours-${week}-${dayIdx}`,
    minutesId: `minutes-${week}-${dayIdx}`,
  };
}

// Helper: sum total minutes across a schedule
const totalMins = s => s.reduce((sum, d) => sum + d.hours * 60 + d.minutes, 0);

// ── detectFebruary ────────────────────────────────────────────────────────────
console.log('detectFebruary');

test('returns true when first day is in February', () => {
  const days = [makeDay(0, 0, 1, 'Feb')];
  assert.strictEqual(detectFebruary(days), true);
});

test('returns false when month is not February', () => {
  const days = [makeDay(0, 0, 1, 'Apr')];
  assert.strictEqual(detectFebruary(days), false);
});

test('returns false for empty array', () => {
  assert.strictEqual(detectFebruary([]), false);
});

// ── isLeapYear ────────────────────────────────────────────────────────────────
console.log('isLeapYear');

test('2024 is a leap year', () => {
  assert.strictEqual(isLeapYear(2024), true);
});

test('2026 is not a leap year', () => {
  assert.strictEqual(isLeapYear(2026), false);
});

test('2000 is a leap year (century divisible by 400)', () => {
  assert.strictEqual(isLeapYear(2000), true);
});

test('1900 is not a leap year (century not divisible by 400)', () => {
  assert.strictEqual(isLeapYear(1900), false);
});

// ── distribute — normal months ────────────────────────────────────────────────
console.log('distribute (normal months)');

test('125h/15 days: 10 days at 8h and 5 days at 9h, extra hours spread across weeks', () => {
  // 3 weeks × 5 days; baseHours=8, extraCount=5
  // Round-robin pass 0: w0d0, w1d0, w2d0 (3 assigned)
  // Round-robin pass 1: w0d1, w1d1              (5 assigned)
  // → week0: 2 extras, week1: 2 extras, week2: 1 extra
  const days = [];
  for (let w = 0; w < 3; w++)
    for (let d = 0; d < 5; d++)
      days.push(makeDay(w, d, w * 7 + d + 1));
  const s = distribute(days, 7500, 15000);
  assert.strictEqual(s.filter(d => d.hours === 9).length, 5,  '5 days at 9h');
  assert.strictEqual(s.filter(d => d.hours === 8).length, 10, '10 days at 8h');
  assert.strictEqual(s.filter(d => d.week === 0 && d.hours === 9).length, 2, 'week0 gets 2 extra-hour days');
  assert.strictEqual(s.filter(d => d.week === 1 && d.hours === 9).length, 2, 'week1 gets 2 extra-hour days');
  assert.strictEqual(s.filter(d => d.week === 2 && d.hours === 9).length, 1, 'week2 gets 1 extra-hour day');
  s.forEach(d => assert.strictEqual(d.minutes, 0, `day w${d.week}d${d.dayIdx} should have 0 minutes`));
  assert.strictEqual(totalMins(s), 7500);
});

test('leftover minutes go to the first active day (lowest week, lowest dayIdx)', () => {
  // 125h13m = 7513 min; leftoverMins = 13; first day = week0 dayIdx0
  const days = [];
  for (let w = 0; w < 3; w++)
    for (let d = 0; d < 5; d++)
      days.push(makeDay(w, d, w * 7 + d + 16));
  const s = distribute(days, 7513, 15013);
  const firstDay = s.find(d => d.week === 0 && d.dayIdx === 0);
  assert.strictEqual(firstDay.minutes, 13, 'first day gets 13 leftover minutes');
  s.filter(d => !(d.week === 0 && d.dayIdx === 0))
   .forEach(d => assert.strictEqual(d.minutes, 0, `day w${d.week}d${d.dayIdx} should have 0 minutes`));
  assert.strictEqual(totalMins(s), 7513);
});

test('first half (whole hours): no day has minutes', () => {
  const days = [];
  for (let w = 0; w < 3; w++)
    for (let d = 0; d < 5; d++)
      days.push(makeDay(w, d, w * 7 + d + 1));
  const s = distribute(days, 7500, 15000);
  s.forEach(d => assert.strictEqual(d.minutes, 0, `day w${d.week}d${d.dayIdx} should have 0 minutes`));
});

test('total minutes scheduled exactly equals period budget', () => {
  const days = [];
  for (let w = 0; w < 2; w++)
    for (let d = 0; d < 5; d++)
      days.push(makeDay(w, d, w * 7 + d + 1));
  const s = distribute(days, 5747, 11000);
  assert.strictEqual(totalMins(s), 5747);
});

test('single active day: gets all budget', () => {
  const s = distribute([makeDay(0, 0, 1)], 300, 600);
  assert.strictEqual(s[0].hours, 5);
  assert.strictEqual(s[0].minutes, 0);
  assert.strictEqual(totalMins(s), 300);
});

test('days delivered out of order: sorted correctly, first sorted day gets leftover minutes', () => {
  // days delivered in shuffled order; after sorting by dayIdx: [dayIdx0, dayIdx2, dayIdx4]
  // 3h10m = 190 min; baseHours = floor(3/3) = 1, extraCount = 0
  // firstDay = dayIdx0 → gets leftoverMins=10
  const days = [makeDay(0, 4, 5), makeDay(0, 0, 1), makeDay(0, 2, 3)];
  const s = distribute(days, 190, 400);
  const byDayIdx = Object.fromEntries(s.map(d => [d.dayIdx, d]));
  assert.strictEqual(byDayIdx[0].hours,   1);
  assert.strictEqual(byDayIdx[0].minutes, 10, 'dayIdx=0 (first sorted) gets leftover 10m');
  assert.strictEqual(byDayIdx[2].hours,   1);
  assert.strictEqual(byDayIdx[2].minutes, 0);
  assert.strictEqual(byDayIdx[4].hours,   1);
  assert.strictEqual(byDayIdx[4].minutes, 0);
  assert.strictEqual(totalMins(s), 190);
});

test('budget split: 250h13m → first half 125h, second half 125h13m, both sum to total', () => {
  const maxMonthlyMins = 15013;
  const totalHours     = Math.floor(maxMonthlyMins / 60); // 250
  const firstHalfMins  = Math.floor(totalHours / 2) * 60; // 7500
  const secondHalfMins = maxMonthlyMins - firstHalfMins;   // 7513

  const firstDays = [];
  for (let w = 0; w < 3; w++)
    for (let d = 0; d < 5; d++)
      firstDays.push(makeDay(w, d, w * 7 + d + 1));
  const secondDays = [];
  for (let w = 0; w < 3; w++)
    for (let d = 0; d < 5; d++)
      secondDays.push(makeDay(w, d, w * 7 + d + 16));

  const s1 = distribute(firstDays,  firstHalfMins,  maxMonthlyMins);
  const s2 = distribute(secondDays, secondHalfMins, maxMonthlyMins);

  assert.strictEqual(totalMins(s1), firstHalfMins,  'first half total matches');
  assert.strictEqual(totalMins(s2), secondHalfMins, 'second half total matches');
  assert.strictEqual(totalMins(s1) + totalMins(s2), maxMonthlyMins, 'both halves sum to monthly total');
});

const failed = total - passed;
console.log(failed > 0
  ? `\n${passed} passed, ${failed} failed`
  : `\n${passed} tests passed`);
