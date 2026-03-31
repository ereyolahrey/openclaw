require("dotenv").config();
const axios = require("axios");
const crypto = require("crypto");

const BASE = "https://relay.bayse.markets";
const EMAIL = "lostmyfaith123@gmail.com";
const PASSWORD = process.argv[2] || "";

async function login() {
  console.log("=== Bayse Markets Login ===\n");

  // Generate a device ID
  const deviceId = crypto.randomUUID();
  console.log(`Device ID: ${deviceId}`);

  // Try login
  console.log(`\nLogging in as ${EMAIL}...\n`);

  const loginPayloads = [
    { email: EMAIL, password: PASSWORD },
    { email: EMAIL, password: PASSWORD, deviceId },
    { identifier: EMAIL, password: PASSWORD },
    { username: EMAIL, password: PASSWORD },
  ];

  const loginEndpoints = [
    "/v1/user/login",
    "/v1/auth/login",
    "/auth/login",
    "/v1/user/signin",
  ];

  for (const ep of loginEndpoints) {
    for (const payload of loginPayloads) {
      try {
        console.log(`  POST ${ep} ...`);
        const res = await axios.post(`${BASE}${ep}`, payload, {
          headers: {
            "Content-Type": "application/json",
            "x-device-id": deviceId,
          },
          timeout: 15000,
        });

        console.log(`  ✅ ${res.status}: ${JSON.stringify(res.data).substring(0, 500)}\n`);

        // Extract token
        const token = res.data?.token || res.data?.accessToken || res.data?.data?.token 
          || res.data?.data?.accessToken || res.data?.authToken || res.data?.data?.authToken
          || res.headers?.["x-auth-token"];

        const user = res.data?.user || res.data?.data?.user || res.data?.data;

        if (token || res.data) {
          console.log("\n══════════════════════════════════════");
          console.log("LOGIN SUCCESSFUL");
          console.log("══════════════════════════════════════\n");
          
          if (token) console.log(`AUTH_TOKEN=${token}`);
          console.log(`DEVICE_ID=${deviceId}`);
          
          if (user) {
            console.log(`\nUser data: ${JSON.stringify(user, null, 2).substring(0, 1000)}`);
          }

          // Full response for debugging
          console.log(`\nFull response headers: ${JSON.stringify(res.headers, null, 2)}`);
          console.log(`\nFull response body: ${JSON.stringify(res.data, null, 2).substring(0, 2000)}`);

          // Now try to get API keys
          console.log("\n\n=== Checking API Keys ===\n");
          const authHeaders = {};
          if (token) {
            authHeaders["x-auth-token"] = token;
            authHeaders["Authorization"] = `Bearer ${token}`;
          }
          authHeaders["x-device-id"] = deviceId;

          for (const keyEp of ["/v1/user/me/api-keys", "/v1/user/api-keys", "/v1/api-keys"]) {
            try {
              const kr = await axios.get(`${BASE}${keyEp}`, { headers: authHeaders, timeout: 10000 });
              console.log(`  ✅ GET ${keyEp} → ${kr.status}: ${JSON.stringify(kr.data).substring(0, 500)}`);
            } catch (ke) {
              console.log(`  ${ke.response?.status || "ERR"} GET ${keyEp}: ${JSON.stringify(ke.response?.data || ke.message).substring(0, 200)}`);
            }
          }

          // Try to create an API key
          console.log("\n=== Creating API Key ===\n");
          for (const keyEp of ["/v1/user/me/api-keys", "/v1/user/api-keys", "/v1/api-keys"]) {
            for (const body of [
              { name: "openclaw-trader" },
              { label: "openclaw-trader" },
              { name: "openclaw-trader", permissions: ["trade", "read"] },
            ]) {
              try {
                const cr = await axios.post(`${BASE}${keyEp}`, body, { headers: authHeaders, timeout: 10000 });
                console.log(`  ✅ POST ${keyEp} → ${cr.status}: ${JSON.stringify(cr.data).substring(0, 500)}`);
              } catch (ce) {
                if (ce.response?.status !== 404) {
                  console.log(`  ${ce.response?.status || "ERR"} POST ${keyEp}: ${JSON.stringify(ce.response?.data || ce.message).substring(0, 200)}`);
                }
              }
            }
          }

          // Try to get user profile / balance
          console.log("\n=== User Profile & Balance ===\n");
          for (const profileEp of ["/v1/user/me", "/v1/user/profile", "/v1/user/balance", "/v1/pm/portfolio", "/v1/pm/activities"]) {
            try {
              const pr = await axios.get(`${BASE}${profileEp}`, { headers: authHeaders, timeout: 10000 });
              console.log(`  ✅ GET ${profileEp} → ${pr.status}: ${JSON.stringify(pr.data).substring(0, 500)}`);
            } catch (pe) {
              if (pe.response?.status !== 404) {
                console.log(`  ${pe.response?.status || "ERR"} GET ${profileEp}: ${JSON.stringify(pe.response?.data || pe.message).substring(0, 200)}`);
              }
            }
          }

          // Get current BTC 15min events
          console.log("\n=== Current BTC 15min Events ===\n");
          try {
            const evRes = await axios.get(`${BASE}/v1/pm/events`, {
              params: { category: "CRYPTO", status: "open" },
              headers: authHeaders,
              timeout: 15000,
            });
            const events = evRes.data?.data || evRes.data || [];
            const btcEvents = (Array.isArray(events) ? events : []).filter(
              (e) => e.assetSymbolPair === "BTCUSDT" && e.countdownType === "FIFTEEN_MINUTES"
            );
            console.log(`  Found ${btcEvents.length} BTC 15min events`);
            if (btcEvents.length > 0) {
              const ev = btcEvents[0];
              console.log(`\n  Latest BTC 15min event:`);
              console.log(`    ID: ${ev.id}`);
              console.log(`    Threshold: $${ev.eventThreshold}`);
              console.log(`    Opens: ${ev.openingDate}`);
              console.log(`    Closes: ${ev.closingDate}`);
              console.log(`    Status: ${ev.status}`);
              if (ev.markets?.[0]) {
                const m = ev.markets[0];
                console.log(`    Market ID: ${m.id}`);
                console.log(`    Up price: ${m.outcome1Price}`);
                console.log(`    Down price: ${m.outcome2Price}`);
                console.log(`    Up outcome ID: ${m.outcome1Id}`);
                console.log(`    Down outcome ID: ${m.outcome2Id}`);
              }
            }
          } catch (ee) {
            console.log(`  Events error: ${ee.response?.status} ${JSON.stringify(ee.response?.data || ee.message).substring(0, 300)}`);
          }

          return;
        }
      } catch (err) {
        const s = err.response?.status || 0;
        const d = err.response?.data;
        if (s !== 404) {
          console.log(`  ${s}: ${JSON.stringify(d || err.message).substring(0, 200)}`);
        }
      }
    }
  }

  console.log("\n❌ All login attempts failed.");
}

login().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
