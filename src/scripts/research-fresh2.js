const https = require("https");

function fetch(url, options = {}) {
  return new Promise((res, rej) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { "User-Agent": "Mozilla/5.0", ...options.headers },
    };
    https.get(opts, (r) => {
      // Follow redirects
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        return fetch(r.headers.location, options).then(res).catch(rej);
      }
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => {
        try { res(JSON.parse(d)); } catch (e) { res(d); }
      });
    }).on("error", rej);
  });
}

async function main() {
  // 1. Try bankr.bot API (follow redirects)
  console.log("=== BANKR.BOT API (following redirects) ===");
  try {
    const d = await fetch("https://bankr.bot/api/launches?sort=recent&limit=20");
    if (typeof d === "string") {
      // Maybe HTML page - look for token data
      const matches = d.match(/0x[a-fA-F0-9]{40}/g);
      if (matches) console.log("Found addresses:", [...new Set(matches)].slice(0, 10));
      else console.log("Response length:", d.length, "chars (HTML)");
    } else {
      console.log(JSON.stringify(d).slice(0, 500));
    }
  } catch (e) { console.log("Error:", e.message); }

  // 2. Clanker.world API with correct params
  console.log("\n=== CLANKER.WORLD API v2 ===");
  try {
    const d = await fetch("https://www.clanker.world/api/tokens?sort=desc&limit=20");
    if (d.data && Array.isArray(d.data)) {
      d.data.forEach((t) => {
        console.log((t.symbol || "?").padEnd(14) + " | " + (t.name || "?") + " | " + (t.contract_address || t.address || "?").slice(0, 14) + "... | created: " + (t.created_at || "?"));
      });
    } else if (Array.isArray(d)) {
      d.slice(0, 15).forEach((t) => console.log(JSON.stringify(t).slice(0, 200)));
    } else {
      console.log(JSON.stringify(d).slice(0, 600));
    }
  } catch (e) { console.log("Error:", e.message); }

  // 3. Clanker tokens - try different endpoints
  console.log("\n=== CLANKER.WORLD tokens endpoint ===");
  try {
    const d = await fetch("https://www.clanker.world/api/get-clankers?page=1&sort=desc");
    if (d.data) {
      (Array.isArray(d.data) ? d.data : [d.data]).slice(0, 15).forEach((t) => {
        console.log((t.symbol || "?").padEnd(14) + " | " + (t.name || "?") + " | " + (t.contract_address || "?").slice(0, 14) + "...");
      });
    } else {
      console.log(JSON.stringify(d).slice(0, 500));
    }
  } catch (e) { console.log("Error:", e.message); }

  // 4. Search DexScreener for VERY fresh Base tokens (< 24h) with any volume
  console.log("\n=== FRESH BASE TOKENS (<24h) WITH VOLUME ===");
  const freshSearches = [
    "launched today base", "new base token", "just launched base",
    "BasePEPE", "DOTA", "defense agents",
  ];
  
  const allFresh = [];
  for (const q of freshSearches) {
    try {
      const d = await fetch("https://api.dexscreener.com/latest/dex/search?q=" + encodeURIComponent(q));
      if (d.pairs) {
        d.pairs
          .filter((p) => {
            if (p.chainId !== "base") return false;
            const ageH = p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / 3600000 : 9999;
            return ageH < 72 && (p.volume?.h24 || 0) > 0;
          })
          .forEach((p) => {
            if (!allFresh.find((f) => f.baseToken.address === p.baseToken.address)) {
              allFresh.push(p);
            }
          });
      }
    } catch (e) {}
  }

  allFresh.sort((a, b) => (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0));
  console.log("Found " + allFresh.length + " fresh tokens (<72h) with volume:");
  allFresh.forEach((p) => {
    const ageH = Math.round((Date.now() - p.pairCreatedAt) / 3600000);
    console.log(
      [
        (p.baseToken.symbol || "?").padEnd(14),
        "vol24=$" + (p.volume?.h24 || 0).toFixed(0).padStart(10),
        "vol1h=$" + (p.volume?.h1 || 0).toFixed(0).padStart(8),
        "txns=" + ((p.txns?.h24?.buys || 0) + (p.txns?.h24?.sells || 0)),
        "mc=$" + (p.marketCap || 0),
        "age=" + ageH + "h",
        "liq=$" + Math.round(p.liquidity?.usd || 0),
        p.baseToken.name,
        "| CA=" + p.baseToken.address,
      ].join(" | ")
    );
  });

  // 5. Deep dive DOTA - it's very fresh and high volume
  console.log("\n=== DEEP DIVE: DOTA (Defense of the Agents) ===");
  try {
    const d = await fetch("https://api.dexscreener.com/latest/dex/search?q=defense+of+the+agents");
    if (d.pairs) {
      const dota = d.pairs.filter((p) => p.chainId === "base" && p.baseToken.symbol === "DOTA");
      dota.forEach((p) => {
        console.log("Symbol:", p.baseToken.symbol, "Name:", p.baseToken.name);
        console.log("CA:", p.baseToken.address);
        console.log("Vol24:", p.volume?.h24, "Vol6h:", p.volume?.h6, "Vol1h:", p.volume?.h1);
        console.log("Txns 24h:", p.txns?.h24, "Txns 6h:", p.txns?.h6, "Txns 1h:", p.txns?.h1);
        console.log("MC:", p.marketCap, "Liq:", p.liquidity?.usd);
        console.log("Created:", new Date(p.pairCreatedAt).toISOString());
        console.log("Price change 24h:", p.priceChange?.h24, "%");
        console.log("DEX:", p.dexId, "| Pair:", p.pairAddress);
        console.log("---");
      });
    }
  } catch (e) { console.log("Error:", e.message); }

  // 6. Deep dive BasePEPE - super fresh
  console.log("\n=== DEEP DIVE: BasePEPE (9h old) ===");
  try {
    const d = await fetch("https://api.dexscreener.com/latest/dex/search?q=BasePEPE");
    if (d.pairs) {
      const bp = d.pairs.filter((p) => p.chainId === "base" && (Date.now() - (p.pairCreatedAt || 0)) / 3600000 < 48);
      bp.forEach((p) => {
        console.log("Symbol:", p.baseToken.symbol, "Name:", p.baseToken.name);
        console.log("CA:", p.baseToken.address);
        console.log("Vol24:", p.volume?.h24, "Vol6h:", p.volume?.h6, "Vol1h:", p.volume?.h1);
        console.log("Txns 24h:", p.txns?.h24);
        console.log("MC:", p.marketCap, "Liq:", p.liquidity?.usd);
        console.log("Created:", new Date(p.pairCreatedAt).toISOString());
        console.log("DEX:", p.dexId);
        console.log("---");
      });
    }
  } catch (e) { console.log("Error:", e.message); }
}

main().catch(console.error);
