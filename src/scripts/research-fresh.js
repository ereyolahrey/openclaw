const https = require("https");

function fetch(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => {
        try { res(JSON.parse(d)); } catch (e) { res(d); }
      });
    }).on("error", rej);
  });
}

async function main() {
  // 1. Search bankr.bot API for fresh launches
  console.log("=== BANKR.BOT FRESH LAUNCHES ===");
  try {
    const d = await fetch("https://www.bankr.bot/api/launches?sort=recent&limit=30");
    if (Array.isArray(d)) {
      d.slice(0, 20).forEach((t) => {
        console.log(JSON.stringify(t).slice(0, 200));
      });
    } else {
      console.log("Bankr API response type:", typeof d, JSON.stringify(d).slice(0, 300));
    }
  } catch (e) {
    console.log("Bankr API error:", e.message);
  }

  // 2. Search DexScreener for fresh Base tokens with volume
  const queries = ["base meme", "clanker", "agent base", "pepe base", "degen base", "wojak", "frog base", "bonk base"];

  for (const q of queries) {
    console.log("\n=== DexScreener: " + q + " ===");
    try {
      const d = await fetch("https://api.dexscreener.com/latest/dex/search?q=" + encodeURIComponent(q));
      if (d.pairs) {
        const basePairs = d.pairs
          .filter((p) => p.chainId === "base" && (p.volume?.h24 || 0) > 0)
          .sort((a, b) => (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0))
          .slice(0, 8);
        basePairs.forEach((p) => {
          const ageH = p.pairCreatedAt ? Math.round((Date.now() - p.pairCreatedAt) / 3600000) : "?";
          const ageStr = ageH < 24 ? ageH + "h" : Math.round(ageH / 24) + "d";
          console.log(
            [
              (p.baseToken.symbol || "?").padEnd(14),
              "vol24=$" + (p.volume?.h24 || 0).toFixed(0).padStart(10),
              "vol1h=$" + (p.volume?.h1 || 0).toFixed(0).padStart(8),
              "txns=" + (p.txns?.h24?.buys || 0) + "b/" + (p.txns?.h24?.sells || 0) + "s",
              "mc=$" + (p.marketCap || 0),
              "age=" + ageStr,
              p.baseToken.name,
            ].join(" | ")
          );
        });
      }
    } catch (e) {
      console.log("Error:", e.message);
    }
  }

  // 3. Check clanker.world for fresh clanker launches
  console.log("\n=== CLANKER.WORLD API ===");
  try {
    const d = await fetch("https://www.clanker.world/api/tokens?sort=newest&limit=30");
    if (Array.isArray(d)) {
      d.slice(0, 15).forEach((t) => console.log(JSON.stringify(t).slice(0, 200)));
    } else if (d.tokens) {
      d.tokens.slice(0, 15).forEach((t) => console.log(JSON.stringify(t).slice(0, 200)));
    } else {
      console.log("Clanker API:", typeof d, JSON.stringify(d).slice(0, 400));
    }
  } catch (e) {
    console.log("Clanker API error:", e.message);
  }

  // 4. Fetch FRESH pairs on Base from DexScreener - newest pairs with volume
  console.log("\n=== DEXSCREENER NEWEST BASE PAIRS ===");
  try {
    const d = await fetch("https://api.dexscreener.com/latest/dex/search?q=base");
    if (d.pairs) {
      const fresh = d.pairs
        .filter((p) => {
          if (p.chainId !== "base") return false;
          const ageH = p.pairCreatedAt ? (Date.now() - p.pairCreatedAt) / 3600000 : 9999;
          return ageH < 48 && (p.volume?.h24 || 0) > 50;
        })
        .sort((a, b) => (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0))
        .slice(0, 15);
      console.log("Found " + fresh.length + " fresh pairs (<48h) with >$50 vol:");
      fresh.forEach((p) => {
        const ageH = Math.round((Date.now() - p.pairCreatedAt) / 3600000);
        console.log(
          [
            (p.baseToken.symbol || "?").padEnd(14),
            "vol24=$" + (p.volume?.h24 || 0).toFixed(0).padStart(10),
            "vol1h=$" + (p.volume?.h1 || 0).toFixed(0).padStart(8),
            "txns24=" + ((p.txns?.h24?.buys || 0) + (p.txns?.h24?.sells || 0)),
            "mc=$" + (p.marketCap || 0),
            "age=" + ageH + "h",
            p.baseToken.name,
            "| dex=" + p.dexId,
          ].join(" | ")
        );
      });
    }
  } catch (e) {
    console.log("Error:", e.message);
  }
}

main().catch(console.error);
