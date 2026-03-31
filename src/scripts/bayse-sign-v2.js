require("dotenv").config();
const axios = require("axios");
const crypto = require("crypto");

const BASE = process.env.BAYSE_API_BASE_URL;
const PK = process.env.BAYSE_PUBLIC_KEY;
const SK = process.env.BAYSE_SECRET_KEY;

async function getEvent() {
  const ts = Math.floor(Date.now() / 1000).toString();
  const bh = crypto.createHash("sha256").update("").digest("hex");
  const sig = crypto.createHmac("sha256", SK).update(`${ts}.GET./v1/pm/events.${bh}`).digest("hex");
  const r = await axios.get(`${BASE}/v1/pm/events`, {
    headers: { "X-Public-Key": PK, "X-Timestamp": ts, "X-Signature": sig },
    params: { limit: 200 }, timeout: 15000,
  });
  return (r.data.events || []).find(e => 
    e.assetSymbolPair === "BTCUSDT" && e.countdownType === "FIFTEEN_MINUTES" && e.status === "open"
  );
}

async function attempt(label, orderPath, body, signFn) {
  const { headers } = signFn(orderPath, body);
  try {
    const r = await axios.post(`${BASE}${orderPath}`, body ? JSON.stringify(body) : undefined, { headers, timeout: 10000 });
    console.log(`✅ [${label}] ${r.status}: ${JSON.stringify(r.data).substring(0, 400)}`);
    return true;
  } catch (e) {
    const msg = JSON.stringify(e.response?.data || e.message).substring(0, 200);
    console.log(`❌ [${label}] ${e.response?.status}: ${msg}`);
    return false;
  }
}

