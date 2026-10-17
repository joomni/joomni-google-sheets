/**
 * Joomni for Google Sheets — the menu, the connection and the schedule.
 *
 * The API key is kept in User Properties: only the Google account that
 * connected can read it, not other editors of the spreadsheet. Auto-sync
 * runs as that same account.
 */

var PROP_API_KEY = 'JOOMNI_API_KEY';
var PROP_BASE_URL = 'JOOMNI_BASE_URL';
var PROP_IMPORT = 'JOOMNI_IMPORT_STATE';
var DOC_STORE_NAME = 'JOOMNI_STORE_NAME';
var LOG_SHEET = 'Sync log';
var LOG_MAX_ROWS = 500;
var AUTO_SYNC_MINUTES = 15;

// ── Menu ────────────────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Joomni')
    .addItem('Connect store…', 'showConnectDialog')
    .addSeparator()
    .addItem('Sync now', 'syncNow')
    .addItem('Import full history', 'importFullHistory')
    .addSeparator()
    .addItem('Turn on auto-sync (every ' + AUTO_SYNC_MINUTES + ' min)', 'turnOnAutoSync')
    .addItem('Turn off auto-sync', 'turnOffAutoSync')
    .addSeparator()
    .addItem('Disconnect', 'disconnect')
    .addToUi();
}

function showConnectDialog() {
  var html = HtmlService.createHtmlOutputFromFile('Setup').setWidth(440).setHeight(420);
  SpreadsheetApp.getUi().showModalDialog(html, 'Connect your Joomni store');
}

// ── Connection ──────────────────────────────────────────────────────────────

function getConnection_() {
  var props = PropertiesService.getUserProperties();
  var apiKey = props.getProperty(PROP_API_KEY);
  if (!apiKey) return null;
  return { apiKey: apiKey, baseUrl: props.getProperty(PROP_BASE_URL) || DEFAULT_BASE_URL };
}

/**
 * Called from the Setup dialog. Checks the key against the API before
 * saving it, so a typo is caught here rather than at the first sync.
 */
function saveConnection(apiKey, baseUrl) {
  apiKey = String(apiKey || '').trim();
  baseUrl = String(baseUrl || '').trim() || DEFAULT_BASE_URL;
  if (!/^jk_/.test(apiKey)) throw new Error('That doesn’t look like a Joomni API key. Keys start with jk_live_.');
  if (!/^https:\/\//.test(baseUrl)) throw new Error('The API address must start with https://');

  var conn = { apiKey: apiKey, baseUrl: baseUrl.replace(/\/+$/, '') };
  var store;
  try {
    store = joomniGet_('/store', {}, conn);
  } catch (e) {
    if (e.status === 401) throw new Error('Joomni didn’t accept this key. Check it was copied in full and hasn’t been revoked.');
    if (e.status === 403) throw new Error('This key needs the store:read scope (plus orders:read and leads:read).');
    throw new Error('Couldn’t reach Joomni: ' + e.message);
  }

  var props = PropertiesService.getUserProperties();
  props.setProperty(PROP_API_KEY, conn.apiKey);
  props.setProperty(PROP_BASE_URL, conn.baseUrl);
  var name = (store && store.data && (store.data.storeName || store.data.name)) || 'your store';
  PropertiesService.getDocumentProperties().setProperty(DOC_STORE_NAME, name);
  return { storeName: name };
}

function disconnect() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert('Disconnect Joomni?', 'Auto-sync stops and the API key is removed. Rows already in the sheet stay.', ui.ButtonSet.OK_CANCEL);
  if (answer !== ui.Button.OK) return;
  removeTriggers_(['scheduledSync', 'continueImport']);
  var props = PropertiesService.getUserProperties();
  [PROP_API_KEY, PROP_BASE_URL, PROP_IMPORT].forEach(function (k) { props.deleteProperty(k); });
  PropertiesService.getDocumentProperties().deleteProperty(DOC_STORE_NAME);
  toast_('Disconnected.');
}

// ── Running a sync ──────────────────────────────────────────────────────────

/** Menu: the newest orders and enquiries, inserted or updated. */
function syncNow() {
  if (!requireConnection_()) return;
  var summary = withLock_(function () { return runRecentSync_('manual'); });
  if (summary) toast_(summary);
}

/** Time-driven trigger. */
function scheduledSync() {
  if (!getConnection_()) return;
  withLock_(function () { return runRecentSync_('auto'); });
}

