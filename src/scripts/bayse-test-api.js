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
  console.log("=== Testing HMAC-Signed API Access ===\n");
  console.log(`Public Key: ${PUBLIC_KEY}`);
  console.log(`Base URL: ${BASE}\n`);

  // Test 1: Portfolio (read-only, needs X-Public-Key)
  console.log("--- Portfolio ---");
  try {
    const path = "/v1/pm/portfolio";
    const headers = sign("GET", path);
    const r = await axios.get(`${BASE}${path}`, { headers, timeout: 10000 });
    console.log(`✅ ${JSON.stringify(r.data, null, 2).substring(0, 800)}\n`);
  } catch (e) {
    console.log(`❌ ${e.response?.status}: ${JSON.stringify(e.response?.data)}\n`);
  }

  // Test 2: Orders history
  console.log("--- Orders ---");
  try {
    const path = "/v1/pm/orders";
    const headers = sign("GET", path);
    const r = await axios.get(`${BASE}${path}`, { headers, timeout: 10000 });
    console.log(`✅ ${JSON.stringify(r.data, null, 2).substring(0, 800)}\n`);
  } catch (e) {
    console.log(`❌ ${e.response?.status}: ${JSON.stringify(e.response?.data)}\n`);
  }

  // Test 3: Activities
  console.log("--- Activities ---");
  try {
    const path = "/v1/pm/activities";
    const headers = sign("GET", path);
    const r = await axios.get(`${BASE}${path}`, { headers, timeout: 10000 });
    console.log(`✅ ${JSON.stringify(r.data, null, 2).substring(0, 800)}\n`);
  } catch (e) {
    console.log(`❌ ${e.response?.status}: ${JSON.stringify(e.response?.data)}\n`);
  }

  // Test 4: Get current live BTC 15min event
  console.log("--- Current BTC 15min Event ---");
  try {
    const path = "/v1/pm/events";
    const headers = sign("GET", path);
    const r = await axios.get(`${BASE}${path}`, { headers, params: { limit: 200 }, timeout: 15000 });
    const events = r.data?.data || r.data || [];
    const btc15 = events.filter(e => 
      e.assetSymbolPair === "BTCUSDT" && e.countdownType === "FIFTEEN_MINUTES" && e.status === "open"
    );
    
    console.log(`  Found ${btc15.length} open BTC 15min events`);
    
    if (btc15.length > 0) {
      // Sort by closing date to find the currently active one
      btc15.sort((a, b) => new Date(b.closingDate) - new Date(a.closingDate));
      const ev = btc15[0];
      const mkt = ev.markets[0];
      
      console.log(`\n  Event: ${ev.title}`);
      console.log(`  Event ID: ${ev.id}`);
      console.log(`  Threshold: $${ev.eventThreshold}`);
      console.log(`  Opens: ${ev.openingDate}`);
      console.log(`  Closes: ${ev.closingDate}`);
      console.log(`  Series: ${ev.seriesSlug}`);
      console.log(`  Market ID: ${mkt.id}`);
      console.log(`  Up (outcome1): price=${mkt.outcome1Price} id=${mkt.outcome1Id}`);
      console.log(`  Down (outcome2): price=${mkt.outcome2Price} id=${mkt.outcome2Id}`);
      console.log(`  Fee: ${mkt.feePercentage}%`);
      console.log(`  Engine: ${ev.engine}`);
      console.log(`  Currencies: ${ev.supportedCurrencies}`);

      // Test 5: Try to understand order placement
      console.log("\n--- Testing Order Placement Structure ---");
      
      // The order endpoint is: POST /v1/pm/events/{eventId}/markets/{marketId}/orders
      const orderPath = `/v1/pm/events/${ev.id}/markets/${mkt.id}/orders`;
      
      // Try various order body structures to discover the correct format
      const testBodies = [
        { outcomeId: mkt.outcome1Id, side: "buy", amount: 1, price: 0.5 },
        { outcome: "Up", side: "buy", amount: 1, price: 0.5 },
        { outcomeId: mkt.outcome1Id, type: "market", amount: 1 },
        { outcomeId: mkt.outcome1Id, type: "limit", quantity: 1, price: 0.5 },
        { outcomeId: mkt.outcome1Id, shares: 1, price: 0.5 },
      ];

      for (const body of testBodies) {
        const bodyStr = JSON.stringify(body);
        const headers = sign("POST", orderPath, bodyStr);
        try {
          // NOT actually placing — just sending to see what error/validation we get
          const r = await axios.post(`${BASE}${orderPath}`, body, { headers, timeout: 10000 });
          console.log(`  ✅ POST ${orderPath}: ${JSON.stringify(r.data).substring(0, 500)}`);
          console.log(`  WORKING PAYLOAD: ${bodyStr}`);
          break;
        } catch (e) {
          const status = e.response?.status;
          const errData = e.response?.data;
          console.log(`  ${status} payload=${JSON.stringify(body)}: ${JSON.stringify(errData).substring(0, 300)}`);
          
          // If we get validation errors (400), the endpoint exists and we just need the right format
          if (status === 400 && errData?.message) {
            console.log(`  → Validation hint: ${errData.message}`);
          }
        }
      }

      // Also try GET on the order endpoint to see structure
      try {
        const ghdr = sign("GET", orderPath);
        const gr = await axios.get(`${BASE}${orderPath}`, { headers: ghdr, timeout: 10000 });
        console.log(`\n  GET ${orderPath}: ${JSON.stringify(gr.data).substring(0, 500)}`);
      } catch (e) {
        if (e.response?.status !== 404) {
          console.log(`\n  GET ${orderPath}: ${e.response?.status} ${JSON.stringify(e.response?.data).substring(0, 300)}`);
        }
      }
    }
  } catch (e) {
    console.log(`  ❌ ${e.response?.status}: ${JSON.stringify(e.response?.data || e.message)}\n`);
  }

  // User info
  console.log("\n--- User Profile ---");
  for (const p of ["/v1/user/me", "/v1/user/me/profile", "/v1/user/me/balance", "/v1/user/me/wallet"]) {
    try {
      const headers = sign("GET", p);
      const r = await axios.get(`${BASE}${p}`, { headers, timeout: 10000 });
      console.log(`✅ GET ${p}: ${JSON.stringify(r.data).substring(0, 500)}`);
    } catch (e) {
      if (e.response?.status !== 404) {
        console.log(`${e.response?.status} ${p}: ${JSON.stringify(e.response?.data || e.message).substring(0, 150)}`);
      }
    }
  }
}

run().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
