"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSale } = require("../src/sale");
const { validSale } = require("./helpers");

test("prices the sale from the catalog and computes the amount", () => {
  assert.deepEqual(buildSale(validSale()), {
    store_id: "STORE-LIPA",
    cashier_id: "C-101",
    payment_method: "gcash",
    discount: "0.00",
    amount: "477.00",
    currency: "PHP",
    items: [{ sku: "SAL-002", name: "Salsa Verde 250g", qty: 3, unit_price: "159.00" }],
  });
});

test("applies a discount and merges repeated SKUs", () => {
  const s = buildSale(validSale({ items: [{ sku: "SAL-001", qty: 1 }, { sku: "CHP-001", qty: 2 }, { sku: "SAL-001", qty: 1 }], discount: "10.50" }));
  assert.deepEqual(s.items.map((i) => [i.sku, i.qty]), [["SAL-001", 2], ["CHP-001", 2]]);
  assert.equal(s.discount, "10.50");
  assert.equal(s.amount, "485.50"); // 2*149 + 2*99 - 10.50
  assert.equal(buildSale(validSale({ discount: "" })).discount, "0.00");
  assert.equal(buildSale(validSale({ discount: 25 })).discount, "25.00");
  assert.equal(buildSale(validSale({ discount: "477" })).amount, "0.00");
});

test("rejects bad shift and payment values", () => {
  assert.throws(() => buildSale(validSale({ store_id: "STORE-MANILA" })), /store_id must be one of/);
  assert.throws(() => buildSale(validSale({ cashier_id: "C-999" })), /cashier_id must be one of/);
  assert.throws(() => buildSale(validSale({ payment_method: "bitcoin" })), /payment_method must be one of/);
  assert.throws(() => buildSale(validSale({ amount: "1.00" })), /unknown field\(s\): amount/);
  assert.throws(() => buildSale(null), /JSON object/);
  assert.throws(() => buildSale([]), /JSON object/);
});

test("rejects bad items", () => {
  const cases = [
    [undefined, /non-empty array/],
    [[], /non-empty array/],
    [new Array(51).fill({ sku: "SAL-001", qty: 1 }), /at most 50 lines/],
    [[null], /items\[0\] must be an object/],
    [[{ sku: "NOPE", qty: 1 }], /not in the catalog/],
    [[{ sku: "SAL-001", qty: 0 }], /whole number from 1 to 999/],
    [[{ sku: "SAL-001", qty: 1.5 }], /whole number/],
    [[{ sku: "SAL-001", qty: "2" }], /whole number/],
    [[{ sku: "SAL-001", qty: 1000 }], /whole number/],
    [[{ sku: "SAL-001", qty: 600 }, { sku: "SAL-001", qty: 600 }], /total qty for SAL-001/],
    [[{ sku: "SAL-001", qty: 1, unit_price: "0.01" }], /prices come from the catalog/],
  ];
  for (const [items, pattern] of cases) assert.throws(() => buildSale(validSale({ items })), pattern, JSON.stringify(items));
});

test("rejects bad discounts", () => {
  for (const discount of ["-1", "abc", "1.005", "1e2", " 5", null]) {
    assert.throws(() => buildSale(validSale({ discount })), /discount must be a peso amount/, String(discount));
  }
  assert.throws(() => buildSale(validSale({ discount: "477.01" })), /cannot be more than the subtotal/);
});
