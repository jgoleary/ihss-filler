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

// ── distribute ───────────────────────────────────────────────────────────────
console.log('distribute');

test('10h across 3 days (single week): first day gets extra hour', () => {
  const days = [makeDay(0, 0, 1), makeDay(0, 1, 2), makeDay(0, 2, 3)];
  const s = distribute(days, 600, 2400); // 10h = 600 min; weekHours=10, hoursPerDay=3, extraHours=1
  assert.strictEqual(s[0].hours, 4, 'day 0 gets extra hour');
  assert.strictEqual(s[1].hours, 3, 'day 1');
  assert.strictEqual(s[2].hours, 3, 'day 2');
  assert.strictEqual(s[0].minutes, 0);
  assert.strictEqual(s[2].minutes, 0); // no deferred mins (600 % 60 = 0)
  assert.strictEqual(totalMins(s), 600);
});

test('39h30m across 5 days (single week): first 4 get 8h, last gets 7h30m', () => {
  const days = Array.from({ length: 5 }, (_, i) => makeDay(0, i, i + 1));
  const s = distribute(days, 2370, 2400); // 39h30m = 2370 min; weekHours=39, hoursPerDay=7, extraHours=4
  assert.strictEqual(s[0].hours, 8, 'day 0 (extra hour)');
  assert.strictEqual(s[1].hours, 8, 'day 1 (extra hour)');
  assert.strictEqual(s[2].hours, 8, 'day 2 (extra hour)');
  assert.strictEqual(s[3].hours, 8, 'day 3 (extra hour)');
  assert.strictEqual(s[4].hours, 7, 'last day base hours');
  assert.strictEqual(s[4].minutes, 30, 'last day carries deferred 30m (2370 % 60)');
  assert.strictEqual(s[0].minutes, 0, 'day 0 no minutes');
  assert.strictEqual(totalMins(s), 2370);
});

test('evenly divisible: every day same whole hours, no minutes', () => {
  const days = Array.from({ length: 5 }, (_, i) => makeDay(0, i, i + 1));
  const s = distribute(days, 2400, 2400); // 40h exact; hoursPerDay = 8
  s.forEach((d, i) => {
    assert.strictEqual(d.hours, 8, `day ${i}`);
    assert.strictEqual(d.minutes, 0, `day ${i} minutes`);
  });
  assert.strictEqual(totalMins(s), 2400);
});

test('multi-week: cap divides cleanly, every day gets equal hours', () => {
  const days = [];
  for (let w = 0; w < 3; w++)
    for (let d = 0; d < 5; d++)
      days.push(makeDay(w, d, w * 7 + d + 1));
  const s = distribute(days, 7200, 2400); // 120h total, 40h cap — 8h/day exactly
  s.forEach((d, i) => {
    assert.strictEqual(d.hours, 8, `entry ${i} hours`);
    assert.strictEqual(d.minutes, 0, `entry ${i} minutes`);
  });
  assert.strictEqual(totalMins(s), 7200);
});

test('week with more days than whole hours: extra hours on first days, minutes deferred', () => {
  // 5h11m (311 min) across 7 days: weekHours=5, hoursPerDay=0, extraHours=5
  // First 5 days get 1h, last 2 get 0h; 11m deferred to last day of period
  const days = Array.from({ length: 7 }, (_, i) => makeDay(0, i, i + 5));
  const s = distribute(days, 311, 2400);
  for (let i = 0; i < 5; i++) assert.strictEqual(s[i].hours, 1, `day ${i}`);
  assert.strictEqual(s[5].hours, 0, 'day 5');
  assert.strictEqual(s[6].hours, 0, 'day 6 base hours');
  assert.strictEqual(s[6].minutes, 11, 'day 6 gets deferred 11m (311 % 60)');
  assert.strictEqual(totalMins(s), 311);
});

