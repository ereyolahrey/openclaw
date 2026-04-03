const https = require("https");

function fetch(url) {
  return new Promise((res, rej) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { "User-Agent": "Mozilla/5.0" }}, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        return fetch(r.headers.location).then(res).catch(rej);
      }
      let d = ""; r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { res(d); } });
    }).on("error", rej);
  });
}

async function main() {
  // 1. Scan clanker pages deep to find ANY token with volume
  console.log("=== SCANNING CLANKER PAGES FOR TOKENS WITH VOLUME ===");
  let foundWithVol = [];
  
  for (let page = 1; page <= 10; page++) {
    try {
      const d = await fetch("https://www.clanker.world/api/tokens?sort=desc&limit=20&page=" + page);
      if (!d.data) continue;
      
      // Batch check - grab addresses
      for (const t of d.data) {
        const addr = t.contract_address || t.address;
        if (!addr) continue;
        try {
          const dx = await fetch("https://api.dexscreener.com/latest/dex/tokens/" + addr);
          const vol = dx.pairs?.[0]?.volume?.h24 || 0;
          if (vol > 10) {
            const p = dx.pairs[0];
            foundWithVol.push({
              symbol: t.symbol,
              name: t.name,
              addr,
              vol24: vol,
              vol1h: p.volume?.h1 || 0,
              txns: (p.txns?.h24?.buys||0) + (p.txns?.h24?.sells||0),
              mc: p.marketCap || 0,
              liq: Math.round(p.liquidity?.usd || 0),
              created: t.created_at,
              dex: p.dexId,
            });
          }
        } catch (e) {}
      }
    } catch (e) {}
    process.stdout.write("Page " + page + "... ");
  }
  
  console.log("\n\nCLANKER TOKENS WITH VOLUME (sorted by vol24):");
  foundWithVol.sort((a, b) => b.vol24 - a.vol24);
  foundWithVol.slice(0, 30).forEach(t => {
    const ageH = Math.round((Date.now() - new Date(t.created).getTime()) / 3600000);
    console.log(
      (t.symbol||"?").padEnd(16) +
      " | vol24=$" + Math.round(t.vol24).toString().padStart(10) +
      " | vol1h=$" + Math.round(t.vol1h).toString().padStart(8) +
      " | txns=" + t.txns +
      " | mc=$" + t.mc +
      " | liq=$" + t.liq +
      " | age=" + (ageH < 24 ? ageH + "h" : Math.round(ageH/24) + "d") +
      " | " + (t.name||"?").slice(0, 35) +
      " | CA=" + t.addr
    );
  });

  // 2. Broader DexScreener search for trending fresh Base tokens
  console.log("\n=== BROADER DEXSCREENER FRESH BASE TOKEN HUNT ===");
  const searches = [
    "gork", "tariff", "trump base", "AI agent base token",
    "defense agents DOTA", "juno agent", "JAN base",
    "fartcoin", "higher base", "toshi base", "brett base",
    "normie base", "degen base token new", "mfer base",
    "based chad", "onchain", "zora base", "aero base",
  ];
  
  const allFound = new Map();
  for (const q of searches) {
    try {
      const d = await fetch("https://api.dexscreener.com/latest/dex/search?q=" + encodeURIComponent(q));
      if (d.pairs) {
        d.pairs
          .filter(p => p.chainId === "base" && (p.volume?.h24 || 0) > 100)
          .sort((a, b) => (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0))
          .slice(0, 5)
          .forEach(p => {
            const key = p.baseToken.address;
            if (!allFound.has(key)) {
              allFound.set(key, p);
            }
          });
      }
    } catch (e) {}
  }

  // Sort by newest first, only show < 7 days old
  const fresh = [...allFound.values()]
    .filter(p => (Date.now() - (p.pairCreatedAt||0)) / 3600000 < 168)
    .sort((a, b) => (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0));
  
  console.log("FRESH BASE TOKENS (<7d) WITH >$100 VOL (sorted newest first):");
  fresh.slice(0, 25).forEach(p => {
    const ageH = Math.round((Date.now() - p.pairCreatedAt) / 3600000);
    console.log(
      (p.baseToken.symbol||"?").padEnd(14) +
      " | vol24=$" + Math.round(p.volume?.h24||0).toString().padStart(10) +
      " | vol1h=$" + Math.round(p.volume?.h1||0).toString().padStart(8) +
      " | txns=" + ((p.txns?.h24?.buys||0)+(p.txns?.h24?.sells||0)) +
      " | mc=$" + (p.marketCap||0) +
      " | liq=$" + Math.round(p.liquidity?.usd||0) +
      " | age=" + (ageH < 24 ? ageH + "h" : Math.round(ageH/24) + "d") +
      " | " + p.baseToken.name +
      " | CA=" + p.baseToken.address
    );
  });

  // 3. Now specifically deep dive top performers
  console.log("\n=== TOP PERFORMERS ANALYSIS ===");
  // DOTA is the star - let's understand
  console.log("DOTA: $232k vol, 2782 txns in 24h. Created March 30. Gaming meme (DOTA2 reference).");
  console.log("  ' Defense of the Agents' - combines gaming culture + AI agent narrative");
  console.log("  High txn count suggests bot activity. Many sells (2021) vs buys (761) = sniper dump pattern.");
  console.log("  Name is catchy: references a well-known game + hot 'agent' narrative");
  console.log("");
  console.log("BasePEPE: $1.1k vol, 23 txns. Only 9h old. Simple Pepe duplicate - STILL gets buys");
  console.log("  Simple recognizable name. Pepe is the #1 meme.");
  console.log("");
  console.log("gork: $650 vol, 7 txns. Just 1h old! 'New XAI gork' - Elon's AI reference");
  console.log("  Tapping into Elon/xAI hype. Fresh = sniper bots scan for trending keywords");
}

main().catch(console.error);
