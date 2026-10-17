const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const m = require('../src/Mapping.js');

const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')).data;
const order = fixture('orders-create.json');
const lead = fixture('leads-create.json');

const col = (columns, header) => columns.findIndex((c) => c.header === header);

test('an order becomes one row in column order', () => {
  const row = m.toRow_(m.ORDER_COLUMNS, order, null);
  assert.equal(row.length, m.ORDER_COLUMNS.length);
  assert.equal(row[col(m.ORDER_COLUMNS, 'Order')], order.orderNumber);
  assert.equal(row[col(m.ORDER_COLUMNS, 'Total')], order.total);
  assert.equal(row[col(m.ORDER_COLUMNS, 'City')], 'Lalitpur');
  assert.ok(row[col(m.ORDER_COLUMNS, 'Date')] instanceof Date);
  assert.equal(row[m.keyIndex_(m.ORDER_COLUMNS)], order.id);
});

test('line items read as "2 × Title (Variant)"', () => {
  assert.equal(m.itemsSummary_(order.items).startsWith('2 × Handmade Lokta Notebook'), true);
  assert.equal(m.itemsSummary_([{ quantity: 1, title: 'Tee', variantTitle: 'M / Red' }]), '1 × Tee (M / Red)');
  assert.equal(m.itemsSummary_([{ quantity: 1, title: 'Tee', variantTitle: 'Default Variant' }]), '1 × Tee');
  assert.equal(m.itemsSummary_(undefined), '');
});

test('items fetched earlier survive an update from the list endpoint (which has none)', () => {
  const existing = m.toRow_(m.ORDER_COLUMNS, order, null);
  const { items, ...listShape } = order;
  const updated = m.toRow_(m.ORDER_COLUMNS, { ...listShape, status: 'DISPATCHED' }, existing);
  const at = col(m.ORDER_COLUMNS, 'Items');
  assert.equal(updated[at], existing[at]);
  assert.equal(updated[col(m.ORDER_COLUMNS, 'Status')], 'DISPATCHED');
});

test('customer text can never become a formula', () => {
  assert.equal(m.text_('=HYPERLINK("http://x")'), '\'=HYPERLINK("http://x")');
  assert.equal(m.text_('+9779800000000'), "'+9779800000000");
  assert.equal(m.text_('Ram'), 'Ram');
  assert.equal(m.text_(null), '');
});

test('dates and money are typed, and bad values are blank', () => {
  assert.ok(m.toDate_('2026-10-15T09:30:00.000Z') instanceof Date);
  assert.equal(m.toDate_('not a date'), '');
  assert.equal(m.money_('12.5'), 12.5);
  assert.equal(m.money_(undefined), '');
});

test('a lead becomes one row with a joined name', () => {
  const row = m.toRow_(m.LEAD_COLUMNS, lead, null);
  assert.equal(row[col(m.LEAD_COLUMNS, 'Name')], [lead.firstName, lead.lastName].filter(Boolean).join(' '));
  assert.equal(row[m.keyIndex_(m.LEAD_COLUMNS)], lead.id);
});

test('every column has a unique header and exactly one key', () => {
  for (const columns of [m.ORDER_COLUMNS, m.LEAD_COLUMNS]) {
    const headers = columns.map((c) => c.header);
    assert.equal(new Set(headers).size, headers.length);
    assert.equal(columns.filter((c) => c.key).length, 1);
  }
});
