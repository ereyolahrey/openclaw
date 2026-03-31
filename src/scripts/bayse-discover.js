require("dotenv").config();
const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BASE = "https://relay.bayse.markets";
const EMAIL = process.env.BAYSE_EMAIL || "lostmyfaith123@gmail.com";

async function main() {
  console.log("\n========================================");
  console.log("  BAYSE MARKETS — API DISCOVERY");
  console.log("========================================\n");
  console.log(`  Base: ${BASE}`);
  console.log(`  Email: ${EMAIL}\n`);

  // 1. Health check
  console.log("--- Health check ---\n");
  try {
    const r = await axios.get(`${BASE}/health`, { timeout: 10000 });
    console.log(`  [OK] Health: ${JSON.stringify(r.data)}\n`);
  } catch (e) {
    console.log(`  [${e.response?.status || "ERR"}] Health: ${e.message}\n`);
  }

  // 2. Try login (requires password - we'll see what it returns)
  console.log("--- Testing login endpoint ---\n");
  try {
    const r = await axios.post(`${BASE}/v1/user/login`, { email: EMAIL }, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });
    console.log(`  [${r.status}] Login response: ${JSON.stringify(r.data, null, 2)}\n`);
  } catch (e) {
    console.log(`  [${e.response?.status || "ERR"}] Login response: ${JSON.stringify(e.response?.data || e.message)}`);
    console.log(`  (This is expected — login requires both email AND password)\n`);
  }

  // 3. List public events (no auth required)
  console.log("--- Listing public events ---\n");
  let events = [];
  try {
    const r = await axios.get(`${BASE}/v1/pm/events`, {
      params: { page: 1, size: 20 },
      timeout: 10000,
    });
    console.log(`  [${r.status}] Events response:`);
    events = r.data?.data || r.data?.events || r.data || [];
    if (Array.isArray(events)) {
      console.log(`  Found ${events.length} events\n`);
      for (const evt of events.slice(0, 10)) {
        console.log(`    - [${evt.id || evt._id}] ${evt.title || evt.name || evt.description || "untitled"}`);
        console.log(`      Status: ${evt.status || "?"} | Category: ${evt.category || "?"}`);
        if (evt.markets && Array.isArray(evt.markets)) {
          for (const mkt of evt.markets) {
            console.log(`      Market: [${mkt.id || mkt._id}] ${mkt.title || mkt.question || mkt.name || "?"}`);
            if (mkt.outcomes) console.log(`        Outcomes: ${JSON.stringify(mkt.outcomes)}`);
            if (mkt.prices) console.log(`        Prices: ${JSON.stringify(mkt.prices)}`);
          }
        }
        console.log("");
      }
    } else {
      console.log(`  Response: ${JSON.stringify(r.data).substring(0, 500)}\n`);
    }
  } catch (e) {
    console.log(`  [${e.response?.status || "ERR"}] Events: ${JSON.stringify(e.response?.data || e.message)}\n`);
  }

  // 4. Look for BTC/Bitcoin related events
  console.log("--- Searching for BTC events ---\n");
  try {
    const r = await axios.get(`${BASE}/v1/pm/events`, {
      params: { page: 1, size: 50, search: "BTC" },
      timeout: 10000,
    });
    const btcEvents = r.data?.data || r.data?.events || r.data || [];
    if (Array.isArray(btcEvents) && btcEvents.length > 0) {
      console.log(`  Found ${btcEvents.length} BTC events\n`);
      for (const evt of btcEvents) {
        console.log(`    [${evt.id || evt._id}] ${evt.title || evt.name || evt.description || JSON.stringify(evt).substring(0, 100)}`);
        if (evt.markets) {
          for (const mkt of evt.markets) {
            console.log(`      Market: [${mkt.id || mkt._id}] ${mkt.title || mkt.question || mkt.name || "?"}`);
          }
        }
      }
    } else {
      console.log(`  No BTC events with 'search' param. Trying category filter...\n`);
    }
  } catch (e) {
    console.log(`  [${e.response?.status || "ERR"}] BTC search: ${JSON.stringify(e.response?.data || e.message)}\n`);
  }

  // Try alternative search params
  for (const params of [
    { category: "crypto" },
    { category: "bitcoin" },
    { tag: "btc" },
    { q: "BTC" },
    { query: "bitcoin" },
    { type: "crypto" },
  ]) {
    try {
      const r = await axios.get(`${BASE}/v1/pm/events`, { params: { ...params, page: 1, size: 10 }, timeout: 10000 });
      const evts = r.data?.data || r.data?.events || r.data;
      if (Array.isArray(evts) && evts.length > 0) {
        console.log(`  Param ${JSON.stringify(params)} -> ${evts.length} events`);
      }
    } catch { /* skip */ }
  }

  // 5. Try market data endpoints
  console.log("\n--- Market data endpoints ---\n");
  const dataPaths = [
    "/v1/pm/market-data", "/v1/market-data", "/v1/pm/prices",
    "/v1/pm/candles", "/v1/pm/charts", "/v1/pm/markets",
    "/v1/pm/categories",
  ];
  for (const dp of dataPaths) {
    try {
      const r = await axios.get(`${BASE}${dp}`, { timeout: 10000 });
      console.log(`  [${r.status}] GET ${dp}: ${JSON.stringify(r.data).substring(0, 250)}`);
    } catch (e) {
      if (e.response?.status !== 404) {
        console.log(`  [${e.response?.status}] GET ${dp}: ${JSON.stringify(e.response?.data || e.message).substring(0, 150)}`);
      }
    }
  }

  // 6. Save all discovered info
  console.log("\n--- Summary ---\n");
  const config = {
    discoveredAt: new Date().toISOString(),
    baseUrl: BASE,
    endpoints: {
      health: "/health",
      login: "/v1/user/login",
      apiKeys: "/v1/user/me/api-keys",
      events: "/v1/pm/events",
      placeOrder: "/v1/pm/events/{eventId}/markets/{marketId}/orders",
      portfolio: "/v1/pm/portfolio",
      orders: "/v1/pm/orders",
      activities: "/v1/pm/activities",
    },
    auth: {
      read: "X-Public-Key header",
      write: "X-Public-Key + X-Timestamp + X-Signature (HMAC-SHA256)",
      session: "x-auth-token + x-device-id (from login)",
    },
    events: events.slice(0, 20),
  };

  fs.writeFileSync(path.join(__dirname, "../../bayse-config.json"), JSON.stringify(config, null, 2));
  console.log("  Saved to bayse-config.json\n");

  console.log("  ============================================");
  console.log("  NEXT: You need to provide your Bayse password");
  console.log("  to complete login and generate API keys.");
  console.log("  ============================================\n");
}

main().catch(console.error);
