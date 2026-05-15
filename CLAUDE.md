# IHSS Timesheet Filler — Chrome Extension

## Project Overview

A Chrome/Edge browser extension (Manifest V3) that auto-fills the IHSS provider timesheet at `https://etimesheets.ihss.ca.gov/provider-ts-details`. The user clicks the extension icon, sets their monthly hour cap, previews the generated schedule, then fills all workweeks in one click and saves/submits manually.

## File Structure

```
ihss-extension/
├── manifest.json       # MV3 manifest
├── content.js          # Injected into IHSS page; reads DOM + fills inputs
├── popup.html          # Extension toolbar popup UI
├── popup.js            # Popup logic: scheduling algorithm + content script comms
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
scripts/
└── gen-icons.py        # Pillow script to regenerate icon PNGs
tests/
└── test-algorithm.js   # Node.js unit tests for distribute() and detectPayPeriod()
```

Run tests: `node tests/test-algorithm.js`

## Architecture

### Two-script model
- **`content.js`** runs in the IHSS page context. It reads DOM state and mutates inputs. It never does scheduling logic — that lives in the popup.
- **`popup.js`** owns all business logic (scheduling algorithm, UI state). It communicates with `content.js` via `chrome.tabs.sendMessage` / `chrome.runtime.onMessage`.

### Message protocol (popup → content)
| `action` | Payload | Response |
|---|---|---|
| `getPageInfo` | — | `{ status, activeDays, weekCount, periodLabel }` |
| `fillSchedule` | `{ schedule: [...] }` | `{ filled: number }` |
| `saveWorkweek` | `{ weekIndex: number }` | `{ ok: boolean }` |
| `expandAllWeeks` | — | `{ expanded: number }` |

`getPageInfo` returns `status: 'ok'` on success or `status: 'error'` with a `reason` string on failure.

### `activeDays` shape (from content.js)
```js
{
  week: number,       // 0-indexed workweek (matches DOM workweek panels)
  dayIdx: number,     // day index within the week
  dateText: string,   // e.g. "Hours for Apr 1, 2026"
  hoursId: string,    // e.g. "hours-0-3"
  minutesId: string   // e.g. "minutes-0-3"
}
```

### Schedule entry shape (popup → content for fill)
```js
{
  week: number,
  dayIdx: number,
  dateText: string,
  hoursId: string,
  minutesId: string,
  hours: number,      // whole hours to enter
  minutes: number     // remainder minutes (0–59)
}
```

## IHSS Page DOM — Key Selectors

The timesheet page is an **Angular SPA**. Inputs use Angular's reactive forms, so setting `.value` directly won't work — you must use the native input value setter and fire `input` + `change` events:

```js
const nativeSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype, 'value'
).set;
nativeSetter.call(el, value);
el.dispatchEvent(new Event('input', { bubbles: true }));
el.dispatchEvent(new Event('change', { bubbles: true }));
```

### Important element IDs
| Element | ID pattern |
|---|---|
| Hours input for week W, day D | `hours-{W}-{D}` |
| Minutes input for week W, day D | `minutes-{W}-{D}` |
| Accessible label for hours | `hours-label-a11y-{W}-{D}` |
| Active (in-period) day container | `timesheet-active-payperiod-{W}-{D}` |
| Out-of-period day container | `timesheet-out-of-payperiod-{W}-{D}` |
| Save button for workweek W | `save-timesheet-button-{W}` |
| Pay period dropdown | `payPerdiodSelect` |

Days marked `timesheet-out-of-payperiod-*` have no inputs — skip them.

The `hours-label-a11y-{W}-{D}` element contains text like `" Hours for Apr 1, 2026 "` — use this to determine the calendar date for each slot.

## Scheduling Algorithm

Located in `popup.js`. Two exported functions: `detectPayPeriod()` and `distribute()`.

### `detectPayPeriod(activeDays)`
Infers whether the currently-rendered period is the first half (days 1–15) or second half (days 16–end) by checking the max calendar day number in the active days' date labels. Returns `true` for first half.

