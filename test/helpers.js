"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const HEADER = "id,timestamp,amount,currency,store_id,cashier_id,payment_method,discount,items";

// A temp copy of a CSV with the ETL header and the given body lines.
function tempCsv(lines = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "salsa-pos-"));
  const file = path.join(dir, "transactions.csv");
  fs.writeFileSync(file, [HEADER, ...lines].join("\n") + "\n");
  return file;
}

const validSale = (overrides = {}) => ({
  store_id: "STORE-LIPA",
  cashier_id: "C-101",
  payment_method: "gcash",
  items: [{ sku: "SAL-002", qty: 3 }],
  ...overrides,
});

module.exports = { HEADER, tempCsv, validSale };
