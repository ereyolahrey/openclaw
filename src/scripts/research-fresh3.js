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
  // 1. Get 20 most recent clanker tokens and check their volume
  console.log("=== CHECKING FRESH CLANKER LAUNCHES FOR VOLUME ===");
  const clankers = await fetch("https://www.clanker.world/api/tokens?sort=desc&limit=20");
  if (clankers.data && Array.isArray(clankers.data)) {
    for (const t of clankers.data.slice(0, 20)) {
      const addr = t.contract_address || t.address;
      if (!addr) continue;
      try {
        const d = await fetch("https://api.dexscreener.com/latest/dex/tokens/" + addr);
        const vol = d.pairs?.[0]?.volume?.h24 || 0;
        const vol1h = d.pairs?.[0]?.volume?.h1 || 0;
        const txns = d.pairs?.[0]?.txns?.h24 || {buys:0,sells:0};
        const mc = d.pairs?.[0]?.marketCap || 0;
        const liq = d.pairs?.[0]?.liquidity?.usd || 0;
        const flag = vol > 100 ? " <<< HAS VOLUME" : "";
        console.log(
          (t.symbol || "?").padEnd(16) +
          " | vol24=$" + String(Math.round(vol)).padStart(8) +
          " | vol1h=$" + String(Math.round(vol1h)).padStart(6) +
          " | txns=" + (txns.buys||0) + "b/" + (txns.sells||0) + "s" + 
          " | mc=$" + mc +
          " | liq=$" + Math.round(liq) +
          " | " + (t.name || "?").slice(0, 30) +
          " | " + t.created_at +
          flag
        );
      } catch (e) {
        console.log((t.symbol || "?").padEnd(16) + " | ERROR: " + e.message);
      }
    }
  }

  // 2. Now get clanker tokens page 2-5 (older ones that may have volume)
  console.log("\n=== CLANKER TRENDING/HOT (checking pages) ===");
  for (let page = 2; page <= 4; page++) {
    try {
      const d = await fetch("https://www.clanker.world/api/tokens?sort=desc&limit=20&page=" + page);
      if (d.data) {
        for (const t of d.data.slice(0, 5)) {
          const addr = t.contract_address || t.address;
          if (!addr) continue;
          const dx = await fetch("https://api.dexscreener.com/latest/dex/tokens/" + addr);
          const vol = dx.pairs?.[0]?.volume?.h24 || 0;
          if (vol > 50) {
            const p = dx.pairs[0];
            console.log(
              (t.symbol || "?").padEnd(16) +
              " | vol24=$" + Math.round(vol) +
              " | txns=" + ((p.txns?.h24?.buys||0)+(p.txns?.h24?.sells||0)) +
              " | mc=$" + (p.marketCap||0) +
              " | " + (t.name||"?").slice(0, 30) +
              " | age=" + t.created_at +
              " <<< HAS VOLUME"
            );
          }
        }
      }
    } catch (e) {}
  }

  // 3. Search for bankr.bot launches directly through DexScreener
  // bankr deploys through a factory — search for recently created pairs
  console.log("\n=== SEARCHING FOR BANKR LAUNCHES WITH VOLUME ===");
  // Search for terms bankr launches commonly use
  const bankrSearches = [
    "bankr launch", "launched on bankr", "JAN", "luna base new",
    "tariff", "agent AI base new", "meme base new token 2026",
    "trump base token", "gork", "fartcoin base",
  ];
  
  const found = new Map();
  for (const q of bankrSearches) {
    try {
      const d = await fetch("https://api.dexscreener.com/latest/dex/search?q=" + encodeURIComponent(q));
      if (d.pairs) {
        d.pairs
          .filter(p => {
            if (p.chainId !== "base") return false;
            const ageH = (Date.now() - (p.pairCreatedAt || 0)) / 3600000;
            return ageH < 168 && (p.volume?.h24 || 0) > 100; // < 7 days, > $100 vol
          })
          .forEach(p => {
            if (!found.has(p.baseToken.address)) {
              found.set(p.baseToken.address, p);
            }
          });
      }
    } catch (e) {}
  }

  const freshVolume = [...found.values()].sort((a,b) => (b.volume?.h24||0) - (a.volume?.h24||0));
  console.log("Found " + freshVolume.length + " Base tokens (<7d) with >$100 vol24:");
  freshVolume.slice(0, 20).forEach(p => {
    const ageH = Math.round((Date.now() - p.pairCreatedAt) / 3600000);
    console.log(
      (p.baseToken.symbol||"?").padEnd(14) +
      " | vol24=$" + Math.round(p.volume?.h24||0) +
      " | vol1h=$" + Math.round(p.volume?.h1||0) +
      " | txns=" + ((p.txns?.h24?.buys||0)+(p.txns?.h24?.sells||0)) +
      " | mc=$" + (p.marketCap||0) +
      " | liq=$" + Math.round(p.liquidity?.usd||0) +
      " | age=" + (ageH < 24 ? ageH + "h" : Math.round(ageH/24) + "d") +
      " | " + p.baseToken.name +
      " | CA=" + p.baseToken.address
    );
  });

  // 4. Check bankr.bot website for recent launches  
  console.log("\n=== BANKR.BOT WEBSITE SCRAPE ===");
  try {
    const html = await fetch("https://bankr.bot/launches");
    if (typeof html === "string") {
      // Find token addresses in HTML
      const addrs = [...new Set(html.match(/0x[a-fA-F0-9]{40}/g) || [])];
      console.log("Found " + addrs.length + " addresses on bankr launches page");
      // Check first 10 for volume
      for (const addr of addrs.slice(0, 10)) {
        try {
          const d = await fetch("https://api.dexscreener.com/latest/dex/tokens/" + addr);
          if (d.pairs && d.pairs[0]) {
            const p = d.pairs[0];
            const vol = p.volume?.h24 || 0;
            if (vol > 0) {
              const ageH = Math.round((Date.now() - p.pairCreatedAt) / 3600000);
              console.log(
                (p.baseToken.symbol||"?").padEnd(14) +
                " | vol24=$" + Math.round(vol) +
                " | txns=" + ((p.txns?.h24?.buys||0)+(p.txns?.h24?.sells||0)) +
                " | mc=$" + (p.marketCap||0) +
                " | age=" + (ageH < 24 ? ageH + "h" : Math.round(ageH/24) + "d") +
                " | " + p.baseToken.name +
                (vol > 100 ? " <<< VOLUME" : "")
              );
            }
          }
        } catch(e) {}
      }
    }
  } catch(e) { console.log("Error:", e.message); }
}

main().catch(console.error);
