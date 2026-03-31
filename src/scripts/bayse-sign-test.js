require("dotenv").config();
const axios = require("axios");
const crypto = require("crypto");

const BASE = process.env.BAYSE_API_BASE_URL;
const PK = process.env.BAYSE_PUBLIC_KEY;
const SK = process.env.BAYSE_SECRET_KEY;

async function getEvent() {
  const ts = Math.floor(Date.now() / 1000).toString();
  const bh = crypto.createHash("sha256").update("").digest("hex");
  const payload = `${ts}.GET./v1/pm/events.${bh}`;
  const sig = crypto.createHmac("sha256", SK).update(payload).digest("hex");
  
  const r = await axios.get(`${BASE}/v1/pm/events`, {
    headers: { "X-Public-Key": PK, "X-Timestamp": ts, "X-Signature": sig },
    params: { limit: 200 },
    timeout: 15000,
  });
  
  const btc = (r.data.events || []).filter(e => 
    e.assetSymbolPair === "BTCUSDT" && e.countdownType === "FIFTEEN_MINUTES" && e.status === "open"
  );
  return btc[0];
}

async function tryOrder(label, method, path, body, extraHeaders = {}) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const rawBody = body ? JSON.stringify(body) : "";
  const bh = crypto.createHash("sha256").update(rawBody).digest("hex");
  const signPayload = `${ts}.${method}.${path}.${bh}`;
  const sig = crypto.createHmac("sha256", SK).update(signPayload).digest("hex");

  const headers = {
    "X-Public-Key": PK,
    "X-Timestamp": ts,
    "X-Signature": sig,
    "Content-Type": "application/json",
    ...extraHeaders,
  };

  try {
    const r = await axios({ method, url: `${BASE}${path}`, headers, data: rawBody, timeout: 10000 });
    console.log(`✅ [${label}] ${r.status}: ${JSON.stringify(r.data).substring(0, 500)}`);
    return true;
  } catch (e) {
    console.log(`❌ [${label}] ${e.response?.status}: ${JSON.stringify(e.response?.data).substring(0, 200)}`);
    return false;
  }
}

