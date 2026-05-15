# IHSS Timesheet Filler — Extension Design

**Date:** 2026-04-13

## Overview

A Chrome/Edge browser extension (Manifest V3) that auto-fills the IHSS provider timesheet at `https://etimesheets.ihss.ca.gov/provider-ts-details`. The user opens the popup, sets their weekly hour cap, previews the generated schedule, then fills and saves all workweeks in one click.

---

## Architecture

### Two-script model

- **`content.js`** — injected into the IHSS page. Reads DOM state and fills inputs. Contains no scheduling logic.
- **`popup.js`** — owns all business logic: scheduling algorithm, UI state machine, persisted settings. Communicates with `content.js` via `chrome.tabs.sendMessage` / `chrome.runtime.onMessage`.
- **`popup.html`** — extension toolbar popup UI with five states (see UI States below).
- **`manifest.json`** — MV3 manifest.

### File structure

```
ihss-extension/
├── manifest.json
├── content.js
├── popup.html
├── popup.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### Angular SPA input filling

Setting `.value` directly does not trigger Angular's reactive forms. Use the native setter + event dispatch pattern:

```js
const nativeSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype, 'value'
).set;
nativeSetter.call(el, value);
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
```

### Message protocol (popup → content)

| `action` | Payload | Response |
|---|---|---|
| `getPageInfo` | — | `{ available: {hours, minutes}, activeDays: [...], weekCount, periodLabel }` |
| `fillSchedule` | `{ schedule: [...] }` | `{ filled: number }` |
| `saveWorkweek` | `{ weekIndex: number }` | `{ ok: boolean }` |

~400ms delay between `saveWorkweek` calls to avoid race conditions with Angular form validation.

### Permissions

```json
"permissions": ["activeTab", "scripting", "storage"],
"host_permissions": ["https://etimesheets.ihss.ca.gov/*"]
```

`chrome.storage.local` persists `maxPerWeek` across popup sessions.

---

## Scheduling Algorithm

### Step 1 — Read from page

```
totalMonthlyMinutes = availableHours * 60 + availableMinutes
activeDays = parsed from DOM, grouped by week
isFirstHalf = max(day numbers across all active days) <= 15
```

Pay period is auto-detected from the `hours-label-a11y-{W}-{D}` elements, which contain calendar date text (e.g. "Hours for Apr 1, 2026"). No manual toggle required.

### Step 2 — Determine period budget

The available hours displayed on the page represent the full monthly authorization.

```
periodBudget = isFirstHalf
  ? Math.ceil(totalMonthlyMinutes / 2)   // first half gets the odd minute if any
  : totalMonthlyMinutes                   // second half uses whatever remains
```

### Step 3 — Validate cap feasibility

```
maxPerWeekMinutes = maxPerWeek * 60
maxPossible = weeks.length * maxPerWeekMinutes

if maxPossible < periodBudget:
  warn user — do not proceed silently
```

### Step 4 — Distribute across weeks (greedy), then within each week

```
remaining = periodBudget

for each week (ascending order):
  days       = active days in this week
  weekBudget = min(remaining, maxPerWeekMinutes)
  remaining -= weekBudget

  weekHours   = floor(weekBudget / 60)
  weekMins    = weekBudget % 60
  hoursPerDay = floor(weekHours / days.length)
  extraHours  = weekHours % days.length     // distributed to first N days

  for i in [0 .. days.length - 1]:
    hours   = hoursPerDay + (i < extraHours ? 1 : 0)
    minutes = (i === days.length - 1) ? weekMins : 0
```

### Distribution properties

- **All available hours claimed** across the period (subject to cap feasibility)
- **No week exceeds `maxPerWeek`**
- **Whole hours on every day** except the last active day of each week, which carries any minute remainder
- **Extra whole hours go to earlier days** within a week (e.g. 10h across 3 days → 4h, 3h, 3h)
- **Earlier weeks fill to cap first**; the final week takes whatever remains

### Example

Monthly total: **155h31m** (9331 min) | Weekly cap: **40h** | First half | 2 weeks, 5 active days each

- `periodBudget = ceil(9331 / 2) = 4666 min = 77h46m`
- Week 1: `weekBudget = min(4666, 2400) = 2400 min = 40h` → **8h, 8h, 8h, 8h, 8h**
- Week 2: `weekBudget = 2266 min = 37h46m`
  - `weekHours=37, weekMins=46, hoursPerDay=7, extraHours=2`
  - → **8h, 8h, 7h, 7h, 7h46m**
- Remaining: 0 ✓

---

## UI States

| State | Condition | Content |
|---|---|---|
| **Wrong page** | Not on etimesheets.ihss.ca.gov | "Navigate to IHSS timesheet page" |
| **Not ready** | Content script didn't respond | "Page still loading — reload and try again" |
| **Ready** | Page loaded | Detected pay period label (e.g. "Apr 1–15"), period budget (e.g. "Planning 77h46m of 155h31m"), weekly cap input (pre-filled from storage), "Calculate schedule" button |
| **Preview** | Schedule calculated | Week × day grid showing h:mm per cell, cap warning if applicable, "Fill & save all workweeks" button |
| **Done** | All weeks saved | Confirmation, prompt to manually click Submit Timesheet |

---

## Key Constraints

- **No auto-submit**: The extension deliberately does not click the final "Submit Timesheet" button. The user reviews and submits manually.
- **Pay period halves**: The page shows one half at a time. The user selects which half via the page's own dropdown before opening the popup. The extension reads whatever is currently rendered and auto-detects the half.
- **Angular SPA**: The popup must wait for the page to fully render. If content script doesn't respond, tell the user to wait and retry.
- **No build step**: Plain HTML/CSS/JS. Load unpacked in Chrome developer mode.
