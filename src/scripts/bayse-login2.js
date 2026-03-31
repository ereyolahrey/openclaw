require("dotenv").config();
const axios = require("axios");

const BASE = "https://relay.bayse.markets";
const EMAIL = "lostmyfaith123@gmail.com";
const PASSWORD = process.argv[2] || "";

async function run() {
  // Step 1: Login with correct device ID handling
  console.log("=== Step 1: Login ===\n");
  const loginRes = await axios.post(`${BASE}/v1/user/login`, 
    { email: EMAIL, password: PASSWORD },
    { headers: { "Content-Type": "application/json" }, timeout: 15000 }
  );
  
  const token = loginRes.data.token;
  const serverDeviceId = loginRes.data.deviceId;
  const userId = loginRes.data.userId;
  
  console.log(`Token: ${token.substring(0, 40)}...`);
  console.log(`Device ID (server): ${serverDeviceId}`);
  console.log(`User ID: ${userId}\n`);

  // Auth headers using server device ID
  const h = {
    "Content-Type": "application/json",
    "x-auth-token": token,
    "x-device-id": serverDeviceId,
  };

  // Step 2: Get/Create API keys
  console.log("=== Step 2: API Keys ===\n");
  
  try {
    const keysRes = await axios.get(`${BASE}/v1/user/me/api-keys`, { headers: h, timeout: 10000 });
    console.log(`Existing keys: ${JSON.stringify(keysRes.data, null, 2)}`);
  } catch (e) {
    console.log(`GET api-keys: ${e.response?.status} ${JSON.stringify(e.response?.data)}`);
  }

  // Create API key
  try {
    const createRes = await axios.post(`${BASE}/v1/user/me/api-keys`, 
      { name: "openclaw-trader" },
      { headers: h, timeout: 10000 }
    );
    console.log(`\nCreated API key: ${JSON.stringify(createRes.data, null, 2)}`);
  } catch (e) {
    console.log(`\nPOST api-keys: ${e.response?.status} ${JSON.stringify(e.response?.data)}`);
    
    // If rate limited, try other approaches
    if (e.response?.status === 429) {
      console.log("Rate limited — will use session auth (token) directly.");
    }
  }

  // Step 3: Profile / Balance
  console.log("\n=== Step 3: Profile & Balance ===\n");
  
  const profileEndpoints = [
    "/v1/user/me",
    "/v1/user/me/profile", 
    "/v1/user/me/balance",
    "/v1/user/me/wallet",
    "/v1/user/profile",
    "/v1/user/balance",
    "/v1/user/wallet",
  ];

  for (const ep of profileEndpoints) {
    try {
      const r = await axios.get(`${BASE}${ep}`, { headers: h, timeout: 10000 });
      console.log(`✅ GET ${ep}: ${JSON.stringify(r.data).substring(0, 600)}`);
    } catch (e) {
      if (e.response?.status !== 404) {
        console.log(`${e.response?.status || "ERR"} ${ep}: ${JSON.stringify(e.response?.data || e.message).substring(0, 150)}`);
      }
    }
  }

  // Step 4: Portfolio (with session auth)
  console.log("\n=== Step 4: Portfolio ===\n");
  for (const ep of ["/v1/pm/portfolio", "/v1/pm/activities", "/v1/pm/orders"]) {
    try {
      const r = await axios.get(`${BASE}${ep}`, { headers: h, timeout: 10000 });
      console.log(`✅ GET ${ep}: ${JSON.stringify(r.data).substring(0, 600)}`);
    } catch (e) {
      console.log(`${e.response?.status || "ERR"} ${ep}: ${JSON.stringify(e.response?.data || e.message).substring(0, 200)}`);
    }
  }

  // Step 5: Get BTC 15min events
  console.log("\n=== Step 5: BTC 15min Events ===\n");
  
  try {
    // Get all events, then filter
    const evRes = await axios.get(`${BASE}/v1/pm/events`, { 
      headers: h, 
      timeout: 15000,
      params: { limit: 50 }
    });
    
    const allEvents = evRes.data?.data || evRes.data?.events || evRes.data || [];
    console.log(`Total events returned: ${Array.isArray(allEvents) ? allEvents.length : "not array"}`);
    
    if (Array.isArray(allEvents)) {
      // Find BTC 15min events
      const btcEvents = allEvents.filter(e => 
        (e.assetSymbolPair === "BTCUSDT" || e.category === "CRYPTO" || (e.title && e.title.toLowerCase().includes("btc")))
        && (e.countdownType === "FIFTEEN_MINUTES" || e.countdownType === "15m")
      );
      
      console.log(`BTC 15min events: ${btcEvents.length}`);
      
      // Show the most recent one
      if (btcEvents.length > 0) {
        const latest = btcEvents.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
        console.log(`\nLatest BTC 15min event:`);
        console.log(JSON.stringify(latest, null, 2));
      }

      // Also list all crypto events
      const cryptoEvents = allEvents.filter(e => e.category === "CRYPTO" || e.assetSymbolPair?.includes("BTC"));
      console.log(`\nAll Crypto events: ${cryptoEvents.length}`);
      for (const ev of cryptoEvents.slice(0, 3)) {
        console.log(`  - ${ev.title || ev.description?.substring(0, 80)} [${ev.id}] status=${ev.status} countdown=${ev.countdownType}`);
        if (ev.markets?.[0]) {
          const m = ev.markets[0];
          console.log(`    Market: ${m.id} | Up=${m.outcome1Price} Down=${m.outcome2Price}`);
          console.log(`    Up ID: ${m.outcome1Id} | Down ID: ${m.outcome2Id}`);
        }
      }
    } else {
      // Maybe the response is structured differently
      console.log(`Response type: ${typeof allEvents}`);
      console.log(`Response keys: ${Object.keys(allEvents || {})}`);
      console.log(`Full: ${JSON.stringify(evRes.data).substring(0, 1000)}`);
    }
  } catch (e) {
    console.log(`Events error: ${e.response?.status} ${JSON.stringify(e.response?.data || e.message).substring(0, 500)}`);
  }

  // Step 6: Test placing an order (DRY RUN - just check the endpoint structure)
  console.log("\n=== Step 6: Order Endpoint Discovery ===\n");
  
  // Try to understand the order structure from the API
  const orderEndpoints = [
    "/v1/pm/orders",
    "/v1/pm/order",
    "/v1/pm/events/test/markets/test/orders",  // Will 404 but tells us if route exists
  ];
  
  for (const ep of orderEndpoints) {
    try {
      const r = await axios.get(`${BASE}${ep}`, { headers: h, timeout: 10000 });
      console.log(`✅ GET ${ep}: ${JSON.stringify(r.data).substring(0, 500)}`);
    } catch (e) {
      console.log(`${e.response?.status || "ERR"} GET ${ep}: ${JSON.stringify(e.response?.data || e.message).substring(0, 200)}`);
    }
  }

  // Output summary
  console.log("\n\n═══════════════════════════════════════════");
  console.log("  ENV VALUES TO SAVE:");
  console.log("═══════════════════════════════════════════\n");
  console.log(`BAYSE_AUTH_TOKEN=${token}`);
  console.log(`BAYSE_DEVICE_ID=${serverDeviceId}`);
  console.log(`BAYSE_USER_ID=${userId}`);
  console.log(`BAYSE_API_BASE_URL=${BASE}`);
}

run().catch(e => { console.error("Fatal:", e.response?.data || e.message); process.exit(1); });
