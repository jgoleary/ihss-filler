// Content script — injected into IHSS timesheet page
// Handles all DOM interaction. No scheduling logic.

chrome.runtime.onMessage.addListener((_msg, _sender, sendResponse) => {
  sendResponse(null);
  return true;
});
