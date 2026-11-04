"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createStore, parseCsv, MAX_ROWS } = require("../src/csv-store");
const { buildSale } = require("../src/sale");
const { HEADER, tempCsv, validSale } = require("./helpers");

const NOW = new Date("2026-11-04T01:30:00.000Z");

test("appends a quoted row in header order and continues the id sequence", async () => {
  const file = tempCsv(['SALSA-TX-00120,2026-10-31T10:44:26.000Z,65.00,PHP,STORE-LIPA,C-101,cash,0.00,"[]"']);
  const row = await createStore(file).append(buildSale(validSale()), NOW);
  assert.equal(row.id, "SALSA-TX-00121");
  const last = fs.readFileSync(file, "utf8").trimEnd().split("\n").at(-1);
  assert.equal(
    last,
    'SALSA-TX-00121,2026-11-04T01:30:00.000Z,477.00,PHP,STORE-LIPA,C-101,gcash,0.00,"[{""sku"":""SAL-002"",""name"":""Salsa Verde 250g"",""qty"":3,""unit_price"":""159.00""}]"'
  );
});

test("starts at 00001, writes in the file's own column order, and fixes a missing final newline", async () => {
  const file = tempCsv();
  fs.writeFileSync(file, "items,id,amount,timestamp,currency,store_id,cashier_id,payment_method,discount,note"); // no newline
  const row = await createStore(file).append(buildSale(validSale()), NOW);
  assert.equal(row.id, "SALSA-TX-00001");
  const [header, values] = parseCsv(fs.readFileSync(file, "utf8"));
  assert.equal(header[0], "items");
  assert.equal(values[1], "SALSA-TX-00001");
  assert.equal(values[2], "477.00");
  assert.equal(values[9], ""); // unknown column left blank
});

test("concurrent appends get unique, sequential ids", async () => {
  const file = tempCsv();
  const store = createStore(file);
  const rows = await Promise.all(Array.from({ length: 20 }, () => store.append(buildSale(validSale()))));
  assert.deepEqual(rows.map((r) => r.id), Array.from({ length: 20 }, (_, i) => `SALSA-TX-${String(i + 1).padStart(5, "0")}`));
  assert.equal(parseCsv(fs.readFileSync(file, "utf8")).length, 21);
});

test("recent() returns newest first with items parsed", async () => {
  const file = tempCsv();
  const store = createStore(file);
  await store.append(buildSale(validSale()));
  await store.append(buildSale(validSale({ items: [{ sku: "BEV-001", qty: 1 }] })));
  const recent = await store.recent(5);
  assert.deepEqual(recent.map((r) => r.id), ["SALSA-TX-00002", "SALSA-TX-00001"]);
  assert.equal(recent[0].items[0].sku, "BEV-001");
  assert.equal(await store.count(), 2);
});

test("refuses a missing file, a header without the ETL columns, and a full file", async () => {
  await assert.rejects(createStore(path.join(path.dirname(tempCsv()), "nope.csv")).append(buildSale(validSale())), /CSV file not found/);

  const bad = tempCsv();
  fs.writeFileSync(bad, "id,amount\n");
  await assert.rejects(createStore(bad).append(buildSale(validSale())), /missing column\(s\): timestamp, currency/);

  const full = tempCsv(Array.from({ length: MAX_ROWS }, (_, i) => `T${i},2026-01-01T00:00:00Z,1.00,PHP,STORE-LIPA,C-101,cash,0.00,"[]"`));
  await assert.rejects(createStore(full).append(buildSale(validSale())), /most the ETL accepts/);
  assert.equal(fs.readFileSync(full, "utf8").split("\n")[0], HEADER);
});

// If the ETL project sits next to this one, prove its extractor and
// transformer accept what salsa-pos writes.
const etl = path.join(__dirname, "..", "..", "isha-v2", "etl-pipeline-microservice-setup", "services");
test("rows written here pass the ETL extractor and transformer", { skip: !fs.existsSync(etl) && "ETL project not found" }, async () => {
  const { readCsvRows } = require(path.join(etl, "extractor", "csv"));
  const { toTransaction } = require(path.join(etl, "extractor", "normalize"));
  const { transformBatch } = require(path.join(etl, "transformer", "validate"));

  const file = tempCsv();
  const store = createStore(file);
  await store.append(buildSale(validSale()));
  await store.append(buildSale(validSale({ items: [{ sku: "BUN-001", qty: 2 }, { sku: "BEV-002", qty: 4 }], discount: "58.60", payment_method: "cash" })));

  const { rows, rejected } = readCsvRows(file);
  assert.deepEqual(rejected, []);
  const out = transformBatch(rows.map(toTransaction));
  assert.deepEqual(out.rejected, []);
  assert.equal(out.rows_out, 2);
  assert.equal(out.transactions[1].amount_minor, 2 * 32900 + 4 * 6500 - 5860);
});