function runRecentSync_(mode) {
  var startedAt = Date.now();
  var parts = [];
  DATASET_ORDER.forEach(function (name) {
    try {
      var r = syncDataset_(name, { fromPage: 1, maxPages: RECENT_PAGES, startedAt: startedAt });
      log_(mode, name, r.created, r.updated, 'ok');
      parts.push(datasets_()[name].sheet + ': ' + r.created + ' new, ' + r.updated + ' updated');
    } catch (e) {
      var message = explainError_(e, name);
      log_(mode, name, 0, 0, message);
      parts.push(datasets_()[name].sheet + ': ' + message);
    }
  });
  return parts.join(' · ');
}

/** Menu: every order and enquiry, oldest pages included. Continues by itself if it runs long. */
function importFullHistory() {
  if (!requireConnection_()) return;
  PropertiesService.getUserProperties().setProperty(PROP_IMPORT, JSON.stringify({ dataset: 0, page: 1 }));
  toast_('Importing full history. Large stores continue in the background; see the Sync log tab.');
  continueImport();
}

/** Picks up a full import where the last run stopped. Also the one-off trigger's handler. */
function continueImport() {
  removeTriggers_(['continueImport']);
  var props = PropertiesService.getUserProperties();
  var raw = props.getProperty(PROP_IMPORT);
  if (!raw || !getConnection_()) return;

  withLock_(function () {
    var state = JSON.parse(raw);
    var startedAt = Date.now();
    while (state.dataset < DATASET_ORDER.length) {
      var name = DATASET_ORDER[state.dataset];
      var r;
      try {
        r = syncDataset_(name, { fromPage: state.page, startedAt: startedAt });
        log_('import', name, r.created, r.updated, r.done ? 'ok' : 'continuing from page ' + r.nextPage);
      } catch (e) {
        log_('import', name, 0, 0, explainError_(e, name));
        r = { done: true };
      }
      if (!r.done) {
        state.page = r.nextPage;
        props.setProperty(PROP_IMPORT, JSON.stringify(state));
        ScriptApp.newTrigger('continueImport').timeBased().after(60 * 1000).create();
        return;
      }
      state = { dataset: state.dataset + 1, page: 1 };
      if (Date.now() - startedAt > TIME_BUDGET_MS && state.dataset < DATASET_ORDER.length) {
        props.setProperty(PROP_IMPORT, JSON.stringify(state));
        ScriptApp.newTrigger('continueImport').timeBased().after(60 * 1000).create();
        return;
      }
    }
    props.deleteProperty(PROP_IMPORT);
    log_('import', 'all', 0, 0, 'full history imported');
  });
}

// ── Auto-sync ───────────────────────────────────────────────────────────────

function turnOnAutoSync() {
  if (!requireConnection_()) return;
  removeTriggers_(['scheduledSync']);
  ScriptApp.newTrigger('scheduledSync').timeBased().everyMinutes(AUTO_SYNC_MINUTES).create();
  toast_('Auto-sync is on: every ' + AUTO_SYNC_MINUTES + ' minutes.');
}

function turnOffAutoSync() {
  removeTriggers_(['scheduledSync']);
  toast_('Auto-sync is off.');
}

function removeTriggers_(handlers) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (handlers.indexOf(t.getHandlerFunction()) !== -1) ScriptApp.deleteTrigger(t);
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** One sync at a time per spreadsheet: a manual sync and auto-sync can't collide. */
function withLock_(fn) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30 * 1000)) {
    toast_('Another sync is running. Try again in a minute.');
    return null;
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function requireConnection_() {
  if (getConnection_()) return true;
  showConnectDialog();
  return false;
}

function explainError_(e, dataset) {
  if (e && e.status === 401) return 'key rejected (revoked or mistyped): reconnect';
  if (e && e.status === 403) return 'key lacks the ' + datasets_()[dataset].scope + ' scope';
  return (e && e.message) || String(e);
}

function log_(mode, dataset, created, updated, message) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_SHEET);
    sheet.getRange(1, 1, 1, 6).setValues([['Time', 'Run', 'Data', 'New', 'Updated', 'Result']]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  sheet.insertRowAfter(1);
  sheet.getRange(2, 1, 1, 6).setValues([[new Date(), mode, dataset, created, updated, message]]);
  sheet.getRange(2, 1).setNumberFormat(DATE_FORMAT);
  var extra = sheet.getLastRow() - (LOG_MAX_ROWS + 1);
  if (extra > 0) sheet.deleteRows(LOG_MAX_ROWS + 2, extra);
}

function toast_(message) {
  try {
    SpreadsheetApp.getActive().toast(message, 'Joomni', 8);
  } catch (e) {
    // No UI in a trigger run.
  }
}
