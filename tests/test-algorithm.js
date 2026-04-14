// Run with: node tests/test-algorithm.js
'use strict';
const assert = require('assert');
const { computePeriodBudget, detectPayPeriod, distribute } = require('../ihss-extension/popup.js');

let passed = 0;
function test(name, fn) {
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

// ── computePeriodBudget ──────────────────────────────────────────────────────
console.log('computePeriodBudget');

test('first half, odd total: uses ceil', () => {
  assert.strictEqual(computePeriodBudget(9331, true), 4666);
});
test('first half, even total: no rounding needed', () => {
  assert.strictEqual(computePeriodBudget(9330, true), 4665);
});
test('second half: uses full total', () => {
  assert.strictEqual(computePeriodBudget(9330, false), 9330);
});
test('second half, odd total: no division', () => {
  assert.strictEqual(computePeriodBudget(9331, false), 9331);
});

// ── detectPayPeriod ──────────────────────────────────────────────────────────
console.log('detectPayPeriod');

test('all days ≤ 15 → first half', () => {
  const days = [makeDay(0, 0, 1), makeDay(0, 1, 7), makeDay(1, 0, 14)];
  assert.strictEqual(detectPayPeriod(days), true);
});
test('any day > 15 → second half', () => {
  const days = [makeDay(0, 0, 16), makeDay(0, 1, 22)];
  assert.strictEqual(detectPayPeriod(days), false);
});
test('exactly day 15 → first half', () => {
  assert.strictEqual(detectPayPeriod([makeDay(0, 0, 15)]), true);
});
test('exactly day 16 → second half', () => {
  assert.strictEqual(detectPayPeriod([makeDay(0, 0, 16)]), false);
});

// ── distribute ───────────────────────────────────────────────────────────────
console.log('distribute');

test('10h across 3 days: first day gets extra hour', () => {
  const days = [makeDay(0, 0, 1), makeDay(0, 1, 2), makeDay(0, 2, 3)];
  const s = distribute(days, 600, 2400);
  assert.strictEqual(s[0].hours, 4, 'day 0');
  assert.strictEqual(s[1].hours, 3, 'day 1');
  assert.strictEqual(s[2].hours, 3, 'day 2');
  assert.strictEqual(s[0].minutes, 0);
  assert.strictEqual(s[2].minutes, 0);
  assert.strictEqual(totalMins(s), 600);
});

test('39h30m across 5 days: first 4 days get 8h, last gets 7h30m', () => {
  const days = Array.from({ length: 5 }, (_, i) => makeDay(0, i, i + 1));
  const s = distribute(days, 2370, 2400); // 39h30m = 2370 min
  // weekHours=39, hoursPerDay=7, extraHours=4 → days 0-3 get 8h
  assert.strictEqual(s[0].hours, 8, 'day 0');
  assert.strictEqual(s[1].hours, 8, 'day 1');
  assert.strictEqual(s[2].hours, 8, 'day 2');
  assert.strictEqual(s[3].hours, 8, 'day 3');
  assert.strictEqual(s[4].hours, 7, 'day 4 (last)');
  assert.strictEqual(s[4].minutes, 30, 'day 4 carries minutes');
  assert.strictEqual(s[0].minutes, 0, 'day 0 no minutes');
  assert.strictEqual(totalMins(s), 2370);
});

test('evenly divisible: every day same whole hours, no minutes', () => {
  const days = Array.from({ length: 5 }, (_, i) => makeDay(0, i, i + 1));
  const s = distribute(days, 2400, 2400); // 40h exact
  s.forEach((d, i) => {
    assert.strictEqual(d.hours, 8, `day ${i}`);
    assert.strictEqual(d.minutes, 0, `day ${i} minutes`);
  });
  assert.strictEqual(totalMins(s), 2400);
});

test('multi-week greedy: earlier weeks fill to cap first', () => {
  const days = [];
  for (let w = 0; w < 3; w++)
    for (let d = 0; d < 5; d++)
      days.push(makeDay(w, d, w * 7 + d + 1));
  const s = distribute(days, 7200, 2400); // 120h total, 40h cap
  for (let w = 0; w < 3; w++) {
    const wMins = s.filter(d => d.week === w).reduce((sum, d) => sum + d.hours * 60 + d.minutes, 0);
    assert.strictEqual(wMins, 2400, `week ${w} should be 40h`);
  }
  assert.strictEqual(totalMins(s), 7200);
});

test('cap constraint: last week gets remainder', () => {
  const days = [];
  for (let w = 0; w < 3; w++)
    for (let d = 0; d < 5; d++)
      days.push(makeDay(w, d, w * 7 + d + 1));
  const s = distribute(days, 5400, 2400); // 90h total, 40h cap → 40+40+10
  const byWeek = w => s.filter(d => d.week === w).reduce((sum, d) => sum + d.hours * 60 + d.minutes, 0);
  assert.strictEqual(byWeek(0), 2400, 'week 0 = 40h');
  assert.strictEqual(byWeek(1), 2400, 'week 1 = 40h');
  assert.strictEqual(byWeek(2), 600,  'week 2 = 10h');
  assert.strictEqual(totalMins(s), 5400);
});

test('single active day: gets all budget', () => {
  const s = distribute([makeDay(0, 0, 1)], 300, 600); // 5h budget
  assert.strictEqual(s[0].hours, 5);
  assert.strictEqual(s[0].minutes, 0);
  assert.strictEqual(totalMins(s), 300);
});

test('budget under 1h: last day gets only minutes', () => {
  const days = [makeDay(0, 0, 1), makeDay(0, 1, 2)];
  const s = distribute(days, 90, 2400); // 1h30m
  // weekHours=1, hoursPerDay=0, extraHours=1 → day 0 gets 1h, day 1 gets 0h + 30m
  assert.strictEqual(s[0].hours, 1);
  assert.strictEqual(s[0].minutes, 0);
  assert.strictEqual(s[1].hours, 0);
  assert.strictEqual(s[1].minutes, 30);
  assert.strictEqual(totalMins(s), 90);
});

console.log(`\n${passed} tests passed`);
