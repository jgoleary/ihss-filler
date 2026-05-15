# Scheduling Algorithm Redesign

**Date:** 2026-05-15  
**Scope:** `ihss-extension/popup.js` — `distribute()`, `detectPayPeriod()`, and the calculate handler  
**Tests:** `tests/test-algorithm.js` — full rewrite

---

## Problem

The current algorithm fills weeks greedily up to a per-week cap and defers sub-hour minutes to the last day of the period. This violates the IHSS advisor guidance, which mandates:

1. Divide total monthly hours evenly in half — whole hours only for the first half, all minutes go to the second half.
2. Within each period, distribute hours as evenly as possible across every calendar day in that period, not week-by-week.
3. Spread any "extra-hour" days (the days that get one more hour due to rounding) across weeks, not clustered in a single week.
4. Exactly one day in the whole month carries any sub-hour minute remainder — that day is the first active day of the second half.
5. February is a special case: distribute total monthly minutes by total February days (28 or 29 for leap year) to get as close to equal minutes per day as possible.

---

## New Algorithm

### Budget Split (non-February)

```
totalHours      = Math.floor(maxMonthlyMins / 60)
firstHalfMins   = Math.floor(totalHours / 2) * 60   // whole hours only
secondHalfMins  = maxMonthlyMins - firstHalfMins    // carries the leftover minutes
```

Example — 250h 13m = 15013 min:
- `totalHours = 250`
- `firstHalfMins = 125 * 60 = 7500` (125h 00m)
- `secondHalfMins = 15013 - 7500 = 7513` (125h 13m)

This replaces the old `Math.ceil/floor(maxMonthlyMins / 2)` split in the calculate handler.

### Within-Period Distribution (non-February)

```
periodDays   = activeDays.length         // 15 for first half; 15 or 16 for second half
periodHours  = Math.floor(periodBudget / 60)
leftoverMins = periodBudget % 60         // always 0 for first half; ≥0 for second half

baseHours  = Math.floor(periodHours / periodDays)
extraCount = periodHours % periodDays    // number of days that get baseHours+1
```

**Extra-hour day placement (round-robin across weeks):**
- Group `activeDays` by `week` key, sort each group by `dayIdx` ascending.
- Iterate through weeks in order, picking one day per week until `extraCount` extras are assigned:
  - Pass 1: week0.day[0], week1.day[0], week2.day[0], ...
  - Pass 2: week0.day[1], week1.day[1], ...
  - Continue until `extraCount` extras are assigned.
- Extra-hour days get `baseHours + 1` hours; all others get `baseHours` hours.

**Minutes:**
- All days get `0` minutes except the first active day of the period, which gets `leftoverMins`.
- For the first half, `leftoverMins` is always `0`, so no day has minutes.
- For the second half, the first active day (lowest `week`, lowest `dayIdx` within that week) gets `leftoverMins`.

**Example — 125h across 15 days (first half):**
- `baseHours = 8`, `extraCount = 5`
- 3 weeks with [5, 5, 5] days: weeks 0,1,2 each get their day[0] as extra, then weeks 0,1 get their day[1] as extra → 2 extras in weeks 0 and 1, 1 in week 2.
- All days have 0 minutes.

**Example — 125h 13m across 15 days (second half):**
- `periodHours = 125`, `leftoverMins = 13`
- `baseHours = 8`, `extraCount = 5` — same distribution as above
- First active day of the period gets 13 minutes; all others get 0.

### February Detection and Distribution

**Detection:** Parse the month name from any `dateText` (e.g., `"Hours for Feb 3, 2026"`). If the month is `"Feb"`, use February mode.

**Leap year:** Parse the year from `dateText`. A year is a leap year if divisible by 4, except centuries must be divisible by 400.

```
febDays     = isLeapYear(year) ? 29 : 28
dailyBase   = Math.floor(maxMonthlyMins / febDays)
higherCount = maxMonthlyMins % febDays    // days that get dailyBase+1 minutes
```

**Full-month slot assignment:**
1. Build a 28- (or 29-) element slot array: `higherCount` slots get `dailyBase + 1`, the rest get `dailyBase`.
2. Distribute the `higherCount` "higher" slots across weeks using the same round-robin rule as non-February extra hours.
3. Slot `i` corresponds to calendar day `i + 1` in February (slot 0 = Feb 1).

**Per-half filtering:**
- Parse each active day's calendar day number from `dateText`.
- Map each active day to its February slot index (`calDay - 1`) to get its assigned minutes.
- Convert minutes to `hours` + `minutes` (e.g., 537 min → 8h 57m, 536 min → 8h 56m).

This ensures both halves together sum to exactly `maxMonthlyMins`.

### Weekly Cap Warning (unchanged concept)

After computing the schedule, sum total minutes per week. If any week exceeds `Math.ceil(maxMonthlyMins / 4)` minutes, display the existing cap warning banner. The `maxWeekMinutes` value is no longer a parameter to `distribute` — it is only used for this post-hoc check.

---

## Function Signatures (new)

```js
// Returns true if active days are all in the first half (calendar day ≤ 15)
function detectPayPeriod(activeDays): boolean

// Returns true if active days fall in February
function detectFebruary(activeDays): boolean

// Core scheduler — dispatches to February or normal path.
// Normal path uses periodBudget; February path uses maxMonthlyMins directly
// (it must compute the full 28-day allocation, then slice to the current half).
// maxWeekMinutes is no longer a parameter — the cap is checked after the fact.
function distribute(activeDays, periodBudget, maxMonthlyMins): ScheduleEntry[]

// Internal helpers (not exported)
function isLeapYear(year): boolean
function distributeNormal(activeDays, periodBudget): ScheduleEntry[]
function distributeFebruary(activeDays, maxMonthlyMins): ScheduleEntry[]
```

---

## Calculate Handler Changes (popup.js)

```js
const totalHours      = Math.floor(maxMonthlyMins / 60);
const isFirstHalf     = detectPayPeriod(activeDays);
const firstHalfMins   = Math.floor(totalHours / 2) * 60;
const periodBudget    = isFirstHalf ? firstHalfMins : maxMonthlyMins - firstHalfMins;

// cap warning check after distribute()
const maxWeekMins = Math.ceil(maxMonthlyMins / 4);
// ... check each week's total in the returned schedule
```

---

## Test Coverage (rewrite)

| Test | What it verifies |
|---|---|
| `detectPayPeriod` — existing cases | Unchanged behavior, keep |
| `detectFebruary` — Feb month | Returns true for Feb dates |
| `detectFebruary` — non-Feb month | Returns false |
| Budget split: 250h13m | firstHalf=7500, secondHalf=7513 |
| Budget split: even hours | firstHalf=secondHalf, no minutes |
| Budget split: odd hours | ceil/floor difference captured |
| Normal: 125h/15 days | 10×8h, 5×9h, no minutes |
| Normal: leftoverMins on first day | 2nd-half first day has minutes |
| Normal: extra hours spread across weeks | No week has disproportionate extras |
| Normal: total invariant | sum(schedule) = periodBudget |
| Feb: 15013min/28 days | 5×537m, 23×536m |
| Feb: first-half slice | 15 days, correct minutes |
| Feb: second-half slice | 13 days, correct minutes |
| Feb: both halves sum to monthly total | invariant holds |
| Feb: leap year | 29-day calculation |

---

## Out of Scope

- Per-day hour overrides in the preview table (existing future improvement)
- Previously-claimed hours subtraction (existing future improvement)
- Firefox compatibility
