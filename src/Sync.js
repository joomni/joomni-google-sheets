/**
 * The sync: page through Joomni, then insert or update rows matched on the
 * record's id. Running it twice never duplicates a row.
 *
 * Columns are found by their header, so you can reorder them and add your
 * own columns (notes, follow-up status) between them; those are never
 * written to. Rows are re-sorted newest first, so keep formulas that point
 * at this sheet on a separate tab.
 */

var PAGE_SIZE = 100;
/** "Sync now" and auto-sync look at the newest this-many pages of each list. */
var RECENT_PAGES = 2;
/** Order line items need one request per order; cap them per run (rate limit: 120/min). */
var DETAIL_LIMIT_PER_RUN = 60;
/** Apps Script stops a run at 6 minutes; stop early and continue in a new run. */
var TIME_BUDGET_MS = 4.5 * 60 * 1000;

/**
 * A function, not a top-level object: Apps Script runs files in the order they
 * were created, so Mapping.js may not have defined the columns yet when this
 * file loads.
 */
function datasets_() {
  return {
    orders: { sheet: 'Orders', path: '/orders', columns: ORDER_COLUMNS, detailPath: '/orders/', scope: 'orders:read' },
    leads: { sheet: 'Leads', path: '/leads', columns: LEAD_COLUMNS, scope: 'leads:read' },
  };
}
var DATASET_ORDER = ['orders', 'leads'];

/**
 * Sync one dataset.
 * @param {string} name      'orders' | 'leads'
 * @param {object} options   { fromPage, maxPages, startedAt }
 * @return {{ created: number, updated: number, done: boolean, nextPage: number }}
 */
function syncDataset_(name, options) {
  var ds = datasets_()[name];
  var sheet = ensureSheet_(ds);
  var layout = readLayout_(sheet, ds.columns);
  var keyPos = layout.positions[keyIndex_(ds.columns)];
  var itemsIdx = ds.columns.findIndex(function (c) { return c.keep; });

  // id → index into `rows` (row 2 of the sheet is rows[0]).
  var rows = layout.rows;
  var byId = {};
  rows.forEach(function (row, i) {
    if (row[keyPos]) byId[String(row[keyPos])] = i;
  });

  var created = [];
  var updated = 0;
  var detailsFetched = 0;
  var page = options.fromPage || 1;
  var lastPage = page + (options.maxPages || Infinity) - 1;
  var done = false;

  while (true) {
    var res = joomniGet_(ds.path, { page: page, limit: PAGE_SIZE });
    var records = (res && res.data) || [];
    var totalPages = (res && res.meta && res.meta.totalPages) || 1;

    records.forEach(function (record) {
      var at = byId[String(record.id)];
      var existing = at === undefined ? null : layout.positions.map(function (p) { return rows[at][p]; });

      // Line items come only from the single-order endpoint: fetch them for
      // rows that don't have them yet.
      var needsItems = ds.detailPath && itemsIdx >= 0 && (!existing || existing[itemsIdx] === '');
      if (needsItems && detailsFetched < DETAIL_LIMIT_PER_RUN) {
        try {
          var detail = joomniGet_(ds.detailPath + encodeURIComponent(record.id), {});
          if (detail && detail.data) record = detail.data;
          detailsFetched++;
        } catch (e) {
          // Items stay blank and are fetched on a later run.
        }
      }

      var values = toRow_(ds.columns, record, existing);
      if (at === undefined) {
        var fresh = new Array(layout.width).fill('');
        layout.positions.forEach(function (p, i) { fresh[p] = values[i]; });
        created.push(fresh);
        byId[String(record.id)] = -1; // seen; don't add twice if pages shift
      } else if (at >= 0) {
        layout.positions.forEach(function (p, i) { rows[at][p] = values[i]; });
        updated++;
      }
    });

    if (page >= totalPages || records.length === 0) {
      done = true;
      break;
    }
    if (page >= lastPage) break;
    page++;
    if (Date.now() - options.startedAt > TIME_BUDGET_MS) break;
  }

  writeSheet_(sheet, ds.columns, layout, rows, created);
  return { created: created.length, updated: updated, done: done, nextPage: page + 1 };
}

/** Create the sheet with its header row if it doesn't exist. */
function ensureSheet_(ds) {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(ds.sheet);
  if (!sheet) {
    sheet = ss.insertSheet(ds.sheet);
    var headers = ds.columns.map(function (c) { return c.header; });
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#f3f3f3');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Where each column lives in the sheet, by header. Headers missing from the
 * sheet (columns added in a newer version) are appended on the right.
 */
function readLayout_(sheet, columns) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var positions = columns.map(function (col) {
    var at = header.indexOf(col.header);
    if (at === -1) {
      header.push(col.header);
      at = header.length - 1;
      sheet.getRange(1, at + 1).setValue(col.header).setFontWeight('bold').setBackground('#f3f3f3');
    }
    return at;
  });
  var width = header.length;
  var lastRow = sheet.getLastRow();
  var rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, width).getValues() : [];
  return { positions: positions, width: width, rows: rows };
}

function writeSheet_(sheet, columns, layout, rows, created) {
  var all = rows.concat(created);
  var total = all.length;
  if (!total) return;

  // Write only the columns the sync owns, one column at a time, so anything
  // you typed in your own columns is left exactly as it is.
  layout.positions.forEach(function (p) {
    sheet.getRange(2, p + 1, total, 1).setValues(all.map(function (r) { return [r[p]]; }));
  });

  // Number formats on the whole data area of each formatted column.
  columns.forEach(function (col, i) {
    if (col.format) sheet.getRange(2, layout.positions[i] + 1, total, 1).setNumberFormat(col.format);
  });

  // Newest first, by the Date column.
  var dateIdx = columns.findIndex(function (c) { return c.header === 'Date'; });
  if (dateIdx >= 0) {
    sheet.getRange(2, 1, total, layout.width).sort({ column: layout.positions[dateIdx] + 1, ascending: false });
  }
}
