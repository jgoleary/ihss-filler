# Scheduling Algorithm Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the week-greedy scheduling algorithm with the IHSS-advisor-compliant even-day distribution across the full pay period, with February 28/29-day mode.

**Architecture:** Three new pure functions (`detectFebruary`, `isLeapYear`, `distributeNormal`) are added to `popup.js`. The existing `distribute` becomes a thin dispatcher. The calculate handler's budget-split formula and `distribute` call are updated. All tests in `tests/test-algorithm.js` are rewritten.

**Tech Stack:** Vanilla JS (no build step), Node.js for unit tests via `node tests/test-algorithm.js`.

---

## File Map

| File | Change |
|---|---|
| `ihss-extension/popup.js` | Add `detectFebruary`, `isLeapYear`, `distributeNormal`, `distributeFebruary`; replace old `distribute`; update calculate handler; update `module.exports` |
| `tests/test-algorithm.js` | Full rewrite: keep `detectPayPeriod` tests, add `detectFebruary`/`isLeapYear`/`distribute` (normal + February) |

---

### Task 1: Add detectFebruary and isLeapYear

**Files:**
- Modify: `ihss-extension/popup.js` (after `detectPayPeriod` function, ~line 20)
- Modify: `tests/test-algorithm.js` (require line + new test sections)

- [ ] **Step 1: Update the require line in tests/test-algorithm.js**

Replace:
```js
const { detectPayPeriod, distribute } = require('../ihss-extension/popup.js');
```
With:
```js
const { detectPayPeriod, detectFebruary, distribute, isLeapYear } = require('../ihss-extension/popup.js');
```

- [ ] **Step 2: Add detectFebruary and isLeapYear test sections to tests/test-algorithm.js**

Add this block immediately after the last `detectPayPeriod` test (before the `distribute` tests):

```js
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
```

- [ ] **Step 3: Run tests to confirm all new tests FAIL**

```bash
node tests/test-algorithm.js
```

