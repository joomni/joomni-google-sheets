/**
 * What goes in each column. Pure functions with no Apps Script calls, so the
 * tests can run them in Node (see test/mapping.test.js).
 *
 * To add a column: add an entry here. The sheet gains the column on the next
 * sync. To remove one, delete the entry and the column in the sheet.
 *
 * `key: true` marks the column the sync matches rows on. Don't edit it.
 * `keep: true` columns are filled once (when the row is created) and never
 * overwritten, so a value fetched separately survives later updates.
 */

/** Joomni sends ISO 8601 UTC strings. Sheets wants Date objects. */
function toDate_(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d;
}

function money_(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : '';
}

function text_(v) {
  if (v === null || v === undefined) return '';
  // A leading = + - @ would make Sheets treat a customer's text as a formula.
  const s = String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function join_(list) {
  return Array.isArray(list) ? list.filter(Boolean).join(', ') : '';
}

/** "2 × Lokta Notebook (A5) · 1 × Ceramic Vase" */
function itemsSummary_(items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return items
    .map(function (i) {
      const variant = i.variantTitle && i.variantTitle !== 'Default Variant' ? ' (' + i.variantTitle + ')' : '';
      return (i.quantity || 0) + ' × ' + (i.title || 'Item') + variant;
    })
    .join(' · ');
}

function addressPart_(order, field) {
  const a = order && (order.shippingAddress || order.billingAddress);
  return a && a[field] ? a[field] : '';
}

var MONEY_FORMAT = '#,##0.00';
var DATE_FORMAT = 'yyyy-mm-dd hh:mm';

var ORDER_COLUMNS = [
  { header: 'Order', value: function (o) { return text_(o.orderNumber); } },
  { header: 'Date', value: function (o) { return toDate_(o.createdAt); }, format: DATE_FORMAT },
  { header: 'Status', value: function (o) { return o.status || ''; } },
  { header: 'Payment', value: function (o) { return o.financialStatus || ''; } },
  { header: 'Fulfilment', value: function (o) { return o.fulfillmentStatus || ''; } },
  { header: 'Channel', value: function (o) { return o.channel || ''; } },
  { header: 'Customer', value: function (o) { return text_(o.customerName); } },
  { header: 'Email', value: function (o) { return text_(o.customerEmail); } },
  { header: 'Phone', value: function (o) { return text_(addressPart_(o, 'phone')); } },
  { header: 'City', value: function (o) { return text_(addressPart_(o, 'city')); } },
  { header: 'Province', value: function (o) { return text_(addressPart_(o, 'province')); } },
  { header: 'Items', value: function (o) { return text_(itemsSummary_(o.items)); }, keep: true },
  { header: 'Subtotal', value: function (o) { return money_(o.subtotal); }, format: MONEY_FORMAT },
  { header: 'Shipping', value: function (o) { return money_(o.shipping); }, format: MONEY_FORMAT },
  { header: 'Discount', value: function (o) { return money_(o.discount); }, format: MONEY_FORMAT },
  { header: 'Total', value: function (o) { return money_(o.total); }, format: MONEY_FORMAT },
  { header: 'Payment method', value: function (o) { return o.paymentMethod || ''; } },
  { header: 'Discount codes', value: function (o) { return text_(join_(o.discountCodes)); } },
  { header: 'Note', value: function (o) { return text_(o.note); } },
  { header: 'Source', value: function (o) { return text_(o.utmSource || o.trafficSource || o.referrer); } },
  { header: 'Updated', value: function (o) { return toDate_(o.updatedAt); }, format: DATE_FORMAT },
  { header: 'Order ID', value: function (o) { return o.id; }, key: true },
];

var LEAD_COLUMNS = [
  { header: 'Date', value: function (l) { return toDate_(l.createdAt); }, format: DATE_FORMAT },
  { header: 'Name', value: function (l) { return text_([l.firstName, l.lastName].filter(Boolean).join(' ')); } },
  { header: 'Email', value: function (l) { return text_(l.email); } },
  { header: 'Phone', value: function (l) { return text_(l.phone); } },
  { header: 'Subject', value: function (l) { return text_(l.subject); } },
  { header: 'Message', value: function (l) { return text_(l.message); } },
  { header: 'Status', value: function (l) { return l.status || ''; } },
  { header: 'Priority', value: function (l) { return l.priority || ''; } },
  { header: 'Source', value: function (l) { return text_(l.source); } },
  { header: 'Tags', value: function (l) { return text_(join_(l.tags)); } },
  { header: 'Updated', value: function (l) { return toDate_(l.updatedAt); }, format: DATE_FORMAT },
  { header: 'Lead ID', value: function (l) { return l.id; }, key: true },
];

/** One sheet row for a record. `existing` is the row already in the sheet, if any. */
function toRow_(columns, record, existing) {
  return columns.map(function (col, i) {
    if (col.keep && existing && existing[i] !== '' && existing[i] !== undefined) return existing[i];
    return col.value(record);
  });
}

function keyIndex_(columns) {
  for (var i = 0; i < columns.length; i++) if (columns[i].key) return i;
  throw new Error('No key column');
}

// Node (tests) only. Apps Script has no `module`.
if (typeof module !== 'undefined') {
  module.exports = { toDate_, money_, text_, itemsSummary_, toRow_, keyIndex_, ORDER_COLUMNS, LEAD_COLUMNS };
}
