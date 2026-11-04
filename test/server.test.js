"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const { createServer } = require("../src/server");
const { tempCsv, validSale } = require("./helpers");

async function start(t, csvPath = tempCsv()) {
  const server = createServer({ csvPath, log: { log() {}, error() {} } });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, headers) => {
    const res = await fetch(base + path, {
      method,
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, type: res.headers.get("content-type") };
  };
  return { call, csvPath };
}

test("serves the page, catalog and health", async (t) => {
  const { call } = await start(t);
  let r = await call("GET", "/");
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/html/);
  assert.match(r.data, /S\.A\.L\.S\.A\. POS/);
  r = await call("GET", "/api/catalog");
  assert.equal(r.data.currency, "PHP");
  assert.ok(r.data.products.some((p) => p.sku === "SAL-001"));
  r = await call("GET", "/health");
  assert.deepEqual(r.data, { status: "ok", csv_rows: 0 });
});

test("POST /api/sales appends to the CSV and shows up in recent sales", async (t) => {
  const { call, csvPath } = await start(t);
  let r = await call("POST", "/api/sales", validSale({ discount: "7.00" }));
  assert.equal(r.status, 201);
  assert.equal(r.data.sale.id, "SALSA-TX-00001");
  assert.equal(r.data.sale.amount, "470.00");
  assert.match(fs.readFileSync(csvPath, "utf8"), /SALSA-TX-00001,.*,470\.00,PHP,STORE-LIPA,C-101,gcash,7\.00,/);

  r = await call("GET", "/api/sales?limit=5");
  assert.equal(r.data.sales[0].id, "SALSA-TX-00001");
});

test("rejects bad requests with the error envelope", async (t) => {
  const { call } = await start(t);
  const cases = [
    [() => call("POST", "/api/sales", validSale({ store_id: "X" })), 400, /store_id/],
    [() => call("POST", "/api/sales", "{bad"), 400, /not valid JSON/],
    [() => call("POST", "/api/sales", undefined, { "Content-Type": "application/x-www-form-urlencoded" }), 400, /Content-Type must be application\/json/],
    [() => call("POST", "/api/sales", { items: "x".repeat(20_000) }), 413, /at most 16384 bytes/],
    [() => call("GET", "/api/sales?limit=0"), 400, /limit/],
    [() => call("GET", "/api/sales?limit=0x5"), 400, /limit/],
    [() => call("DELETE", "/api/sales"), 405, /not allowed/],
    [() => call("GET", "/nope"), 404, /unknown route/],
  ];
  for (const [run, status, pattern] of cases) {
    const r = await run();
    assert.equal(r.status, status, pattern.source);
    assert.match(r.data.error.message, pattern);
  }
});

test("answers 503 when the CSV is missing", async (t) => {
  const { call } = await start(t, "/nonexistent/transactions.csv");
  const r = await call("POST", "/api/sales", validSale());
  assert.equal(r.status, 503);
  assert.equal(r.data.error.code, "csv_unavailable");
});