Expected: new `detectFebruary` and `isLeapYear` tests fail with "detectFebruary is not a function" or similar. Old distribute tests still pass (they're unchanged at this point).

- [ ] **Step 4: Add detectFebruary and isLeapYear to popup.js**

Add these two functions immediately after the closing `}` of `detectPayPeriod` (around line 20):

```js
function detectFebruary(activeDays) {
  if (activeDays.length === 0) return false;
  const m = activeDays[0].dateText.match(/Hours for (\w+)/i);
  return m ? m[1].toLowerCase().startsWith('feb') : false;
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
```

- [ ] **Step 5: Update module.exports in popup.js**

Replace:
```js
if (typeof module !== 'undefined') {
  module.exports = { detectPayPeriod, distribute };
}
```
With:
```js
if (typeof module !== 'undefined') {
  module.exports = { detectPayPeriod, detectFebruary, distribute, isLeapYear };
}
```

- [ ] **Step 6: Run tests and confirm all pass**

```bash
node tests/test-algorithm.js
```

Expected output includes:
```
detectFebruary
  ✓ returns true when first day is in February
  ✓ returns false when month is not February
  ✓ returns false for empty array
isLeapYear
  ✓ 2024 is a leap year
  ✓ 2026 is not a leap year
  ✓ 2000 is a leap year (century divisible by 400)
  ✓ 1900 is not a leap year (century not divisible by 400)
```

All existing distribute tests still pass.

- [ ] **Step 7: Commit**

```bash
git add ihss-extension/popup.js tests/test-algorithm.js
git commit -m "feat: add detectFebruary and isLeapYear helpers"
```

---

### Task 2: Rewrite distribute for normal months

**Files:**
- Modify: `ihss-extension/popup.js` (replace old `distribute` function, ~lines 37–76)
- Modify: `tests/test-algorithm.js` (replace all old `distribute` tests with new ones)

- [ ] **Step 1: Replace the old distribute test section in tests/test-algorithm.js**

Delete everything from `// ── distribute ─────` through the last old `distribute` test. Replace with:

```js
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
```

- [ ] **Step 2: Run tests to confirm the new distribute tests FAIL**

```bash
node tests/test-algorithm.js
```

Expected: all new `distribute (normal months)` tests fail. `detectPayPeriod`, `detectFebruary`, `isLeapYear` tests still pass.

- [ ] **Step 3: Replace the old distribute function in popup.js**

Delete the entire old `distribute` function (lines ~37–76) and replace with:

```js
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
  throw new Error('distributeFebruary not yet implemented');
}

function distribute(activeDays, periodBudget, maxMonthlyMins) {
  if (detectFebruary(activeDays)) return distributeFebruary(activeDays, maxMonthlyMins);
  return distributeNormal(activeDays, periodBudget);
}
```

- [ ] **Step 4: Run tests to confirm normal-month tests now pass**

```bash
node tests/test-algorithm.js
```

Expected: all `distribute (normal months)` tests pass. February tests are not present yet.

- [ ] **Step 5: Commit**

```bash
git add ihss-extension/popup.js tests/test-algorithm.js
git commit -m "feat: rewrite distribute for normal months with even-day distribution"
```

---

### Task 3: Implement February distribution

**Files:**
- Modify: `ihss-extension/popup.js` (replace `distributeFebruary` stub)
- Modify: `tests/test-algorithm.js` (add February test section at the end)

- [ ] **Step 1: Add February test section to tests/test-algorithm.js**

Append this block after the last normal-month distribute test:

```js
// ── distribute — February ─────────────────────────────────────────────────────
console.log('distribute (February)');

test('February 2026: 15013 min / 28 days → 5 days at 537min (8:57), 23 days at 536min (8:56)', () => {
  // dailyBase = floor(15013/28) = 536, higherCount = 15013 % 28 = 5
  // Round-robin across 4 calendar weeks (w0=Feb1-7, w1=Feb8-14, w2=Feb15-21, w3=Feb22-28):
  // pass0: w0d0(Feb1), w1d0(Feb8), w2d0(Feb15), w3d0(Feb22) → 4 assigned
  // pass1: w0d1(Feb2)                                         → 5 assigned
  // Higher days: Feb 1,2,8,15,22
  const firstHalf = [];
  for (let calDay = 1; calDay <= 15; calDay++)
    firstHalf.push(makeDay(Math.floor((calDay - 1) / 7), (calDay - 1) % 7, calDay, 'Feb', 2026));
  const secondHalf = [];
  for (let calDay = 16; calDay <= 28; calDay++)
    secondHalf.push(makeDay(Math.floor((calDay - 1) / 7), (calDay - 1) % 7, calDay, 'Feb', 2026));

  const s1 = distribute(firstHalf,  0, 15013);
  const s2 = distribute(secondHalf, 0, 15013);
  const all = [...s1, ...s2];

  assert.strictEqual(all.length, 28, '28 days total');
  const higher = all.filter(d => d.hours * 60 + d.minutes === 537);
  const base   = all.filter(d => d.hours * 60 + d.minutes === 536);
  assert.strictEqual(higher.length, 5,  '5 days at 537 minutes');
  assert.strictEqual(base.length,   23, '23 days at 536 minutes');
  assert.strictEqual(totalMins(s1) + totalMins(s2), 15013, 'both halves sum to monthly total');
});

test('February: every day has hours >= 0 and minutes in [0, 59]', () => {
  const firstHalf = [];
  for (let calDay = 1; calDay <= 15; calDay++)
    firstHalf.push(makeDay(Math.floor((calDay - 1) / 7), (calDay - 1) % 7, calDay, 'Feb', 2026));
  const s = distribute(firstHalf, 0, 15013);
  s.forEach(d => {
    assert.ok(d.hours   >= 0,  `hours non-negative for calDay ~${d.dayIdx + 1}`);
    assert.ok(d.minutes >= 0 && d.minutes < 60, `minutes in [0,59] for calDay ~${d.dayIdx + 1}`);
  });
});

test('February leap year 2028: 29-day distribution sums to monthly total', () => {
  // isLeapYear(2028) = true → febDays = 29
  const firstHalf = [];
  for (let calDay = 1; calDay <= 15; calDay++)
    firstHalf.push(makeDay(Math.floor((calDay - 1) / 7), (calDay - 1) % 7, calDay, 'Feb', 2028));
  const secondHalf = [];
  for (let calDay = 16; calDay <= 29; calDay++)  // 29 days in leap Feb
    secondHalf.push(makeDay(Math.floor((calDay - 1) / 7), (calDay - 1) % 7, calDay, 'Feb', 2028));

  const s1 = distribute(firstHalf,  0, 15000);
  const s2 = distribute(secondHalf, 0, 15000);

  assert.strictEqual(s1.length + s2.length, 29, '29 days covered');
  assert.strictEqual(totalMins(s1) + totalMins(s2), 15000, 'both halves sum to monthly total');
  [...s1, ...s2].forEach(d => {
    assert.ok(d.minutes >= 0 && d.minutes < 60, `minutes in range for calDay ~${d.dayIdx + 1}`);
  });
});
```

- [ ] **Step 2: Run tests to confirm February tests FAIL**

```bash
node tests/test-algorithm.js
```

Expected: the new `distribute (February)` tests fail with "distributeFebruary not yet implemented". All other tests pass.

- [ ] **Step 3: Replace the distributeFebruary stub in popup.js with the real implementation**

Replace:
```js
function distributeFebruary(activeDays, maxMonthlyMins) {
  throw new Error('distributeFebruary not yet implemented');
}
```
With:
```js
function distributeFebruary(activeDays, maxMonthlyMins) {
  const yearMatch = activeDays[0].dateText.match(/(\d{4})/);
  const year      = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();
  const febDays   = isLeapYear(year) ? 29 : 28;
  const dailyBase  = Math.floor(maxMonthlyMins / febDays);
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
```

- [ ] **Step 4: Run tests to confirm all tests pass**

```bash
node tests/test-algorithm.js
```

Expected output:
```
detectPayPeriod
  ✓ ...  (existing tests)
detectFebruary
  ✓ returns true when first day is in February
  ✓ returns false when month is not February
  ✓ returns false for empty array
isLeapYear
  ✓ 2024 is a leap year
  ✓ 2026 is not a leap year
  ✓ 2000 is a leap year (century divisible by 400)
  ✓ 1900 is not a leap year (century not divisible by 400)
distribute (normal months)
  ✓ 125h/15 days: 10 days at 8h and 5 days at 9h, extra hours spread across weeks
  ✓ leftover minutes go to the first active day (lowest week, lowest dayIdx)
  ✓ first half (whole hours): no day has minutes
  ✓ total minutes scheduled exactly equals period budget
  ✓ single active day: gets all budget
  ✓ days delivered out of order: sorted correctly, first sorted day gets leftover minutes
  ✓ budget split: 250h13m → first half 125h, second half 125h13m, both sum to total
distribute (February)
  ✓ February 2026: 15013 min / 28 days → 5 days at 537min (8:57), 23 days at 536min (8:56)
  ✓ February: every day has hours >= 0 and minutes in [0, 59]
  ✓ February leap year 2028: 29-day distribution sums to monthly total

N tests passed
```

- [ ] **Step 5: Commit**

```bash
git add ihss-extension/popup.js tests/test-algorithm.js
git commit -m "feat: implement distributeFebruary with leap year support"
```

---

### Task 4: Update the calculate handler in popup.js

**Files:**
- Modify: `ihss-extension/popup.js` (the `btn-calculate` click handler, ~lines 171–220)

This task has no automated tests — it updates UI-only code. After editing, reload the extension and verify manually.

- [ ] **Step 1: Replace the budget-split and distribute call in the calculate handler**

Find the block starting with `const isFirstHalf = detectPayPeriod(activeDays);` and ending with `currentSchedule = distribute(activeDays, periodBudget, maxWeekMins);`. Replace it with:

```js
const isFirstHalf   = detectPayPeriod(activeDays);
const totalHours    = Math.floor(maxMonthlyMins / 60);
const firstHalfMins = Math.floor(totalHours / 2) * 60;
const periodBudget  = isFirstHalf ? firstHalfMins : maxMonthlyMins - firstHalfMins;
const maxWeekMins   = Math.ceil(maxMonthlyMins / 4);

currentSchedule = distribute(activeDays, periodBudget, maxMonthlyMins);
```

- [ ] **Step 2: Replace the cap warning block**

Find the existing cap warning block (checks `maxPossible < periodBudget`) and replace it with the per-week post-hoc check:

```js
const weekTotals = new Map();
for (const entry of currentSchedule) {
  weekTotals.set(entry.week, (weekTotals.get(entry.week) ?? 0) + entry.hours * 60 + entry.minutes);
}
const overWeeks = [...weekTotals.entries()]
  .filter(([, mins]) => mins > maxWeekMins)
  .map(([w]) => w + 1);

const capWarning = document.getElementById('preview-cap-warning');
if (overWeeks.length > 0) {
  capWarning.textContent =
    `Warning: week(s) ${overWeeks.join(', ')} exceed the ${fmtMins(maxWeekMins)}/week cap.`;
  capWarning.style.display = 'block';
} else {
  capWarning.style.display = 'none';
}
```

Also delete the now-unused variables `weekCount` and `maxPossible` if they remain in the handler.

- [ ] **Step 3: Run tests one more time to confirm nothing broke**

```bash
node tests/test-algorithm.js
```

Expected: all tests pass (calculate handler changes don't affect exported functions).

- [ ] **Step 4: Reload the extension and do a smoke test**

1. In Chrome, go to `chrome://extensions` → click the reload icon on the IHSS extension card.
2. Navigate to `https://etimesheets.ihss.ca.gov/provider-ts-details`, select a pay period half.
3. Open the popup. Enter `250` hours `13` minutes. Click "Calculate schedule."
4. Verify: first half shows 8h on 10 days + 9h on 5 days, all with 0 minutes.
5. Switch to the second half. Click "Calculate schedule." Verify: 8h/9h distribution, first active day has 13 minutes.

- [ ] **Step 5: Commit**

```bash
git add ihss-extension/popup.js
git commit -m "feat: update calculate handler for new budget split and distribute signature"
```