test('cap enforced: week 0 fills to cap, week 1 gets remainder, last day has minutes', () => {
  // 2 weeks × 5 days, 50h20m = 3020 min, cap = 30h = 1800 min
  const days = [];
  for (let w = 0; w < 2; w++)
    for (let d = 0; d < 5; d++)
      days.push(makeDay(w, d, w * 7 + d + 1));
  const s = distribute(days, 3020, 1800);
  // Week 0: budget=1800, hoursPerDay=floor(30/5)=6 → all 5 days get 6h
  // Week 1: budget=1220, hoursPerDay=floor(20/5)=4 → all 5 days get 4h
  // totalScheduled=5×360+5×240=1800+1200=3000, leftover=20 → last day gets 4h20m
  const week0 = s.filter(d => d.week === 0);
  const week1 = s.filter(d => d.week === 1);
  week0.forEach((d, i) => assert.strictEqual(d.hours, 6, `w0 day ${i}`));
  week0.forEach((d, i) => assert.strictEqual(d.minutes, 0, `w0 day ${i} minutes`));
  week1.slice(0, 4).forEach((d, i) => assert.strictEqual(d.hours, 4, `w1 day ${i}`));
  week1.slice(0, 4).forEach((d, i) => assert.strictEqual(d.minutes, 0, `w1 day ${i} minutes`));
  assert.strictEqual(week1[4].hours, 4, 'last day hours');
  assert.strictEqual(week1[4].minutes, 20, 'last day carries all remaining minutes');
  assert.strictEqual(totalMins(s), 3020);
});

test('odd monthly minutes: both periods sum to exactly monthly total', () => {
  // 20h43m = 1243 min. First half gets ceil, second gets floor — sum = 1243 exactly.
  const maxMonthly  = 1243;
  const maxWeekMins = Math.ceil(maxMonthly / 4); // 311

  // First half: days 1–14 (2 weeks × 7 days)
  const firstDays = [];
  for (let w = 0; w < 2; w++)
    for (let d = 0; d < 7; d++)
      firstDays.push(makeDay(w, d, w * 7 + d + 1));
  assert.strictEqual(detectPayPeriod(firstDays), true, 'detected as first half');
  const budget1 = Math.ceil(maxMonthly / 2);  // 622
  const s1 = distribute(firstDays, budget1, maxWeekMins);
  assert.strictEqual(totalMins(s1), budget1, 'first half consumes exactly ceil(M/2)');

  // Second half: days 16–28 (2 weeks × 7 days)
  const secondDays = [];
  for (let w = 0; w < 2; w++)
    for (let d = 0; d < 7; d++)
      secondDays.push(makeDay(w, d, w * 7 + d + 16));
  assert.strictEqual(detectPayPeriod(secondDays), false, 'detected as second half');
  const budget2 = Math.floor(maxMonthly / 2); // 621
  const s2 = distribute(secondDays, budget2, maxWeekMins);
  assert.strictEqual(totalMins(s2), budget2, 'second half consumes exactly floor(M/2)');

  assert.strictEqual(budget1 + budget2, maxMonthly, 'both periods sum to monthly total');
});

test('single active day: gets all budget', () => {
  const s = distribute([makeDay(0, 0, 1)], 300, 600); // 5h budget
  assert.strictEqual(s[0].hours, 5);
  assert.strictEqual(s[0].minutes, 0);
  assert.strictEqual(totalMins(s), 300);
});

test('budget under 1 hour per day: extra hour on first day, deferred mins on last', () => {
  const days = [makeDay(0, 0, 1), makeDay(0, 1, 2)];
  const s = distribute(days, 90, 2400); // 1h30m; weekHours=1, hoursPerDay=0, extraHours=1
  assert.strictEqual(s[0].hours, 1, 'day 0 gets the extra hour');
  assert.strictEqual(s[0].minutes, 0);
  assert.strictEqual(s[1].hours, 0, 'last day base hours');
  assert.strictEqual(s[1].minutes, 30, 'last day gets deferred 30m (90 % 60)');
  assert.strictEqual(totalMins(s), 90);
});

test('days delivered out of order: last chronological day gets all remaining time', () => {
  const days = [
    makeDay(0, 4, 5),
    makeDay(0, 0, 1),
    makeDay(0, 2, 3),
  ];
  const s = distribute(days, 190, 2400); // 3h10m = 190 min; hoursPerDay = floor(3/3) = 1
  const byDayIdx = Object.fromEntries(s.map(d => [d.dayIdx, d]));
  assert.strictEqual(byDayIdx[0].hours, 1);
  assert.strictEqual(byDayIdx[0].minutes, 0);
  assert.strictEqual(byDayIdx[2].hours, 1);
  assert.strictEqual(byDayIdx[2].minutes, 0);
  assert.strictEqual(byDayIdx[4].hours, 1, 'last day hours');
  assert.strictEqual(byDayIdx[4].minutes, 10, 'last day gets minute remainder');
  assert.strictEqual(totalMins(s), 190);
});

const failed = total - passed;
console.log(failed > 0
  ? `\n${passed} passed, ${failed} failed`
  : `\n${passed} tests passed`);
