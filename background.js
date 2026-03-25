/**
 * YT Analytics — Background Service Worker
 * - Detects tab activation/deactivation and notifies content scripts.
 * - Queues pending Google Sheets syncs and retries them.
 * - Handles alarm-based batch syncing every 2 minutes.
 */

'use strict';

const SYNC_ALARM   = 'yta_sync';
const RETRY_ALARM  = 'yta_retry';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

// ─── Tab activity monitoring ───────────────────────────────────────────────

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  // Notify all YT tabs about activation state
  const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: tab.id === tabId ? 'TAB_ACTIVATED' : 'TAB_DEACTIVATED',
      });
    } catch (_) {
      // Ignore errors from tabs that don't have the content script loaded yet
    }
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Browser lost focus — pause all YT tracking
    const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'TAB_DEACTIVATED' });
      } catch (_) {
        // Ignore errors from tabs that don't have the content script loaded or are being closed
      }
    }
  }
});

// ─── Alarms for batch sync ─────────────────────────────────────────────────

chrome.alarms.create(SYNC_ALARM,  { periodInMinutes: 2 });
chrome.alarms.create(RETRY_ALARM, { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM  || alarm.name === RETRY_ALARM) {
    syncPendingToSheets();
  }
});

// ─── Message from content script ───────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SESSION_UPDATED') {
    // Mark entry as needing sync (already stored by content.js)
    chrome.storage.local.get(['pendingSync'], (r) => {
      const pending = r.pendingSync || [];
      if (!pending.includes(msg.key)) pending.push(msg.key);
      chrome.storage.local.set({ pendingSync: pending });
    });
    sendResponse({ ok: true });
  }

  if (msg.type === 'GET_AUTH_TOKEN') {
    getAuthToken(false).then((token) => sendResponse({ token })).catch(() => sendResponse({ token: null }));
    return true; // async
  }

  if (msg.type === 'GET_AUTH_TOKEN_INTERACTIVE') {
    getAuthToken(true).then((token) => sendResponse({ token })).catch(() => sendResponse({ token: null }));
    return true;
  }

  if (msg.type === 'GET_SPREADSHEET_ID') {
    chrome.storage.local.get(['spreadsheetId'], (r) => sendResponse({ id: r.spreadsheetId || null }));
    return true;
  }

  if (msg.type === 'SET_SPREADSHEET_ID') {
    chrome.storage.local.set({ spreadsheetId: msg.id }, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'TRIGGER_SYNC') {
    syncPendingToSheets().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
});

// ─── Google Sheets sync ────────────────────────────────────────────────────

async function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive, scopes: [SHEETS_SCOPE] }, (token) => {
      if (chrome.runtime.lastError || !token) reject(chrome.runtime.lastError);
      else resolve(token);
    });
  });
}

async function ensureSheetHeaders(token, spreadsheetId) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:D1`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  const rows = data.values || [];
  if (rows.length === 0) {
    // Write headers
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:D1?valueInputOption=RAW`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [['Date', 'Channel', 'Video Title', 'Time Watched (s)']] }),
    });
  }
}

async function syncPendingToSheets() {
  let token, spreadsheetId;
  try {
    token = await getAuthToken(false);
  } catch {
    return; // Not authenticated yet
  }

  const stored = await new Promise((r) => chrome.storage.local.get(['spreadsheetId', 'pendingSync'], r));
  spreadsheetId = stored.spreadsheetId;
  const pendingKeys = stored.pendingSync || [];

  if (!spreadsheetId || pendingKeys.length === 0) return;

  try {
    await ensureSheetHeaders(token, spreadsheetId);

    const entries = await new Promise((r) => chrome.storage.local.get(pendingKeys, r));
    const rows = pendingKeys
      .map((k) => entries[k])
      .filter(Boolean)
      .map((e) => [e.date, e.channel, e.title, e.totalSecs]);

    if (rows.length === 0) return;

    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A:D:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: rows }),
      }
    );

    if (res.ok) {
      // Mark entries as synced and clear the pending queue
      const updates = {};
      pendingKeys.forEach((k) => {
        if (entries[k]) updates[k] = { ...entries[k], synced: true };
      });
      await new Promise((r) => chrome.storage.local.set({ ...updates, pendingSync: [] }, r));
      console.debug('[YTA Background] Synced', rows.length, 'rows to Sheets');
    }
  } catch (err) {
    console.error('[YTA Background] Sync failed:', err);
  }
}
