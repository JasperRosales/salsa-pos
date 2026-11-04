// Appends sales to the ETL's transactions CSV and reads recent ones back
// (unit-tested in test/csv-store.test.js).
//
// - The file must already exist with the ETL header; salsa-pos never creates
//   it, so a wrong CSV_PATH fails loudly instead of writing somewhere unseen.
// - Values are written in the file's own column order. The header must have
//   every column the ETL requires and every column salsa-pos writes.
// - Ids continue the file's sequence: SALSA-TX-00120 -> SALSA-TX-00121.
// - Appends are serialized inside this process (one sale at a time) and each
//   row is written with a single append call, so the ETL never reads half a row.
// - The ETL refuses files over 5,000 data rows, so salsa-pos stops adding at
//   that point instead of breaking the pipeline.

"use strict";

const fs = require("fs/promises");

const COLUMNS = ["id", "timestamp", "amount", "currency", "store_id", "cashier_id", "payment_method", "discount", "items"];
const MAX_ROWS = 5_000;
const ID_PREFIX = "SALSA-TX-";

class StoreError extends Error {}

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const records = [];
  let record = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else {
      field += ch;
    }
  }
  if (quoted) throw new StoreError("CSV has an unterminated quoted field");
  if (field !== "" || record.length) {
    record.push(field);
    records.push(record);
  }
  return records.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

function quote(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function createStore(csvPath) {
  let queue = Promise.resolve();

  async function load() {
    let text;
    try {
      text = await fs.readFile(csvPath, "utf8");
    } catch (err) {
      throw new StoreError(err.code === "ENOENT" ? `CSV file not found: ${csvPath}` : `cannot read ${csvPath}: ${err.message}`);
    }
    const [header, ...records] = parseCsv(text);
    if (!header) throw new StoreError(`CSV file ${csvPath} has no header row`);
    const names = header.map((h) => h.trim());
    const missing = COLUMNS.filter((c) => !names.includes(c));
    if (missing.length) throw new StoreError(`CSV header is missing column(s): ${missing.join(", ")}`);
    return { text, names, records };
  }

  function nextId(names, records) {
    const col = names.indexOf("id");
    let max = 0;
    for (const r of records) {
      const m = /^SALSA-TX-(\d+)$/.exec((r[col] || "").trim());
      if (m) max = Math.max(max, Number(m[1]));
    }
    return `${ID_PREFIX}${String(max + 1).padStart(5, "0")}`;
  }

  // sale: the object from buildSale(). -> the row as written, with id and timestamp.
  function append(sale, now = new Date()) {
    const run = queue.then(async () => {
      const { text, names, records } = await load();
      if (records.length >= MAX_ROWS) {
        throw new StoreError(`the CSV already has ${records.length} sales, the most the ETL accepts; archive older rows first`);
      }
      const row = { id: nextId(names, records), timestamp: now.toISOString(), ...sale };
      const cells = names.map((name) => {
        if (!(name in row)) return "";
        return quote(name === "items" ? JSON.stringify(row.items) : row[name]);
      });
      const lead = text.length && !text.endsWith("\n") ? "\n" : "";
      await fs.appendFile(csvPath, `${lead}${cells.join(",")}\n`, "utf8");
      return row;
    });
    queue = run.catch(() => {});
    return run;
  }

  // Newest first.
  async function recent(limit) {
    const { names, records } = await load();
    return records
      .slice(-limit)
      .reverse()
      .map((values) => {
        const row = Object.fromEntries(names.map((n, i) => [n, (values[i] ?? "").trim()]));
        try {
          row.items = JSON.parse(row.items);
        } catch {
          row.items = [];
        }
        return row;
      });
  }

  async function count() {
    return (await load()).records.length;
  }

  return { append, recent, count, csvPath };
}

module.exports = { COLUMNS, MAX_ROWS, StoreError, createStore, parseCsv };
