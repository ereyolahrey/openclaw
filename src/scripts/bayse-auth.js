require("dotenv").config();
const axios = require("axios");
const readline = require("readline");
const fs = require("fs");
const path = require("path");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));
const BASE = process.env.BAYSE_API_BASE_URL || "https://api.bayse.markets";
const EMAIL = process.env.BAYSE_EMAIL || "lostmyfaith123@gmail.com";
const discovered = {};

async function probe(method, url, data, headers = {}) {
  try {
    const cfg = { method, url, headers: { "Content-Type": "application/json", ...headers }, timeout: 10000 };
    if (data && method !== "GET") cfg.data = data;
    if (data && method === "GET") cfg.params = data;
    const r = await axios(cfg);
    return { s: r.status, d: r.data, ok: true };
  } catch (e) {
    return { s: e.response?.status || 0, d: e.response?.data, ok: false, err: e.message };
  }
}

async function main() {
  console.log("\n========================================");
  console.log("  BAYSE MARKETS — AUTO AUTH & API SETUP");
  console.log("========================================\n");
  console.log(`  Base: ${BASE}`);
  console.log(`  Email: ${EMAIL}\n`);

  // 1. Discover docs & OpenAPI spec
  console.log("--- Discovering API structure ---\n");
  const docPaths = ["/docs", "/api-docs", "/swagger", "/openapi.json", "/swagger.json", "/v1/openapi.json", "/redoc", "/reference"];
  for (const p of docPaths) {
    const r = await probe("GET", `${BASE}${p}`);
    if (r.ok) {
      console.log(`  [OK] ${p} -> ${r.s}`);
      if (p.includes("openapi") || p.includes("swagger.json")) {
        discovered.spec = r.d;
        fs.writeFileSync(path.join(__dirname, "../../bayse-openapi.json"), JSON.stringify(r.d, null, 2));
        console.log("     Spec saved to bayse-openapi.json");
      }
    }
  }

  for (const sp of ["https://docs.bayse.markets/openapi.json", "https://docs.bayse.markets/swagger.json", "https://docs.bayse.markets/api.json"]) {
    const r = await probe("GET", sp);
    if (r.ok && typeof r.d === "object" && r.d.paths) {
      discovered.spec = r.d;
      fs.writeFileSync(path.join(__dirname, "../../bayse-openapi.json"), JSON.stringify(r.d, null, 2));
      console.log(`  [OK] Spec from ${sp}`);
    }
  }

  if (discovered.spec?.paths) {
    console.log("\n  API Endpoints:");
    for (const [p, methods] of Object.entries(discovered.spec.paths)) {
      console.log(`    ${Object.keys(methods).map(m => m.toUpperCase()).join(",")} ${p}`);
    }
  }

  // 2. Probe auth endpoints
  console.log("\n--- Finding auth endpoints ---\n");
  const bases = ["", "/v1", "/api", "/api/v1"];
  const authPaths = ["/auth/login", "/auth/signin", "/auth/email", "/login", "/auth/request-otp", "/auth/magic-link", "/auth/register"];
  for (const b of bases) {
    for (const ap of authPaths) {
      const r = await probe("POST", `${BASE}${b}${ap}`, { email: EMAIL });
      if (r.s !== 404 && r.s !== 0) {
        console.log(`  [${r.s}] POST ${b}${ap}: ${JSON.stringify(r.d).substring(0, 150)}`);
        if (!discovered.auth) discovered.auth = `${b}${ap}`;
      }
    }
  }

  if (!discovered.auth) {
    console.log("  No auth endpoint found automatically.");
    const manual = await ask("  Enter auth endpoint (e.g. /auth/login) or press Enter to skip: ");
    if (manual.trim()) discovered.auth = manual.trim();
  }

  // 3. Authenticate
  let token = null;
  if (discovered.auth) {
    console.log(`\n--- Authenticating via ${discovered.auth} ---\n`);
    const loginRes = await probe("POST", `${BASE}${discovered.auth}`, { email: EMAIL });
    console.log(`  Response [${loginRes.s}]: ${JSON.stringify(loginRes.d, null, 2)}`);

    token = loginRes.d?.token || loginRes.d?.accessToken || loginRes.d?.data?.token || loginRes.d?.access_token;

    if (!token && (loginRes.ok || loginRes.s === 200 || loginRes.s === 201)) {
      console.log("\n  Check your email for a verification code.\n");
      const code = await ask("  Enter OTP/code: ");

      const verifyPaths = ["/auth/verify", "/auth/verify-otp", "/auth/confirm", "/auth/callback"];
      for (const b of bases) {
        for (const vp of verifyPaths) {
          for (const payload of [
            { email: EMAIL, code: code.trim() },
            { email: EMAIL, otp: code.trim() },
            { email: EMAIL, token: code.trim() },
          ]) {
            const vr = await probe("POST", `${BASE}${b}${vp}`, payload);
            if (vr.s !== 404 && vr.s !== 0) {
              console.log(`  [${vr.s}] POST ${b}${vp}: ${JSON.stringify(vr.d).substring(0, 150)}`);
              const t = vr.d?.token || vr.d?.accessToken || vr.d?.data?.token || vr.d?.access_token;
              if (t) { token = t; discovered.verify = `${b}${vp}`; break; }
            }
          }
          if (token) break;
        }
        if (token) break;
      }
    }
  }

  if (token) console.log(`\n  AUTH TOKEN: ${token.substring(0, 30)}...\n`);
  else console.log("\n  No token obtained. Continuing with market discovery.\n");

  // 4. API Key generation
  if (token) {
    console.log("--- Generating API Key ---\n");
    const h = { Authorization: `Bearer ${token}` };
    const keyPaths = ["/api-keys", "/v1/api-keys", "/auth/api-keys", "/user/api-keys", "/settings/api-keys"];
    for (const b of bases) {
      for (const kp of keyPaths) {
        const r = await probe("GET", `${BASE}${b}${kp}`, null, h);
        if (r.s !== 404 && r.s !== 0) {
          console.log(`  [${r.s}] GET ${b}${kp}: ${JSON.stringify(r.d).substring(0, 200)}`);
          discovered.apiKeys = `${b}${kp}`;

          for (const body of [
            { name: "openclaw-trader", permissions: ["trade:read", "trade:write", "market:read"] },
            { name: "openclaw-trader" },
            { label: "openclaw-trader" },
          ]) {
            const cr = await probe("POST", `${BASE}${b}${kp}`, body, h);
            if (cr.ok || cr.s === 201) {
              console.log(`  Key created: ${JSON.stringify(cr.d)}`);
              discovered.apiKey = cr.d?.apiKey || cr.d?.key || cr.d?.data?.apiKey;
              discovered.apiSecret = cr.d?.apiSecret || cr.d?.secret || cr.d?.data?.apiSecret;
              break;
            }
          }
          if (discovered.apiKey) break;
        }
      }
      if (discovered.apiKey) break;
    }
  }

  // 5. Discover market & trade endpoints
  console.log("\n--- Discovering market/trade endpoints ---\n");
  const authH = token ? { Authorization: `Bearer ${token}` } : {};
  const marketPaths = ["/markets", "/v1/markets", "/market/candles", "/v1/market/candles", "/markets/btc", "/v1/markets/btc",
    "/markets/active", "/v1/markets/active", "/markets/predictions", "/v1/markets/predictions", "/candles", "/v1/candles",
    "/markets/btc/15m", "/v1/markets/btc/15m", "/prices", "/v1/prices"];

  for (const mp of marketPaths) {
    const r = await probe("GET", `${BASE}${mp}`, null, authH);
    if (r.s !== 404 && r.s !== 0) {
      console.log(`  [${r.s}] GET ${mp}: ${JSON.stringify(r.d).substring(0, 250)}`);
      if (!discovered.markets) discovered.markets = mp;
    }
  }

  const tradePaths = ["/trade", "/v1/trade", "/trade/predict", "/v1/trade/predict", "/predictions", "/v1/predictions",
    "/predictions/place", "/v1/predictions/place", "/markets/predict", "/v1/markets/predict", "/positions", "/v1/positions",
    "/bets", "/v1/bets", "/orders", "/v1/orders"];

  for (const tp of tradePaths) {
    const r = await probe("GET", `${BASE}${tp}`, null, authH);
    if (r.s !== 404 && r.s !== 0) {
      console.log(`  [${r.s}] GET ${tp}: ${JSON.stringify(r.d).substring(0, 250)}`);
      if (!discovered.trade) discovered.trade = tp;
    }
  }

  // 6. Save config
  console.log("\n--- Saving configuration ---\n");
  const config = { discoveredAt: new Date().toISOString(), baseUrl: BASE, endpoints: discovered };
  fs.writeFileSync(path.join(__dirname, "../../bayse-config.json"), JSON.stringify(config, null, 2));
  console.log("  Saved to bayse-config.json\n");

  console.log("  ================================");
  console.log("  .env values to use:");
  console.log("  ================================");
  if (token) console.log(`  BAYSE_AUTH_TOKEN=${token}`);
  if (discovered.apiKey) console.log(`  BAYSE_API_KEY=${discovered.apiKey}`);
  if (discovered.apiSecret) console.log(`  BAYSE_API_SECRET=${discovered.apiSecret}`);
  console.log(`  BAYSE_API_BASE_URL=${BASE}`);
  if (discovered.markets) console.log(`  # Markets endpoint: ${discovered.markets}`);
  if (discovered.trade) console.log(`  # Trade endpoint: ${discovered.trade}`);
  console.log("  ================================\n");

  rl.close();
}

main().catch((e) => { console.error("Fatal:", e); rl.close(); process.exit(1); });