async function run() {
  console.log("=== Bayse POST Signing Variations (API-key only, no login) ===\n");
  
  const ev = await getEvent();
  if (!ev) { console.log("No open BTC 15min event right now."); return; }
  
  const mkt = ev.markets[0];
  const orderPath = `/v1/pm/events/${ev.id}/markets/${mkt.id}/orders`;
  const body = { outcomeId: mkt.outcome1Id, side: "BUY", type: "MARKET", amount: 1, currency: "USD", timeInForce: "FOK" };
  
  console.log(`Event: ${ev.title} closes=${ev.closingDate}`);
  console.log(`Path: ${orderPath}\n`);

  const variations = [
    // v1: timestamp.POST.path.sha256hex(body)
    { label: "POST-hex-bodyhash", fn: (path, b) => {
      const ts = Math.floor(Date.now() / 1000).toString();
      const raw = JSON.stringify(b);
      const bh = crypto.createHash("sha256").update(raw).digest("hex");
      const sig = crypto.createHmac("sha256", SK).update(`${ts}.POST.${path}.${bh}`).digest("hex");
      return { headers: { "X-Public-Key": PK, "X-Timestamp": ts, "X-Signature": sig, "Content-Type": "application/json" } };
    }},
    // v2: millisecond timestamp
    { label: "ms-timestamp", fn: (path, b) => {
      const ts = Date.now().toString();
      const raw = JSON.stringify(b);
      const bh = crypto.createHash("sha256").update(raw).digest("hex");
      const sig = crypto.createHmac("sha256", SK).update(`${ts}.POST.${path}.${bh}`).digest("hex");
      return { headers: { "X-Public-Key": PK, "X-Timestamp": ts, "X-Signature": sig, "Content-Type": "application/json" } };
    }},
    // v3: no body hash
    { label: "no-bodyhash", fn: (path, b) => {
      const ts = Math.floor(Date.now() / 1000).toString();
      const sig = crypto.createHmac("sha256", SK).update(`${ts}.POST.${path}`).digest("hex");
      return { headers: { "X-Public-Key": PK, "X-Timestamp": ts, "X-Signature": sig, "Content-Type": "application/json" } };
    }},
    // v4: path without leading slash
    { label: "no-leading-slash", fn: (path, b) => {
      const ts = Math.floor(Date.now() / 1000).toString();
      const raw = JSON.stringify(b);
      const bh = crypto.createHash("sha256").update(raw).digest("hex");
      const noSlash = path.startsWith("/") ? path.substring(1) : path;
      const sig = crypto.createHmac("sha256", SK).update(`${ts}.POST.${noSlash}.${bh}`).digest("hex");
      return { headers: { "X-Public-Key": PK, "X-Timestamp": ts, "X-Signature": sig, "Content-Type": "application/json" } };
    }},
    // v5: base64 sig  
    { label: "base64-sig", fn: (path, b) => {
      const ts = Math.floor(Date.now() / 1000).toString();
      const raw = JSON.stringify(b);
      const bh = crypto.createHash("sha256").update(raw).digest("hex");
      const sig = crypto.createHmac("sha256", SK).update(`${ts}.POST.${path}.${bh}`).digest("base64");
      return { headers: { "X-Public-Key": PK, "X-Timestamp": ts, "X-Signature": sig, "Content-Type": "application/json" } };
    }},
    // v6: base64 body hash
    { label: "base64-bodyhash", fn: (path, b) => {
      const ts = Math.floor(Date.now() / 1000).toString();
      const raw = JSON.stringify(b);
      const bh = crypto.createHash("sha256").update(raw).digest("base64");
      const sig = crypto.createHmac("sha256", SK).update(`${ts}.POST.${path}.${bh}`).digest("hex");
      return { headers: { "X-Public-Key": PK, "X-Timestamp": ts, "X-Signature": sig, "Content-Type": "application/json" } };
    }},
    // v7: empty body hash (like GET)
    { label: "empty-bodyhash", fn: (path, b) => {
      const ts = Math.floor(Date.now() / 1000).toString();
      const bh = crypto.createHash("sha256").update("").digest("hex");
      const sig = crypto.createHmac("sha256", SK).update(`${ts}.POST.${path}.${bh}`).digest("hex");
      return { headers: { "X-Public-Key": PK, "X-Timestamp": ts, "X-Signature": sig, "Content-Type": "application/json" } };
    }},
    // v8: body hash of "{}" empty object
    { label: "empty-obj-bodyhash", fn: (path, b) => {
      const ts = Math.floor(Date.now() / 1000).toString();
      const bh = crypto.createHash("sha256").update("{}").digest("hex");
      const sig = crypto.createHmac("sha256", SK).update(`${ts}.POST.${path}.${bh}`).digest("hex");
      return { headers: { "X-Public-Key": PK, "X-Timestamp": ts, "X-Signature": sig, "Content-Type": "application/json" } };
    }},
    // v9: lowercase method
    { label: "lowercase-method", fn: (path, b) => {
      const ts = Math.floor(Date.now() / 1000).toString();
      const raw = JSON.stringify(b);
      const bh = crypto.createHash("sha256").update(raw).digest("hex");
      const sig = crypto.createHmac("sha256", SK).update(`${ts}.post.${path}.${bh}`).digest("hex");
      return { headers: { "X-Public-Key": PK, "X-Timestamp": ts, "X-Signature": sig, "Content-Type": "application/json" } };
    }},
    // v10: X-Public-Key only (no signing)
    { label: "pk-only-no-sig", fn: (path, b) => {
      return { headers: { "X-Public-Key": PK, "Content-Type": "application/json" } };
    }},
    // v11: full URL as path
    { label: "full-url-path", fn: (path, b) => {
      const ts = Math.floor(Date.now() / 1000).toString();
      const raw = JSON.stringify(b);
      const bh = crypto.createHash("sha256").update(raw).digest("hex");
      const fullPath = `${BASE}${path}`;
      const sig = crypto.createHmac("sha256", SK).update(`${ts}.POST.${fullPath}.${bh}`).digest("hex");
      return { headers: { "X-Public-Key": PK, "X-Timestamp": ts, "X-Signature": sig, "Content-Type": "application/json" } };
    }},
    // v12: SHA256 of body as raw bytes
    { label: "body-buffer-hash", fn: (path, b) => {
      const ts = Math.floor(Date.now() / 1000).toString();
      const raw = Buffer.from(JSON.stringify(b), "utf8");
      const bh = crypto.createHash("sha256").update(raw).digest("hex");
      const sig = crypto.createHmac("sha256", SK).update(`${ts}.POST.${path}.${bh}`).digest("hex");
      return { headers: { "X-Public-Key": PK, "X-Timestamp": ts, "X-Signature": sig, "Content-Type": "application/json" } };
    }},
  ];

  for (const v of variations) {
    const ok = await attempt(v.label, orderPath, body, v.fn);
    if (ok) {
      console.log(`\n★★★ WORKING: ${v.label} ★★★\n`);
      break;
    }
  }
}

run().catch(e => { console.error("Fatal:", e.response?.data || e.message); process.exit(1); });