### `distribute(activeDays, periodBudget, maxWeekMinutes)`

```
for each workweek (in order):
  weekBudget  = min(remaining, maxWeekMinutes)
  remaining  -= weekBudget

  weekHours   = floor(weekBudget / 60)
  deferredMins += weekBudget % 60      // collect sub-hour minutes across all weeks

  hoursPerDay = floor(weekHours / numDaysInWeek)
  extraHours  = weekHours % numDaysInWeek
  first extraHours days get: hoursPerDay + 1
  remaining days get: hoursPerDay
  (all days get 0 minutes — minutes are deferred)

last active day of the entire period:
  hours   += floor(deferredMins / 60)
  minutes  = deferredMins % 60
```

**Goals (in priority order):**
1. All period budget is claimed
2. No week exceeds the per-week cap
3. Whole hours preferred — all sub-hour minutes land on the last active day of the period
4. Within a week, extra hours go to the first days (not the last)

### How `periodBudget` and `maxWeekMinutes` are derived in the popup
```js
const isFirstHalf   = detectPayPeriod(activeDays);
const periodBudget  = isFirstHalf
  ? Math.ceil(maxMonthlyMins / 2)
  : Math.floor(maxMonthlyMins / 2);
const maxWeekMins   = Math.ceil(maxMonthlyMins / 4);
```

This ensures both halves always sum to exactly `maxMonthlyMins`.

If the available weeks × per-week cap < `periodBudget`, a warning is shown and unschedulable minutes are noted.

## Permissions

```json
"permissions": ["activeTab", "scripting", "storage"],
"host_permissions": ["https://etimesheets.ihss.ca.gov/*"]
```

`chrome.storage.local` is used to persist `maxMonthlyMins` (total monthly minutes as integer) across popup sessions. Default: `9600` (160 hours).

## UI States (popup.html / popup.js)

1. **Wrong page** — not on etimesheets.ihss.ca.gov → show "navigate to IHSS page" message
2. **Page not ready** — content script returned an error or didn't respond → show reason, prompt reload
3. **Ready** — shows pay period label, active day count, monthly cap inputs (hours + minutes), "Calculate schedule" button
4. **Preview** — shows schedule table with date/hours/minutes columns, optional cap-exceeded warning, "Fill form" button and "Back" button
5. **Done** — shows confirmation message; user must manually save each workweek and click Submit Timesheet on the page

The "Fill form" button sends `fillSchedule` then `expandAllWeeks` to the content script. It does **not** call `saveWorkweek` — saving is left to the user.

## Known Constraints / Gotchas

- **Angular SPA**: The popup must wait for the page to fully render before `getPageInfo` will return valid data. If content script doesn't respond, tell user to wait and retry.
- **Pay period halves**: The timesheet shows one half at a time (1st–15th or 16th–end). The user selects which half via the page's own dropdown before opening the popup. The extension auto-detects which half is rendered via `detectPayPeriod()`.
- **No auto-save**: The extension fills inputs but does NOT click save buttons or submit the timesheet. The user reviews, saves each workweek, and submits manually.
- **Icons**: 16×16, 48×48, 128×128 PNG. Currently simple blue rounded-rect with white "H". Regenerate with `python scripts/gen-icons.py`.

## Development & Loading

1. Make changes to source files
2. In Chrome: `chrome://extensions` → Developer mode ON → Load unpacked → select `ihss-extension/` folder
3. After any JS/HTML change: click the reload icon on the extension card (or toggle off/on)
4. After `manifest.json` changes: must reload the extension
5. Run unit tests: `node tests/test-algorithm.js`

No build step — plain HTML/CSS/JS, no bundler.

## Future Improvements (not yet implemented)

- Allow per-day hour overrides in the preview table before filling
- Support for "previously claimed hours" — read existing workweek totals and subtract from budget
- Firefox compatibility (would need minor messaging API adjustments)
