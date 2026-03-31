require("dotenv").config();
const axios = require("axios");
const crypto = require("crypto");

const BASE = process.env.BAYSE_API_BASE_URL;
const PUBLIC_KEY = process.env.BAYSE_PUBLIC_KEY;
const SECRET_KEY = process.env.BAYSE_SECRET_KEY;

function sign(method, path, rawBody) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  // For POST: hash the exact raw body string. For GET: hash empty string.
  const bodyStr = rawBody || "";
  const bodyHash = crypto.createHash("sha256").update(bodyStr).digest("hex");
  const payload = `${timestamp}.${method.toUpperCase()}.${path}.${bodyHash}`;
  const signature = crypto.createHmac("sha256", SECRET_KEY).update(payload).digest("hex");
  
  return {
    headers: {
      "X-Public-Key": PUBLIC_KEY,
      "X-Timestamp": timestamp,
      "X-Signature": signature,
      "Content-Type": "application/json",
    },
    rawBody: bodyStr,
    debug: { timestamp, payload: payload.substring(0, 100), bodyHash: bodyHash.substring(0, 16) }
  };
}

async function run() {
  console.log("=== Fixing HMAC Signature for POST ===\n");
  
  // First get the current BTC 15min event
  const evPath = "/v1/pm/events";
  const evSign = sign("GET", evPath);
  const evRes = await axios.get(`${BASE}${evPath}`, { headers: evSign.headers, params: { limit: 200 }, timeout: 15000 });
  const events = evRes.data.events || [];
  const btc15 = events.filter(e => e.assetSymbolPair === "BTCUSDT" && e.countdownType === "FIFTEEN_MINUTES" && e.status === "open");
  
  if (btc15.length === 0) {
    console.log("No open BTC 15min event. Waiting for next one...");
    return;
  }
  
  const ev = btc15[0];
  const mkt = ev.markets[0];
  console.log(`Event: ${ev.title} | Threshold: $${ev.eventThreshold}`);
  console.log(`Market: ${mkt.id}`);
  console.log(`Up: ${mkt.outcome1Id} price=${mkt.outcome1Price}`);
  console.log(`Down: ${mkt.outcome2Id} price=${mkt.outcome2Price}`);
  console.log(`Closes: ${ev.closingDate}\n`);
  
  const orderPath = `/v1/pm/events/${ev.id}/markets/${mkt.id}/orders`;
  
  // The exact body as a string — this is what we hash AND send
  const orderBody = {
    outcomeId: mkt.outcome1Id,
    side: "BUY",
    type: "MARKET",
    amount: 1,
    currency: "USD",
    timeInForce: "FOK"
  };
  
  // Approach 1: Standard JSON.stringify
  const rawBody1 = JSON.stringify(orderBody);
  const s1 = sign("POST", orderPath, rawBody1);
  console.log(`Approach 1 — Standard JSON.stringify`);
  console.log(`  Body: ${rawBody1}`);
  console.log(`  Debug: ${JSON.stringify(s1.debug)}`);
  try {
    const r = await axios({
      method: "POST",
      url: `${BASE}${orderPath}`,
      headers: s1.headers,
      data: rawBody1, // Send raw string, not object
      timeout: 10000,
    });
    console.log(`  ✅ ${JSON.stringify(r.data)}\n`);
  } catch (e) {
    console.log(`  ❌ ${e.response?.status}: ${JSON.stringify(e.response?.data)}\n`);
  }

  // Approach 2: Try without the trailing path slash / different path encoding
  // Maybe the path includes the full URL path
  const orderPath2 = `/v1/pm/events/${ev.id}/markets/${mkt.id}/orders`;
  const rawBody2 = JSON.stringify(orderBody);
  const s2 = sign("POST", orderPath2, rawBody2);
  
  // Approach 3: Maybe bodyHash should be of the object, not the JSON string
  // Try hashing empty body for POST like GET
  console.log("Approach 3 — Empty body hash for POST");
  const s3 = sign("POST", orderPath, "");
  try {
    const r = await axios({
      method: "POST",
      url: `${BASE}${orderPath}`,
      headers: s3.headers,
      data: orderBody,
      timeout: 10000,
    });
    console.log(`  ✅ ${JSON.stringify(r.data)}\n`);
  } catch (e) {
    console.log(`  ❌ ${e.response?.status}: ${JSON.stringify(e.response?.data)}\n`);
  }

  // Approach 4: Maybe the method should be lowercase
  console.log("Approach 4 — lowercase method in signature");
  {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const bodyHash = crypto.createHash("sha256").update(rawBody1).digest("hex");
    const payload = `${timestamp}.post.${orderPath}.${bodyHash}`;
    const signature = crypto.createHmac("sha256", SECRET_KEY).update(payload).digest("hex");
    try {
      const r = await axios({
        method: "POST",
        url: `${BASE}${orderPath}`,
        headers: { "X-Public-Key": PUBLIC_KEY, "X-Timestamp": timestamp, "X-Signature": signature, "Content-Type": "application/json" },
        data: rawBody1,
        timeout: 10000,
      });
      console.log(`  ✅ ${JSON.stringify(r.data)}\n`);
    } catch (e) {
      console.log(`  ❌ ${e.response?.status}: ${JSON.stringify(e.response?.data)}\n`);
    }
  }

  // Approach 5: Maybe body hash should be hex of raw SHA256 without updating empty
  // Or maybe the hash is of just the body keys sorted
  console.log("Approach 5 — Sorted keys JSON");
  {
    const sortedBody = JSON.stringify(orderBody, Object.keys(orderBody).sort());
    const s5 = sign("POST", orderPath, sortedBody);
    try {
      const r = await axios({
        method: "POST",
        url: `${BASE}${orderPath}`,
        headers: s5.headers,
        data: sortedBody,
        timeout: 10000,
      });
      console.log(`  ✅ ${JSON.stringify(r.data)}\n`);
    } catch (e) {
      console.log(`  ❌ ${e.response?.status}: ${JSON.stringify(e.response?.data)}\n`);
    }
  }

  // Approach 6: Try using session token auth instead of API key
  console.log("Approach 6 — Session auth (login + token)");
  try {
    const loginRes = await axios.post(`${BASE}/v1/user/login`, {
      email: process.env.BAYSE_EMAIL,
      password: process.argv[2] || "12Bayse..",
    }, { timeout: 10000 });
    
    const token = loginRes.data.token;
    const deviceId = loginRes.data.deviceId;
    console.log(`  Logged in, token: ${token.substring(0, 30)}...`);
    
    const r = await axios.post(`${BASE}${orderPath}`, orderBody, {
      headers: {
        "Content-Type": "application/json",
        "x-auth-token": token,
        "x-device-id": deviceId,
      },
      timeout: 10000,
    });
    console.log(`  ✅ ${JSON.stringify(r.data, null, 2)}\n`);
  } catch (e) {
    console.log(`  ${e.response?.status}: ${JSON.stringify(e.response?.data).substring(0, 300)}\n`);
  }
}

run().catch(e => { console.error("Fatal:", e.response?.data || e.message); process.exit(1); });