async function run() {
  // Login first for session token
  const loginRes = await axios.post(`${BASE}/v1/user/login`, {
    email: process.env.BAYSE_EMAIL, password: "12Bayse..",
  }, { timeout: 10000 });
  const sessionToken = loginRes.data.token;
  const deviceId = loginRes.data.deviceId;
  console.log(`Session: ${sessionToken.substring(0, 30)}... device=${deviceId}\n`);

  const ev = await getEvent();
  if (!ev) { console.log("No open BTC 15min event"); return; }
  
  const mkt = ev.markets[0];
  const orderPath = `/v1/pm/events/${ev.id}/markets/${mkt.id}/orders`;
  const orderBody = { outcomeId: mkt.outcome1Id, side: "BUY", type: "MARKET", amount: 1, currency: "USD", timeInForce: "FOK" };
  
  console.log(`Event: ${ev.title} | closes ${ev.closingDate}`);
  console.log(`Path: ${orderPath}`);
  console.log(`Body: ${JSON.stringify(orderBody)}\n`);

  // --- Try many variations ---

  // V1: API key only, POST uppercase (baseline - already known to fail)
  await tryOrder("v1-POST-api-only", "POST", orderPath, orderBody);

  // V2: API key + session token
  await tryOrder("v2-api+session", "POST", orderPath, orderBody, {
    "x-auth-token": sessionToken,
    "x-device-id": deviceId,
  });

  // V3: Session token replaces Authorization header
  await tryOrder("v3-api+bearer", "POST", orderPath, orderBody, {
    "Authorization": `Bearer ${sessionToken}`,
  });

  // V4: Try without leading slash in path for signing
  {
    const ts = Math.floor(Date.now() / 1000).toString();
    const rawBody = JSON.stringify(orderBody);
    const pathNoSlash = orderPath.substring(1); // Remove leading /
    const bh = crypto.createHash("sha256").update(rawBody).digest("hex");
    const signPayload = `${ts}.POST.${pathNoSlash}.${bh}`;
    const sig = crypto.createHmac("sha256", SK).update(signPayload).digest("hex");
    try {
      const r = await axios.post(`${BASE}${orderPath}`, rawBody, {
        headers: { "X-Public-Key": PK, "X-Timestamp": ts, "X-Signature": sig, "Content-Type": "application/json" },
        timeout: 10000,
      });
      console.log(`✅ [v4-no-leading-slash] ${r.status}: ${JSON.stringify(r.data).substring(0, 300)}`);
    } catch (e) {
      console.log(`❌ [v4-no-leading-slash] ${e.response?.status}: ${JSON.stringify(e.response?.data).substring(0, 200)}`);
    }
  }

  // V5: Try millisecond timestamp instead of seconds
  {
    const ts = Date.now().toString();
    const rawBody = JSON.stringify(orderBody);
    const bh = crypto.createHash("sha256").update(rawBody).digest("hex");
    const signPayload = `${ts}.POST.${orderPath}.${bh}`;
    const sig = crypto.createHmac("sha256", SK).update(signPayload).digest("hex");
    try {
      const r = await axios.post(`${BASE}${orderPath}`, rawBody, {
        headers: { "X-Public-Key": PK, "X-Timestamp": ts, "X-Signature": sig, "Content-Type": "application/json" },
        timeout: 10000,
      });
      console.log(`✅ [v5-ms-timestamp] ${r.status}: ${JSON.stringify(r.data).substring(0, 300)}`);
    } catch (e) {
      console.log(`❌ [v5-ms-timestamp] ${e.response?.status}: ${JSON.stringify(e.response?.data).substring(0, 200)}`);
    }
  }

  // V6: Try base64 body hash instead of hex
  {
    const ts = Math.floor(Date.now() / 1000).toString();
    const rawBody = JSON.stringify(orderBody);
    const bh = crypto.createHash("sha256").update(rawBody).digest("base64");
    const signPayload = `${ts}.POST.${orderPath}.${bh}`;
    const sig = crypto.createHmac("sha256", SK).update(signPayload).digest("hex");
    try {
      const r = await axios.post(`${BASE}${orderPath}`, rawBody, {
        headers: { "X-Public-Key": PK, "X-Timestamp": ts, "X-Signature": sig, "Content-Type": "application/json" },
        timeout: 10000,
      });
      console.log(`✅ [v6-base64-hash] ${r.status}: ${JSON.stringify(r.data).substring(0, 300)}`);
    } catch (e) {
      console.log(`❌ [v6-base64-hash] ${e.response?.status}: ${JSON.stringify(e.response?.data).substring(0, 200)}`);
    }
  }

  // V7: Try with no body hash component (maybe POST signing is timestamp.method.path only)
  {
    const ts = Math.floor(Date.now() / 1000).toString();
    const signPayload = `${ts}.POST.${orderPath}`;
    const sig = crypto.createHmac("sha256", SK).update(signPayload).digest("hex");
    try {
      const r = await axios.post(`${BASE}${orderPath}`, orderBody, {
        headers: { "X-Public-Key": PK, "X-Timestamp": ts, "X-Signature": sig, "Content-Type": "application/json" },
        timeout: 10000,
      });
      console.log(`✅ [v7-no-bodyhash] ${r.status}: ${JSON.stringify(r.data).substring(0, 300)}`);
    } catch (e) {
      console.log(`❌ [v7-no-bodyhash] ${e.response?.status}: ${JSON.stringify(e.response?.data).substring(0, 200)}`);
    }
  }

  // V8: Try base64 signature instead of hex
  {
    const ts = Math.floor(Date.now() / 1000).toString();
    const rawBody = JSON.stringify(orderBody);
    const bh = crypto.createHash("sha256").update(rawBody).digest("hex");
    const signPayload = `${ts}.POST.${orderPath}.${bh}`;
    const sig = crypto.createHmac("sha256", SK).update(signPayload).digest("base64");
    try {
      const r = await axios.post(`${BASE}${orderPath}`, rawBody, {
        headers: { "X-Public-Key": PK, "X-Timestamp": ts, "X-Signature": sig, "Content-Type": "application/json" },
        timeout: 10000,
      });
      console.log(`✅ [v8-base64-sig] ${r.status}: ${JSON.stringify(r.data).substring(0, 300)}`);
    } catch (e) {
      console.log(`❌ [v8-base64-sig] ${e.response?.status}: ${JSON.stringify(e.response?.data).substring(0, 200)}`);
    }
  }

  // V9: Try with both session + api key, and api key just for X-Public-Key (no signing)  
  {
    try {
      const r = await axios.post(`${BASE}${orderPath}`, orderBody, {
        headers: {
          "Content-Type": "application/json",
          "X-Public-Key": PK,
          "x-auth-token": sessionToken,
          "x-device-id": deviceId,
        },
        timeout: 10000,
      });
      console.log(`✅ [v9-session+pk-nosig] ${r.status}: ${JSON.stringify(r.data).substring(0, 300)}`);
    } catch (e) {
      console.log(`❌ [v9-session+pk-nosig] ${e.response?.status}: ${JSON.stringify(e.response?.data).substring(0, 200)}`);
    }
  }

  // V10: Sign with the secret key used as utf-8 buffer
  {
    const ts = Math.floor(Date.now() / 1000).toString();
    const rawBody = JSON.stringify(orderBody);
    const bh = crypto.createHash("sha256").update(rawBody, "utf8").digest("hex");
    const signPayload = `${ts}.POST.${orderPath}.${bh}`;
    const sig = crypto.createHmac("sha256", Buffer.from(SK, "utf8")).update(signPayload, "utf8").digest("hex");
    try {
      const r = await axios.post(`${BASE}${orderPath}`, rawBody, {
        headers: { "X-Public-Key": PK, "X-Timestamp": ts, "X-Signature": sig, "Content-Type": "application/json" },
        timeout: 10000,
      });
      console.log(`✅ [v10-utf8-buffer] ${r.status}: ${JSON.stringify(r.data).substring(0, 300)}`);
    } catch (e) {
      console.log(`❌ [v10-utf8-buffer] ${e.response?.status}: ${JSON.stringify(e.response?.data).substring(0, 200)}`);
    }
  }
}

run().catch(e => { console.error("Fatal:", e.response?.data || e.message); process.exit(1); });
