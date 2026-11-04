// salsa-pos HTTP server.
//
//   GET  /               the POS page (public/index.html)
//   GET  /api/catalog    products, stores, cashiers, payment methods
//   GET  /api/sales      recent sales, newest first (?limit=1-50, default 10)
//   POST /api/sales      { store_id, cashier_id, payment_method, discount?, items: [{ sku, qty }] }
//                        -> 201 with the row written to the CSV
//   GET  /health         { status: "ok", csv_rows }
//
// Errors use the ETL's envelope: { "error": { "code", "message" } }.
// Binds to 127.0.0.1; Tailscale Serve publishes it to the tailnet over HTTPS.

"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");

const catalog = require("./catalog");
const { SaleError, buildSale } = require("./sale");
const { StoreError, createStore } = require("./csv-store");

const MAX_BODY = 16 * 1024;

class TooLarge extends Error {}
const PAGE = path.join(__dirname, "..", "public", "index.html");

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

function sendError(res, status, code, message) {
  send(res, status, { error: { code, message } });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    // Requiring JSON also blocks plain HTML form posts from other sites.
    if (!/^application\/json\b/i.test(req.headers["content-type"] || "")) {
      return reject(new SaleError("Content-Type must be application/json"));
    }
    let size = 0;
    const chunks = [];
    // Keep reading (and discarding) an oversized body so the client still
    // gets the 413 instead of a reset connection.
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY) chunks.push(chunk);
    });
    req.on("end", () => {
      if (size > MAX_BODY) return reject(new TooLarge(`request body must be at most ${MAX_BODY} bytes`));
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new SaleError("request body is not valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function createServer({ csvPath, log = console }) {
  const store = createStore(csvPath);

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        return fs.createReadStream(PAGE).pipe(res);
      }
      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { status: "ok", csv_rows: await store.count() });
      }
      if (req.method === "GET" && url.pathname === "/api/catalog") {
        const { CURRENCY, PRODUCTS, STORES, CASHIERS, PAYMENT_METHODS } = catalog;
        return send(res, 200, { currency: CURRENCY, products: PRODUCTS, stores: STORES, cashiers: CASHIERS, payment_methods: PAYMENT_METHODS });
      }
      if (req.method === "GET" && url.pathname === "/api/sales") {
        const raw = url.searchParams.get("limit") ?? "10";
        if (!/^\d{1,2}$/.test(raw) || Number(raw) < 1 || Number(raw) > 50) {
          return sendError(res, 400, "invalid_request", "limit must be a whole number from 1 to 50");
        }
        return send(res, 200, { sales: await store.recent(Number(raw)) });
      }
      if (req.method === "POST" && url.pathname === "/api/sales") {
        const sale = buildSale(await readJson(req));
        const row = await store.append(sale);
        log.log(JSON.stringify({ ts: new Date().toISOString(), event: "sale", id: row.id, amount: row.amount, store_id: row.store_id }));
        return send(res, 201, { sale: row });
      }
      if (["/", "/health", "/api/catalog", "/api/sales"].includes(url.pathname)) {
        return sendError(res, 405, "method_not_allowed", `${req.method} is not allowed on ${url.pathname}`);
      }
      return sendError(res, 404, "not_found", `unknown route ${req.method} ${url.pathname}`);
    } catch (err) {
      if (err instanceof SaleError) return sendError(res, 400, "invalid_request", err.message);
      if (err instanceof TooLarge) return sendError(res, 413, "payload_too_large", err.message);
      if (err instanceof StoreError) {
        log.error(JSON.stringify({ ts: new Date().toISOString(), event: "csv_error", message: err.message }));
        return sendError(res, 503, "csv_unavailable", err.message);
      }
      log.error(JSON.stringify({ ts: new Date().toISOString(), event: "error", message: err.message }));
      return sendError(res, 500, "internal_error", "unexpected server error");
    }
  });
}

if (require.main === module) {
  const root = path.join(__dirname, "..");
  const csvPath = path.resolve(root, process.env.CSV_PATH || "");
  if (!process.env.CSV_PATH) {
    console.error("CSV_PATH is not set. Copy .env.example to .env and point it at the ETL's transactions.csv.");
    process.exit(1);
  }
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV_PATH does not exist: ${csvPath}`);
    process.exit(1);
  }
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 3100);
  const server = createServer({ csvPath });
  server.listen(port, host, () => {
    console.log(`salsa-pos listening on http://${host}:${port}`);
    console.log(`appending sales to ${csvPath}`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

module.exports = { createServer };
