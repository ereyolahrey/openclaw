require("dotenv").config();
const axios = require("axios");
const crypto = require("crypto");

const BASE = process.env.BAYSE_API_BASE_URL;
const PUBLIC_KEY = process.env.BAYSE_PUBLIC_KEY;
const SECRET_KEY = process.env.BAYSE_SECRET_KEY;

function sign(method, path, body = "") {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyHash = crypto.createHash("sha256").update(body || "").digest("hex");
  const payload = `${timestamp}.${method.toUpperCase()}.${path}.${bodyHash}`;
  const signature = crypto.createHmac("sha256", SECRET_KEY).update(payload).digest("hex");
  return { "X-Public-Key": PUBLIC_KEY, "X-Timestamp": timestamp, "X-Signature": signature, "Content-Type": "application/json" };
}

async function run() {
  // 1. Get events with proper parsing
  console.log("=== Finding Current BTC 15min Event ===\n");
  
  const evPath = "/v1/pm/events";
  const headers = sign("GET", evPath);
  const evRes = await axios.get(`${BASE}${evPath}`, { headers, params: { limit: 200 }, timeout: 15000 });
  
  // Figure out data shape
  const data = evRes.data;
  console.log(`Response type: ${typeof data}`);
  console.log(`Response keys: ${Object.keys(data)}`);
  
  let events;
  if (Array.isArray(data)) events = data;
  else if (data.events) events = data.events;
  else if (data.data && Array.isArray(data.data)) events = data.data;
  else if (data.items) events = data.items;
  else {
    console.log(`Full keys: ${JSON.stringify(Object.keys(data))}`);
    console.log(`Sample: ${JSON.stringify(data).substring(0, 500)}`);
    // Try to iterate
    events = Object.values(data).find(v => Array.isArray(v)) || [];
  }
  
  console.log(`Total events: ${events.length}`);
  
  // Find BTC 15min
  const btc15 = events.filter(e => 
    e.assetSymbolPair === "BTCUSDT" && e.countdownType === "FIFTEEN_MINUTES"
  );
  
  // Find currently open one
  const openBtc = btc15.filter(e => e.status === "open");
  console.log(`BTC 15min total: ${btc15.length}, open: ${openBtc.length}`);
  
  if (openBtc.length === 0) {
    console.log("\nNo open BTC 15min event right now. Showing most recent:");
    if (btc15.length > 0) {
      const latest = btc15[0];
      console.log(`  ${latest.title} [${latest.status}] closes=${latest.closingDate}`);
    }
    
    // Show a few crypto events
    const cryptoEvents = events.filter(e => e.category === "CRYPTO");
    console.log(`\nAll crypto events: ${cryptoEvents.length}`);
    for (const e of cryptoEvents) {
      console.log(`  ${e.title} [${e.status}] ${e.countdownType || ''} id=${e.id}`);
    }
  }

  // Pick the event to test with
  const targetEvent = openBtc[0] || btc15[0];
  if (!targetEvent) {
    console.log("\n❌ No BTC 15min events found at all");
    return;
  }

  const mkt = targetEvent.markets[0];
  console.log(`\n=== Target Event ===`);
  console.log(`  Title: ${targetEvent.title}`);
  console.log(`  Event ID: ${targetEvent.id}`);
  console.log(`  Market ID: ${mkt.id}`);
  console.log(`  Status: ${targetEvent.status}`);
  console.log(`  Threshold: $${targetEvent.eventThreshold}`);
  console.log(`  Closes: ${targetEvent.closingDate}`);
  console.log(`  Up outcome: ${mkt.outcome1Id} (${mkt.outcome1Label}) price=${mkt.outcome1Price}`);
  console.log(`  Down outcome: ${mkt.outcome2Id} (${mkt.outcome2Label}) price=${mkt.outcome2Price}`);
  
  // 2. Test order placement (smallest possible amount to understand the API)
  console.log("\n=== Testing Order Placement (discovery) ===\n");
  
  const orderPath = `/v1/pm/events/${targetEvent.id}/markets/${mkt.id}/orders`;
  
  // Based on the existing order in history: MARKET order, BUY side, FOK
  // Try with the minimum amount to discover validation rules
  const testPayloads = [
    // Most likely based on order history
    { outcomeId: mkt.outcome1Id, side: "BUY", type: "MARKET", amount: 0.01, currency: "USD", timeInForce: "FOK" },
    { outcomeId: mkt.outcome1Id, side: "BUY", type: "MARKET", amount: 1, currency: "USD" },
    { outcomeId: mkt.outcome1Id, side: "BUY", type: "LIMIT", amount: 1, price: 0.5, currency: "USD", timeInForce: "GTC" },
    { outcomeId: mkt.outcome1Id, side: "BUY", type: "MARKET", amount: 1 },
  ];

  for (const body of testPayloads) {
    const bodyStr = JSON.stringify(body);
    const h = sign("POST", orderPath, bodyStr);
    try {
      const r = await axios.post(`${BASE}${orderPath}`, body, { headers: h, timeout: 10000 });
      console.log(`✅ PLACED! ${JSON.stringify(r.data, null, 2)}`);
      console.log(`\n  ★ WORKING PAYLOAD: ${bodyStr}\n`);
      break; // Stop — we actually placed an order
    } catch (e) {
      const status = e.response?.status;
      const errData = e.response?.data;
      console.log(`${status} ${JSON.stringify(body)}`);
      console.log(`  → ${JSON.stringify(errData).substring(0, 400)}\n`);
    }
  }

  // 3. Check wallet / balance
  console.log("=== Wallet/Balance ===\n");
  for (const p of ["/v1/user/me/wallets", "/v1/user/me/wallet", "/v1/user/me/balance", "/v1/pm/wallet", "/v1/wallet", "/v1/wallets"]) {
    try {
      const h = sign("GET", p);
      const r = await axios.get(`${BASE}${p}`, { headers: h, timeout: 10000 });
      console.log(`✅ GET ${p}: ${JSON.stringify(r.data).substring(0, 600)}`);
    } catch (e) {
      if (e.response?.status !== 404) {
        console.log(`${e.response?.status} ${p}: ${JSON.stringify(e.response?.data || e.message).substring(0, 150)}`);
      }
    }
  }
}

run().catch(e => { console.error("Fatal:", e.response?.data || e.message); process.exit(1); });
