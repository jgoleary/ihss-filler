# IHSS Timesheet Filler — Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome MV3 extension that reads available hours from the IHSS timesheet, computes an optimal schedule across workweeks respecting a weekly cap, and fills + saves the form in one click.

**Architecture:** Two-script model — `content.js` handles all DOM interaction on the IHSS page; `popup.js` owns scheduling logic and UI state. They communicate via `chrome.tabs.sendMessage`. Pure scheduling functions in `popup.js` are exported with a `module.exports` guard so they can be unit-tested with plain Node.js.

**Tech Stack:** Vanilla JS (ES2020), Chrome Extension Manifest V3, Node.js (unit tests only), Python/Pillow (icon generation)

---

## File Map

| File | Responsibility |
|---|---|
| `ihss-extension/manifest.json` | MV3 extension manifest |
| `ihss-extension/content.js` | DOM reading, input filling, workweek saving |
| `ihss-extension/popup.html` | Extension popup UI — five visible states |
| `ihss-extension/popup.js` | Scheduling algorithm + UI state machine + storage |
| `ihss-extension/icons/icon{16,48,128}.png` | Extension icons |
| `tests/test-algorithm.js` | Unit tests for pure scheduling functions |
| `scripts/gen-icons.py` | Icon generation script |

---

### Task 1: Project Scaffold

