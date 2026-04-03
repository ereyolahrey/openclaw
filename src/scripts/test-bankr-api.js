const https = require('https');
function f(u) {
  return new Promise((r, j) => {
    https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (s) => {
      if (s.statusCode >= 300 && s.statusCode < 400 && s.headers.location) return f(s.headers.location).then(r).catch(j);
      let d = ''; s.on('data', c => d += c); s.on('end', () => r({ body: d, status: s.statusCode, ct: s.headers['content-type'] }));
    }).on('error', j);
  });
}
(async () => {
  const p = await f('https://bankr.bot/launches');
  console.log('Next:', p.body.includes('__NEXT'), 'Vite:', p.body.includes('vite'));
  
  const re = /src="([^"]+)"/g;
  const scripts = [];
  let m;
  while ((m = re.exec(p.body)) !== null) scripts.push(m[1]);
  console.log('Scripts:', scripts.slice(0, 8));
  
  const apiMatches = p.body.match(/https?:\/\/[a-zA-Z0-9.-]+\/api[^\s"')]+/g);
  console.log('API URLs:', apiMatches ? apiMatches.slice(0, 5) : 'none');
  
  console.log('Supabase:', p.body.includes('supabase'), 'Firebase:', p.body.includes('firebase'), 'GraphQL:', p.body.includes('graphql'));
  
  // Also try DexScreener specifically for bankr tokens
  const d = await f('https://api.dexscreener.com/latest/dex/search?q=bankr');
  try {
    const j = JSON.parse(d.body);
    const basePairs = (j.pairs || []).filter(p => p.chainId === 'base');
    console.log('\nDexScreener bankr search:', basePairs.length, 'Base pairs');
    basePairs.sort((a,b) => (b.pairCreatedAt||0) - (a.pairCreatedAt||0));
    basePairs.slice(0, 5).forEach(p => {
      const ageMin = Math.round((Date.now() - (p.pairCreatedAt||0)) / 60000);
      console.log('  ' + (p.baseToken.symbol||'?').padEnd(12) + ' age=' + ageMin + 'min vol=$' + Math.round(p.volume?.h24||0) + ' ' + p.baseToken.name);
    });
  } catch(e) { console.log('DexScreener parse error:', e.message); }
  
  // Search for fresh Base pair launches on DexScreener
  const d2 = await f('https://api.dexscreener.com/token-profiles/latest/v1');
  try {
    const profiles = JSON.parse(d2.body);
    const baseProfiles = profiles.filter(t => t.chainId === 'base');
    console.log('\nDexScreener latest profiles (Base):', baseProfiles.length);
    baseProfiles.slice(0, 5).forEach(t => {
      console.log('  ' + t.tokenAddress);
    });
  } catch(e) {}
  
  // Try pairs/latest for new pairs on Base  
  const d3 = await f('https://api.dexscreener.com/latest/dex/pairs/base');
  try {
    const j3 = JSON.parse(d3.body);
    console.log('\nDexScreener pairs/base:', j3.pairs ? j3.pairs.length + ' pairs' : 'no pairs key, keys=' + Object.keys(j3));
  } catch(e) { console.log('pairs/base raw:', d3.body.substring(0, 200)); }
})().catch(e => console.error(e.message));
