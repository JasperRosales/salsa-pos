// Validates a sale from the page and builds the CSV row (unit-tested in
// test/sale.test.js). The checks mirror the ETL transformer's rules, so a row
// written here is never rejected downstream:
//   - store, cashier and payment method come from the catalog lists
//   - 1-50 lines, each a known SKU with an integer qty of 1-999; repeated SKUs
//     are merged into one line
//   - prices come from the catalog; the browser never sends them
//   - discount is a peso amount >= 0 with at most 2 decimals, not above the subtotal
//   - amount = sum(qty * unit_price) - discount, computed here in centavos

"use strict";

const { CURRENCY, PRODUCTS, STORES, CASHIERS, PAYMENT_METHODS } = require("./catalog");

const MAX_LINES = 50;
const MAX_QTY = 999;
const FIELDS = new Set(["store_id", "cashier_id", "payment_method", "discount", "items"]);
const MONEY = /^\d{1,7}(\.\d{1,2})?$/;

const bySku = new Map(PRODUCTS.map((p) => [p.sku, p]));
const toMinor = (text) => Math.round(Number(text) * 100);
const fromMinor = (minor) => (minor / 100).toFixed(2);

class SaleError extends Error {}

function fail(message) {
  throw new SaleError(message);
}

// -> { store_id, cashier_id, payment_method, discount, amount, currency, items }
// with money as "0.00" strings, or throws SaleError with a readable message.
function buildSale(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("request body must be a JSON object");
  const unknown = Object.keys(body).filter((k) => !FIELDS.has(k));
  if (unknown.length) fail(`unknown field(s): ${unknown.join(", ")}`);

  if (!STORES.some((s) => s.id === body.store_id)) fail(`store_id must be one of: ${STORES.map((s) => s.id).join(", ")}`);
  if (!CASHIERS.includes(body.cashier_id)) fail(`cashier_id must be one of: ${CASHIERS.join(", ")}`);
  if (!PAYMENT_METHODS.includes(body.payment_method)) fail(`payment_method must be one of: ${PAYMENT_METHODS.join(", ")}`);

  if (!Array.isArray(body.items) || body.items.length === 0) fail("items must be a non-empty array");
  if (body.items.length > MAX_LINES) fail(`items must have at most ${MAX_LINES} lines`);

  const qtyBySku = new Map();
  body.items.forEach((item, i) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail(`items[${i}] must be an object`);
    const extra = Object.keys(item).filter((k) => k !== "sku" && k !== "qty");
    if (extra.length) fail(`items[${i}] has unknown field(s): ${extra.join(", ")} (prices come from the catalog)`);
    if (!bySku.has(item.sku)) fail(`items[${i}].sku is not in the catalog`);
    if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > MAX_QTY) fail(`items[${i}].qty must be a whole number from 1 to ${MAX_QTY}`);
    qtyBySku.set(item.sku, (qtyBySku.get(item.sku) || 0) + item.qty);
  });

  const items = [];
  let subtotal = 0;
  for (const [sku, qty] of qtyBySku) {
    if (qty > MAX_QTY) fail(`total qty for ${sku} must be at most ${MAX_QTY}`);
    const p = bySku.get(sku);
    items.push({ sku, name: p.name, qty, unit_price: p.unit_price });
    subtotal += qty * toMinor(p.unit_price);
  }

  const discountText = body.discount === undefined || body.discount === "" ? "0" : String(body.discount);
  if (!MONEY.test(discountText)) fail("discount must be a peso amount like 25 or 25.50");
  const discount = toMinor(discountText);
  if (discount > subtotal) fail(`discount (${fromMinor(discount)}) cannot be more than the subtotal (${fromMinor(subtotal)})`);

  return {
    store_id: body.store_id,
    cashier_id: body.cashier_id,
    payment_method: body.payment_method,
    discount: fromMinor(discount),
    amount: fromMinor(subtotal - discount),
    currency: CURRENCY,
    items,
  };
}

module.exports = { SaleError, buildSale, MAX_LINES, MAX_QTY };