**Files:**
- Create: `ihss-extension/manifest.json`
- Create: `ihss-extension/content.js` (stub)
- Create: `ihss-extension/popup.html` (stub)
- Create: `ihss-extension/popup.js` (stub)
- Create: `scripts/gen-icons.py`
- Create: `tests/test-algorithm.js` (empty)

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p ihss-extension/icons tests scripts
```

- [ ] **Step 2: Create `ihss-extension/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "IHSS Timesheet Filler",
  "version": "1.0.0",
  "description": "Auto-fills IHSS provider timesheets",
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": ["https://etimesheets.ihss.ca.gov/*"],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "content_scripts": [
    {
      "matches": ["https://etimesheets.ihss.ca.gov/*"],
      "js": ["content.js"]
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

- [ ] **Step 3: Create `scripts/gen-icons.py` and run it**

```python
# scripts/gen-icons.py
# Run with: python3 scripts/gen-icons.py
# Requires: pip3 install Pillow

from PIL import Image, ImageDraw, ImageFont
import os

def make_icon(size):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    r = max(2, size // 6)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=(37, 99, 235))
    font_size = int(size * 0.6)
    try:
        font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', font_size)
    except Exception:
        font = ImageFont.load_default()
    bbox = draw.textbbox((0, 0), 'H', font=font)
    x = (size - (bbox[2] - bbox[0])) // 2 - bbox[0]
    y = (size - (bbox[3] - bbox[1])) // 2 - bbox[1]
    draw.text((x, y), 'H', fill=(255, 255, 255), font=font)
    return img

os.makedirs('ihss-extension/icons', exist_ok=True)
for size in [16, 48, 128]:
    make_icon(size).save(f'ihss-extension/icons/icon{size}.png')
    print(f'Created icon{size}.png')
```

```bash
pip3 install Pillow
python3 scripts/gen-icons.py
```

Expected output:
```
Created icon16.png
Created icon48.png
Created icon128.png
```

- [ ] **Step 4: Create stub files**

`ihss-extension/content.js`:
```js
// Content script — injected into IHSS timesheet page
// Handles all DOM interaction. No scheduling logic.

chrome.runtime.onMessage.addListener((_msg, _sender, sendResponse) => {
  sendResponse(null);
  return true;
});
```

`ihss-extension/popup.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>IHSS Filler</title></head>
<body>
  <p>Loading…</p>
  <script src="popup.js"></script>
</body>
</html>
```

`ihss-extension/popup.js`:
```js
// Popup script — scheduling algorithm + UI state machine
```

`tests/test-algorithm.js`:
```js
// Unit tests for pure scheduling functions
// Run with: node tests/test-algorithm.js
```

- [ ] **Step 5: Commit**

```bash
git init
git add ihss-extension/ tests/ scripts/
git commit -m "feat: scaffold project structure and manifest"
```

---

### Task 2: Scheduling Algorithm (TDD)

**Files:**
- Modify: `tests/test-algorithm.js`
- Modify: `ihss-extension/popup.js`

- [ ] **Step 1: Write the failing tests**

Replace `tests/test-algorithm.js`:

```js
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
```

- [ ] **Step 2: Run tests — expect failure**

```bash
node tests/test-algorithm.js
```

Expected: `TypeError: computePeriodBudget is not a function` — nothing is exported yet.

- [ ] **Step 3: Implement the scheduling functions in `ihss-extension/popup.js`**

```js
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
```

- [ ] **Step 4: Run tests — expect all pass**

```bash
node tests/test-algorithm.js
```

Expected output:
```
computePeriodBudget
  ✓ first half, odd total: uses ceil
  ✓ first half, even total: no rounding needed
  ✓ second half: uses full total
  ✓ second half, odd total: no division
detectPayPeriod
  ✓ all days ≤ 15 → first half
  ✓ any day > 15 → second half
  ✓ exactly day 15 → first half
  ✓ exactly day 16 → second half
distribute
  ✓ 10h across 3 days: first day gets extra hour
  ✓ 39h30m across 5 days: first 4 days get 8h, last gets 7h30m
  ✓ evenly divisible: every day same whole hours, no minutes
  ✓ multi-week greedy: earlier weeks fill to cap first
  ✓ cap constraint: last week gets remainder
  ✓ single active day: gets all budget
  ✓ budget under 1h: last day gets only minutes

15 tests passed
```

- [ ] **Step 5: Commit**

```bash
git add ihss-extension/popup.js tests/test-algorithm.js
git commit -m "feat: implement and test scheduling algorithm"
```

---

### Task 3: content.js — DOM Reading and Form Filling

**Files:**
- Modify: `ihss-extension/content.js`

No automated tests — requires the live IHSS Angular page. Manual verification in Step 2.

- [ ] **Step 1: Implement `ihss-extension/content.js`**

```js
// Content script — injected into IHSS timesheet page
// Reads DOM state and fills form inputs. No scheduling logic here.
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
    if (!el) return;
    nativeSetter.call(el, String(value));
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  let filled = 0;
  for (const entry of schedule) {
    setInput(entry.hoursId,   entry.hours);
    setInput(entry.minutesId, entry.minutes);
    filled++;
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
  if (msg.action === 'getPageInfo')   sendResponse(getPageInfo());
  if (msg.action === 'fillSchedule')  sendResponse(fillSchedule(msg.schedule));
  if (msg.action === 'saveWorkweek')  sendResponse(saveWorkweek(msg.weekIndex));
  return true; // keep message channel open for async responses
});
```

- [ ] **Step 2: Verify getPageInfo manually**

1. Open Chrome → `chrome://extensions` → Developer mode ON → Load unpacked → select `ihss-extension/`
2. Navigate to `https://etimesheets.ihss.ca.gov/provider-ts-details` and let it fully load
3. Open DevTools on the IHSS tab → Console
4. Temporarily add `console.log(getPageInfo())` at the very end of `content.js`, reload the extension, reload the IHSS tab, and check the console

Expected console output: an object like:
```js
{
  available: { hours: 283, minutes: 30 },
  activeDays: [ { week: 0, dayIdx: 0, dateText: '...', hoursId: 'hours-0-0', minutesId: 'minutes-0-0' }, … ],
  weekCount: 2,
  periodLabel: 'Apr 1 – Apr 15'
}
```

**If `available` is `null`:** the `#available-ts-hours` text format doesn't match. Inspect the element (`document.getElementById('available-ts-hours').textContent`) and update `parseAvailableHours()` to match the actual format, then retest.

**If `activeDays` is empty:** the `timesheet-active-payperiod-{W}-{D}` IDs don't exist as expected. Inspect the DOM and check the actual ID pattern, then update `collectActiveDays()`.

Remove the temporary `console.log` after verifying.

- [ ] **Step 3: Commit**

```bash
git add ihss-extension/content.js
git commit -m "feat: implement content script DOM reading and form filling"
```

---

### Task 4: popup.html — UI Markup

**Files:**
- Modify: `ihss-extension/popup.html`

- [ ] **Step 1: Write `ihss-extension/popup.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>IHSS Filler</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      font-size: 14px;
      width: 320px;
      padding: 16px;
      margin: 0;
      color: #1e293b;
    }
    h2 { margin: 0 0 12px; font-size: 16px; }
    p  { margin: 0 0 8px; }
    label { display: block; margin-bottom: 4px; font-weight: 500; }
    input[type="number"] {
      width: 80px;
      padding: 4px 8px;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      font-size: 14px;
    }
    button {
      display: block;
      width: 100%;
      margin-top: 10px;
      padding: 8px 16px;
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
    }
    button:hover    { background: #1d4ed8; }
    button:disabled { background: #94a3b8; cursor: not-allowed; }
    button.secondary { background: #64748b; }
    button.secondary:hover { background: #475569; }
    .warning { color: #b45309; background: #fef3c7; padding: 8px; border-radius: 4px; margin-top: 8px; }
    .success  { color: #166534; background: #dcfce7; padding: 8px; border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
    th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #e2e8f0; }
    th { background: #f8fafc; font-weight: 600; }
    #state-wrong-page,
    #state-not-ready,
    #state-ready,
    #state-preview,
    #state-done { display: none; }
  </style>
</head>
<body>

  <!-- State: wrong page -->
  <div id="state-wrong-page">
    <h2>IHSS Timesheet Filler</h2>
    <p>Navigate to the IHSS timesheet page to use this extension.</p>
    <p><strong>etimesheets.ihss.ca.gov/provider-ts-details</strong></p>
  </div>

  <!-- State: not ready (page still loading) -->
  <div id="state-not-ready">
    <h2>IHSS Timesheet Filler</h2>
    <p>The page is still loading. Wait a moment, reload the page, and try again.</p>
    <p><em>If the tab was open before the extension was installed, reload it once.</em></p>
  </div>

  <!-- State: ready -->
  <div id="state-ready">
    <h2>IHSS Timesheet Filler</h2>
    <p id="ready-period"></p>
    <p id="ready-available"></p>
    <p id="ready-days"></p>
    <label for="max-per-week">Weekly hour cap</label>
    <input type="number" id="max-per-week" min="1" max="168" value="40">
    <button id="btn-calculate">Calculate schedule</button>
  </div>

  <!-- State: preview -->
  <div id="state-preview">
    <h2>Scheduled Hours</h2>
    <p id="preview-summary"></p>
    <div id="preview-cap-warning" class="warning" style="display:none;"></div>
    <table>
      <thead>
        <tr><th>Date</th><th>Hours</th><th>Min</th></tr>
      </thead>
      <tbody id="preview-table-body"></tbody>
    </table>
    <button id="btn-fill">Fill form &amp; save workweeks</button>
    <button id="btn-back" class="secondary">Back</button>
  </div>

  <!-- State: done -->
  <div id="state-done">
    <h2>Done!</h2>
    <div class="success" id="done-message"></div>
    <p style="margin-top:12px;">
      Review the filled timesheet, then click <strong>Submit Timesheet</strong>
      on the page to finalize.
    </p>
  </div>

  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify blank popup renders**

Reload the extension, click the icon. You should see a small white popup window with no visible content (all states are hidden — `popup.js` controls which one is shown).

- [ ] **Step 3: Commit**

```bash
git add ihss-extension/popup.html
git commit -m "feat: add popup HTML with five UI states"
```

---

### Task 5: popup.js — State Machine and Wiring

**Files:**
- Modify: `ihss-extension/popup.js`

This task appends the browser UI code to `popup.js` after the `module.exports` guard from Task 2. The entire final file is shown below to avoid ambiguity.

- [ ] **Step 1: Replace `ihss-extension/popup.js` with the complete file**

```js
// Popup script — scheduling algorithm + UI state machine
'use strict';

// ── Pure scheduling functions (also exported for Node.js unit tests) ─────────

function computePeriodBudget(totalMinutes, isFirstHalf) {
  return isFirstHalf ? Math.ceil(totalMinutes / 2) : totalMinutes;
}

function detectPayPeriod(activeDays) {
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
```

- [ ] **Step 2: Confirm algorithm tests still pass**

```bash
node tests/test-algorithm.js
```

Expected: `15 tests passed`

- [ ] **Step 3: Commit**

```bash
git add ihss-extension/popup.js
git commit -m "feat: implement popup state machine and wiring"
```

---

### Task 6: End-to-End Manual Test

**Files:** None (manual verification only)

- [ ] **Step 1: Reload the extension**

`chrome://extensions` → find "IHSS Timesheet Filler" → click the circular reload icon.

- [ ] **Step 2: Wrong-page state**

Click the extension icon while on any non-IHSS tab (e.g. google.com).
Expected: "Navigate to the IHSS timesheet page" message.

- [ ] **Step 3: Not-ready state**

Navigate to `https://etimesheets.ihss.ca.gov/provider-ts-details`, click the icon during page load.
Expected: "The page is still loading" message. (Hard to time if the page loads fast — skip if needed.)

- [ ] **Step 4: Ready state**

Let the page fully load, select a pay period half using the page's own dropdown, then open the popup.
Expected:
- Pay period label (e.g. "Apr 1 – Apr 15 (1st half — planning half your monthly hours)")
- Monthly total and planned period budget (e.g. "Planning 77h46m of 155h31m")
- Active days count and week count
- Weekly cap input pre-filled with 40

If the available hours shows `0h 0m`, check the DevTools console on the IHSS tab for errors from `parseAvailableHours`. Inspect `document.getElementById('available-ts-hours').textContent` and update the parser.

- [ ] **Step 5: Preview state**

Set weekly cap, click "Calculate schedule".
Expected:
- One table row per active day
- All rows show whole-hour values in the Hours column except the last day of each week (which carries any minute remainder)
- First days of each week show the extra hour when hours don't divide evenly
- Total scheduled matches the expected period budget

- [ ] **Step 6: Fill and save**

Click "Fill form & save workweeks".
Expected:
- All hours/minutes inputs on the IHSS page populate with the scheduled values
- The page's save confirmation appears for each workweek (watch for visual feedback)
- Popup transitions to "Done!" showing filled-day and saved-week counts

- [ ] **Step 7: Final commit**

```bash
git add .
git commit -m "chore: end-to-end manual verification complete"
```
