// What can be sold, where, by whom, and how. Prices live here, not in the
// browser: the page sends SKUs and quantities, the server prices the sale.
// These match the existing rows in the ETL's transactions CSV.

"use strict";

const CURRENCY = "PHP";

const PRODUCTS = [
  { sku: "SAL-001", name: "Classic Salsa Roja 250g", unit_price: "149.00" },
  { sku: "SAL-002", name: "Salsa Verde 250g", unit_price: "159.00" },
  { sku: "SAL-003", name: "Mango Habanero Salsa 250g", unit_price: "189.00" },
  { sku: "CHP-001", name: "Tortilla Chips 200g", unit_price: "99.00" },
  { sku: "CHP-002", name: "Spicy Nacho Chips 200g", unit_price: "109.00" },
  { sku: "GUA-001", name: "Guacamole Cup 150g", unit_price: "129.00" },
  { sku: "BEV-001", name: "Horchata 350ml", unit_price: "85.00" },
  { sku: "BEV-002", name: "Calamansi Soda 330ml", unit_price: "65.00" },
  { sku: "BUN-001", name: "Fiesta Bundle (Salsa + Chips + Guac)", unit_price: "329.00" },
];

const STORES = [
  { id: "STORE-LIPA", name: "Lipa" },
  { id: "STORE-NASUGBU", name: "Nasugbu" },
  { id: "STORE-BATANGAS", name: "Batangas" },
];

const CASHIERS = ["C-101", "C-102", "C-103", "C-104"];

const PAYMENT_METHODS = ["cash", "card", "gcash", "maya"];

module.exports = { CURRENCY, PRODUCTS, STORES, CASHIERS, PAYMENT_METHODS };
