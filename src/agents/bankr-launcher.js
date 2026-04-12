/**
 * Bankr Token Launcher Agent v9 — Base Sniper Engine (Fixed Filters)
 *
 * STRATEGY: Monitor for brand-new token launches every minute.
 * When a fresh token (<30 min old) shows traction ($50+ vol, 2+ txns),
 * deploy duplicates on Base via REST API.
 *
 * Sources monitored:
 *   1. api.bankr.bot/token-launches — bankr's own fresh token launches
 *   2. DexScreener token profiles — newly promoted Base tokens
 *   3. DexScreener token boosts — boosted Base tokens
 *   4. clanker.world API — newest clanker tokens (cross-platform snipe)
 *   5. Tracked wallets — tokens from top deployers
 */

require("dotenv").config();
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");
const { Logger } = require("../utils/logger");

// ── FILE PATHS ──
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const TOKENS_FILE = path.join(DATA_DIR, "bankr-tokens.json");
const PERFORMANCE_FILE = path.join(DATA_DIR, "bankr-performance.json");
const TRACKED_WALLETS_FILE = path.join(DATA_DIR, "tracked-wallets.json");

// ── INSTANT SNIPER CONFIG ──
const FEE_WALLET = process.env.BANKR_FEE_WALLET;
if (!FEE_WALLET) {
  console.error("FATAL: BANKR_FEE_WALLET not set in .env");
  process.exit(1);
}
const BANKR_CLUB_ACTIVE = true;               // Club subscription active — unlimited launches, 95% fee share
const MAX_TOKEN_AGE_MS = 10 * 60 * 1000;    // Duplicate tokens < 10 min old — speed matters
const MIN_VOLUME_TRIGGER = 10;                // $10 volume = at least 1 real buy happened
const MIN_TXN_COUNT = 1;                      // Even 1 buy is worth duplicating — most tokens get zero
const MAX_VOLUME_CAP = 50000;                 // Skip tokens with $50K+ vol — already too many copycats
const SEEN_TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // Forget tokens seen > 2 hours ago

// ── NAME QUALITY FILTER ──
// Reject tokens with names that are established coins, too generic, or spammy
const BLOCKED_NAMES = new Set([
  "bitcoin", "ethereum", "solana", "bnb", "cardano", "dogecoin", "shiba", "xrp",
  "ripple", "polkadot", "avalanche", "chainlink", "polygon", "uniswap", "litecoin",
  "pepe", "bonk", "floki", "doge", "tron", "near", "cosmos", "toncoin", "aptos",
  "sui", "arbitrum", "optimism", "aave", "maker", "compound",
]);
function isQualityName(name, symbol) {
  if (!name || !symbol) return false;
  const nameLower = name.toLowerCase().trim();
  const symLower = symbol.toLowerCase().trim();
  // Block established coin names
  if (BLOCKED_NAMES.has(nameLower) || BLOCKED_NAMES.has(symLower)) return false;
  // Block very short names (1-2 chars) — too generic
  if (name.length < 3 || symbol.length < 2) return false;
  // Block very long names (>30 chars) — spammy
  if (name.length > 30 || symbol.length > 12) return false;
  // Block names that are just numbers or all caps single words with no meaning
  if (/^\d+$/.test(name)) return false;
  // Block common spam patterns
  if (/test|fuck|scam|rug|porn|nsfw/i.test(name)) return false;
  return true;
}

// ── BANKR API CONFIG ──
const BANKR_API_URL = "https://api.bankr.bot";
const BANKR_CONFIG_FILE = path.join(require("os").homedir(), ".bankr", "config.json");
function getBankrApiKey() {
  if (process.env.BANKR_API_KEY) return process.env.BANKR_API_KEY;
  try {
    const cfg = JSON.parse(fs.readFileSync(BANKR_CONFIG_FILE, "utf8"));
    return cfg.apiKey;
  } catch { return null; }
}

class BankrLauncher {
  constructor({ notifiers = [], config = {} }) {
    this.notifiers = notifiers;
    this.config = {
      maxLaunchesPerDay: config.maxLaunchesPerDay || 200,  // Club = unlimited launches
      feeClaimThreshold: config.feeClaimThreshold || 0.001,
      ...config,
    };
    this.log = new Logger("bankr-launcher");
    this._ensureDataDir();
    this.tokenData = this._loadTokenData();
    this.perfData = this._loadPerformanceData();

    // Track tokens we've already seen (address → firstSeen timestamp)
    this.seenTokens = new Map();
    // Track source tokens we've already duplicated (by address)
    this.duplicatedSources = new Set(
      this.tokenData.tokens.filter(t => t.sourceAddress).map(t => t.sourceAddress)
    );
    // Track names we've already deployed (avoid deploying same name twice)
    this.deployedNames = new Set(
      this.tokenData.tokens.map(t => `${t.name}::${t.symbol}`)
    );

    // Track last successful launch time for fallback logic
    this.lastLaunchTime = Date.now();

    this.log.info(
      `Bankr Launcher v5 (instant sniper) initialized. ` +
      `${this.tokenData.tokens.length} tracked, ${this.tokenData.stats.totalLaunched} launched, ` +
      `${this.duplicatedSources.size} sources already duplicated.`
    );
  }

  _ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // ── DATA PERSISTENCE ──

  _loadTokenData() {
    try {
      if (fs.existsSync(TOKENS_FILE)) {
        const data = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
        if (!data.stats.totalFeesEarned) data.stats.totalFeesEarned = 0;
        if (!data.stats.totalFeesClaimed) data.stats.totalFeesClaimed = 0;
        if (!data.dailyHistory) data.dailyHistory = [];
        if (!data.clubGoal) data.clubGoal = { target: CLUB_COST_WETH, subscribed: false };
        return data;
      }
    } catch {}
    return {
      tokens: [],
      stats: { totalLaunched: 0, totalFeesEarned: 0, totalFeesClaimed: 0 },
      lastLaunchDate: null,
      launchesToday: 0,
      dailyHistory: [],
      clubGoal: { target: 0, subscribed: true, plan: "unlimited" },
    };
  }

  _loadPerformanceData() {
    try {
      if (fs.existsSync(PERFORMANCE_FILE)) {
        const data = JSON.parse(fs.readFileSync(PERFORMANCE_FILE, "utf8"));
        if (!data.duplications) data.duplications = { total: 0, successful: 0 };
        if (!data.volumeChecks) data.volumeChecks = [];
        return data;
      }
    } catch {}
    return {
      volumeChecks: [],
      duplications: { total: 0, successful: 0 },
    };
  }

  _saveTokenData() {
    try { fs.writeFileSync(TOKENS_FILE, JSON.stringify(this.tokenData, null, 2)); }
    catch (e) { this.log.error(`Token data save failed: ${e.message}`); }
  }

  _savePerformanceData() {
    try { fs.writeFileSync(PERFORMANCE_FILE, JSON.stringify(this.perfData, null, 2)); }
    catch (e) { this.log.error(`Performance data save failed: ${e.message}`); }
  }

  // ── HTTP & CLI HELPERS ──

  _httpGet(url) {
    return new Promise((resolve) => {
      const req = https.get(url, { headers: { "User-Agent": "BankrSniper/5.0" } }, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
      });
      req.on("error", () => resolve(null));
      req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    });
  }

  _runBankr(args, timeout = 120000) {
    try {
      const result = execSync(`bankr ${args}`, {
        encoding: "utf8",
        timeout,
        stdio: ["pipe", "pipe", "pipe"],
        input: "\n\n\n\n\n\n\n\n\n\n",
      });
      return result.trim();
    } catch (e) {
      const stderr = e.stderr ? e.stderr.toString() : "";
      const stdout = e.stdout ? e.stdout.toString() : "";
      throw new Error(`bankr ${args} failed: ${stderr || stdout || e.message}`);
    }
  }

  // Sanitize external input — strip anything dangerous
  _sanitizeName(str) {
    return str.replace(/[^a-zA-Z0-9 _.\-()!@#&]/g, '').substring(0, 50).trim();
  }

  // HTTP POST helper for bankr API
  _httpPost(url, body) {
    return new Promise((resolve, reject) => {
      const apiKey = getBankrApiKey();
      if (!apiKey) return reject(new Error("No bankr API key found in ~/.bankr/config.json or BANKR_API_KEY env"));
      const payload = JSON.stringify(body);
      const parsed = new URL(url);
      const req = https.request({
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
          "User-Agent": "BankrSniper/5.0",
          "Content-Length": Buffer.byteLength(payload),
        },
      }, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => {
          try {
            const json = JSON.parse(d);
            if (r.statusCode >= 400) return reject(new Error(`API ${r.statusCode}: ${json.message || json.error || d.substring(0, 200)}`));
            resolve(json);
          } catch { reject(new Error(`API response parse error (${r.statusCode}): ${d.substring(0, 200)}`)); }
        });
      });
      req.on("error", (e) => reject(e));
      req.setTimeout(120000, () => { req.destroy(); reject(new Error("API request timeout")); });
      req.write(payload);
      req.end();
    });
  }

  // Deploy via bankr REST API directly (bypasses CLI interactive prompts) — Base chain
  async _deployFast(name, symbol) {
    const safeName = this._sanitizeName(name);
    const safeSymbol = this._sanitizeName(symbol);

    if (!safeName || !safeSymbol) {
      throw new Error(`Invalid token name/symbol after sanitization: "${safeName}" / "${safeSymbol}"`);
    }

    this.log.info(`API DEPLOY: ${safeName} ($${safeSymbol}) fee→${FEE_WALLET.slice(0, 10)}... [Base]`);

    const result = await this._httpPost(`${BANKR_API_URL}/token-launches/deploy`, {
      tokenName: safeName,
      tokenSymbol: safeSymbol,
      feeRecipient: { type: "wallet", value: FEE_WALLET },
    });

    const contractAddress = result.tokenAddress;
    if (!contractAddress) {
      throw new Error(`API returned no tokenAddress: ${JSON.stringify(result).substring(0, 300)}`);
    }

    const output = JSON.stringify(result);
    this.log.info(`Deploy success: ${contractAddress} (pool=${result.poolId || "?"}, tx=${result.txHash || "?"})`);
    return { output, contractAddress, chain: "base" };
  }

  // ── DAILY LIMITS ──

  _checkDailyLimit() {
    const today = new Date().toISOString().split("T")[0];
    if (this.tokenData.lastLaunchDate !== today) {
      if (this.tokenData.lastLaunchDate) {
        this.tokenData.dailyHistory.push({
          date: this.tokenData.lastLaunchDate,
          launched: this.tokenData.launchesToday,
        });
        if (this.tokenData.dailyHistory.length > 90) this.tokenData.dailyHistory.shift();
      }
      this.tokenData.launchesToday = 0;
      this.tokenData.lastLaunchDate = today;
      this._saveTokenData();
    }
    return this.tokenData.launchesToday < this.config.maxLaunchesPerDay;
  }

  // ═══════════════════════════════════════════════════
  // CORE: REAL-TIME MONITOR & INSTANT DUPLICATE
  // Runs every 2 minutes. This is the entire strategy.
  // ═══════════════════════════════════════════════════

  async monitorAndDuplicate() {
    const remaining = this.config.maxLaunchesPerDay - this.tokenData.launchesToday;
    this.log.info(`── Monitor cycle | ${remaining} launches remaining today | seen=${this.seenTokens.size} ──`);

    if (!this._checkDailyLimit()) {
      this.log.info("Daily limit reached. Monitoring paused until tomorrow.");
      return;
    }

    // 1. Prune stale entries from seen tokens
    this._pruneSeenTokens();

    // 2. Fetch candidate tokens from all sources
    const candidates = await this._fetchAllSources();

    // 3. Filter out already-duplicated and already-deployed
    const unchecked = candidates.filter(t => {
      if (this.duplicatedSources.has(t.address)) return false;
      if (t.name && t.symbol && this.deployedNames.has(`${t.name}::${t.symbol}`)) return false;
      return true;
    });

    // 3b. Solana snipes — already pre-filtered with volume, deploy directly
    const solanaSnipes = unchecked.filter(t => t.source === "solana-snipe" && t.name && t.symbol);
    for (const sol of solanaSnipes.slice(0, 3)) {
      if (!this._checkDailyLimit()) break;
      const nameKey = `${sol.name}::${sol.symbol}`;
      if (this.deployedNames.has(nameKey)) continue;
      this.log.info(`SOLANA SNIPE: ${sol.name} ($${sol.symbol}) sol_vol=$${sol.solVolume} txns=${sol.solTxns}`);
      await this._deploySolanaSnipe(sol);
    }

    // 3c. Wallet tracker tokens — pre-verified from top deployers
    const walletTokens = unchecked.filter(t => t.source === "wallet-tracker" && t.name && t.symbol);
    for (const wt of walletTokens.slice(0, 3)) {
      if (!this._checkDailyLimit()) break;
      const nameKey = `${wt.name}::${wt.symbol}`;
      if (this.deployedNames.has(nameKey)) continue;
      this.log.info(`WALLET TRACK: ${wt.name} ($${wt.symbol}) from deployer ${wt.trackedWallet?.slice(0, 10)}...`);
      await this._deployWalletTrack(wt);
    }

    // 4. Track all candidates as seen
    for (const t of candidates) {
      if (!this.seenTokens.has(t.address)) {
        this.seenTokens.set(t.address, Date.now());
      }
    }

    // 5. Only check tokens we first saw within the age window
    const now = Date.now();
    const toCheck = unchecked.filter(t => {
      const firstSeen = this.seenTokens.get(t.address) || now;
      return (now - firstSeen) < MAX_TOKEN_AGE_MS;
    });

    if (toCheck.length === 0) {
      this.log.info("No new candidates to check this cycle.");
      return;
    }

    this.log.info(`Checking ${toCheck.length} candidates for volume...`);

    // 6. Batch check volume + age via DexScreener
    const hotTokens = await this._findHotTokens(toCheck);

    if (hotTokens.length === 0) {
      this.log.info(`No hot tokens found (need $${MIN_VOLUME_TRIGGER}+ vol, ${MIN_TXN_COUNT}+ txns, <${MAX_TOKEN_AGE_MS / 60000}min old).`);

      // FALLBACK: If no launch in 2+ hours, deploy a trending token
      const timeSinceLastLaunch = Date.now() - this.lastLaunchTime;
      if (timeSinceLastLaunch > 2 * 60 * 60 * 1000) {
        this.log.info(`No launch in ${Math.round(timeSinceLastLaunch / 60000)}min — triggering trending fallback...`);
        await this._launchTrendingToken();
      }
      return;
    }

    this.log.info(`${hotTokens.length} HOT TOKEN(S) detected! Deploying duplicates...`);

    // 7. Deploy duplicates for each hot token (up to daily limit)
    for (const hot of hotTokens) {
      if (!this._checkDailyLimit()) {
        this.log.info("Daily limit reached mid-cycle.");
        break;
      }
      await this._deployDuplicate(hot);
    }
  }

  // ── SOURCE FETCHING ──

  async _fetchAllSources() {
    const all = [];

    // Source 1: bankr.bot API — fresh bankr token launches
    try {
      const data = await this._httpGet("https://api.bankr.bot/token-launches");
      if (data?.launches && Array.isArray(data.launches)) {
        for (const t of data.launches) {
          if (!t.tokenAddress || !t.tokenName || !t.tokenSymbol) continue;
          if (t.status !== "deployed") continue; // Only deployed tokens
          all.push({
            name: t.tokenName,
            symbol: t.tokenSymbol,
            address: t.tokenAddress.toLowerCase(),
            source: "bankr",
          });
        }
        this.log.info(`  Bankr: ${all.length} tokens fetched`);
      }
    } catch (e) {
      this.log.warn(`Bankr API error: ${e.message}`);
    }

    // Source 2: DexScreener token profiles — newly promoted Base tokens
    try {
      const data = await this._httpGet("https://api.dexscreener.com/token-profiles/latest/v1");
      if (Array.isArray(data)) {
        let count = 0;
        for (const t of data) {
          if (t.chainId !== "base" || !t.tokenAddress) continue;
          const addr = t.tokenAddress.toLowerCase();
          if (!all.find(a => a.address === addr)) {
            all.push({ name: null, symbol: null, address: addr, source: "dex-profile" });
            count++;
          }
          if (count >= 20) break;
        }
        if (count > 0) this.log.info(`  DexScreener profiles: ${count} Base tokens`);
      }
    } catch (e) {}

    // Source 3: DexScreener token boosts — boosted Base tokens
    try {
      const data = await this._httpGet("https://api.dexscreener.com/token-boosts/latest/v1");
      if (Array.isArray(data)) {
        let count = 0;
        for (const t of data) {
          if (t.chainId !== "base" || !t.tokenAddress) continue;
          const addr = t.tokenAddress.toLowerCase();
          if (!all.find(a => a.address === addr)) {
            all.push({ name: null, symbol: null, address: addr, source: "dex-boost" });
            count++;
          }
          if (count >= 10) break;
        }
        if (count > 0) this.log.info(`  DexScreener boosts: ${count} Base tokens`);
      }
    } catch (e) {}

    // Source 4: clanker.world API — newest clanker tokens (cross-platform snipe)
    try {
      const data = await this._httpGet("https://www.clanker.world/api/tokens?sort=desc&limit=30");
      if (data?.data && Array.isArray(data.data)) {
        let count = 0;
        for (const t of data.data) {
          const addr = (t.contract_address || t.address || "").toLowerCase();
          if (!addr || !t.name || !t.symbol) continue;
          if (!all.find(a => a.address === addr)) {
            all.push({
              name: t.name,
              symbol: t.symbol,
              address: addr,
              source: "clanker-cross",
            });
            count++;
          }
          if (count >= 30) break;
        }
        if (count > 0) this.log.info(`  Clanker cross-snipe: ${count} tokens`);
      }
    } catch (e) {}

    // Source 5: Tracked wallets — tokens from top deployers
    try {
      const walletTokens = await this._fetchTrackedWalletTokens();
      for (const t of walletTokens) {
        if (!all.find(a => a.address === t.address)) {
          all.push(t);
        }
      }
    } catch (e) {
      this.log.warn(`Tracked wallet fetch error: ${e.message}`);
    }

    return all;
  }

  // ── HOT TOKEN DETECTION ──

  async _findHotTokens(tokens) {
    const hot = [];
    const now = Date.now();

    // Batch check via DexScreener (max 30 addresses per call)
    for (let i = 0; i < tokens.length; i += 30) {
      const batch = tokens.slice(i, i + 30);
      const addresses = batch.map(t => t.address).join(",");

      try {
        const data = await this._httpGet(`https://api.dexscreener.com/latest/dex/tokens/${addresses}`);
        if (!data?.pairs) continue;

        for (const pair of data.pairs) {
          if (pair.chainId !== "base") continue;

          const pairAge = now - (pair.pairCreatedAt || 0);
          const vol24 = pair.volume?.h24 || 0;
          const vol1h = pair.volume?.h1 || 0;
          const vol = Math.max(vol24, vol1h);

          // CORE FILTER: token < 10 min old, real volume + txns, not over-hyped
          const txnCount = (pair.txns?.h1?.buys || 0) + (pair.txns?.h1?.sells || 0);
          if (pairAge > 0 && pairAge < MAX_TOKEN_AGE_MS && vol >= MIN_VOLUME_TRIGGER && vol <= MAX_VOLUME_CAP && txnCount >= MIN_TXN_COUNT) {
            const name = pair.baseToken?.name;
            const symbol = pair.baseToken?.symbol;
            const addr = pair.baseToken?.address?.toLowerCase();

            if (!name || !symbol || !addr) continue;
            if (this.duplicatedSources.has(addr)) continue;
            if (this.deployedNames.has(`${name}::${symbol}`)) continue;
            // Name quality gate — skip established coins, spam, generic names
            if (!isQualityName(name, symbol)) {
              this.log.info(`  SKIP (bad name): ${name} ($${symbol})`);
              continue;
            }

            const ageMin = Math.round(pairAge / 60000) || 1;
            hot.push({
              name,
              symbol,
              address: addr,
              volume: Math.round(vol),
              ageMinutes: ageMin,
              marketCap: Math.round(pair.marketCap || 0),
              txns: txnCount,
              volPerMin: Math.round(vol / ageMin),  // momentum score
            });
          }
        }
      } catch (e) {
        this.log.warn(`DexScreener batch check failed: ${e.message}`);
      }

      // Brief pause between batches
      if (i + 30 < tokens.length) await new Promise(r => setTimeout(r, 500));
    }

    // Sort by FRESHNESS first (youngest = best), then momentum as tiebreak
    // GeoMarket was caught at 1 min — being first is everything
    hot.sort((a, b) => {
      // Tokens <=2 min always beat older ones
      if (a.ageMinutes <= 2 && b.ageMinutes > 2) return -1;
      if (b.ageMinutes <= 2 && a.ageMinutes > 2) return 1;
      // Within same freshness tier, sort by momentum
      return b.volPerMin - a.volPerMin;
    });

    for (const t of hot) {
      this.log.info(`  HOT: ${t.symbol.padEnd(12)} age=${t.ageMinutes}min vol=$${t.volume} mc=$${t.marketCap} txns=${t.txns} vel=$${t.volPerMin}/min`);
    }

    return hot;
  }

  // ── INSTANT DEPLOYMENT ──

  async _deployDuplicate(sourceToken) {
    this.log.info(`\nDEPLOYING DUPLICATE: ${sourceToken.name} ($${sourceToken.symbol})`);
    this.log.info(`  Source: age=${sourceToken.ageMinutes}min vol=$${sourceToken.volume} txns=${sourceToken.txns}`);

    try {
      const { output, contractAddress } = await this._deployFast(sourceToken.name, sourceToken.symbol);

      const urlMatch = output.match(/https:\/\/www\.bankr\.bot\/launches\/0x[a-fA-F0-9]{40}/);

      const tokenRecord = {
        name: sourceToken.name,
        symbol: sourceToken.symbol,
        strategy: "instant_duplicate",
        contractAddress,
        chain: "base",
        bankrUrl: urlMatch ? urlMatch[0] : null,
        sourceAddress: sourceToken.address,
        sourceVolume: sourceToken.volume,
        sourceAge: sourceToken.ageMinutes,
        launchedAt: new Date().toISOString(),
        feesEarned: 0,
        feesClaimed: 0,
        volumeData: {},
      };

      this.tokenData.tokens.push(tokenRecord);
      this.tokenData.stats.totalLaunched++;
      this.tokenData.launchesToday++;
      this._saveTokenData();

      this.duplicatedSources.add(sourceToken.address);
      this.deployedNames.add(`${sourceToken.name}::${sourceToken.symbol}`);
      this.lastLaunchTime = Date.now();

      this._scheduleVolumeCheck(tokenRecord);

      this.perfData.duplications.total++;
      this._savePerformanceData();

      await this.notify(
        `🎯 *INSTANT DUPLICATE DEPLOYED!* [bankr → Base]\n` +
        `Name: ${sourceToken.name} ($${sourceToken.symbol})\n` +
        `Contract: \`${contractAddress}\`\n` +
        `Source token: age=${sourceToken.ageMinutes}min vol=$${sourceToken.volume} txns=${sourceToken.txns}\n` +
        `${urlMatch ? urlMatch[0] + "\n" : ""}` +
        `Today: ${this.tokenData.launchesToday}/${this.config.maxLaunchesPerDay} | Total: ${this.tokenData.stats.totalLaunched}`
      );

      this.log.info(`Duplicate deployed on Base at ${contractAddress}`);

      return tokenRecord;
    } catch (e) {
      this.log.error(`Deploy failed: ${e.message}`);
      await this.notify(`❌ Bankr deploy failed: ${sourceToken.name} ($${sourceToken.symbol}) — ${e.message.substring(0, 200)}`);
      return null;
    }
  }

  // ── SEEN TOKEN MANAGEMENT ──

  _pruneSeenTokens() {
    const now = Date.now();
    let pruned = 0;
    for (const [addr, firstSeen] of this.seenTokens) {
      if (now - firstSeen > SEEN_TOKEN_TTL_MS) {
        this.seenTokens.delete(addr);
        pruned++;
      }
    }
    if (pruned > 0) this.log.debug(`Pruned ${pruned} stale seen tokens. Active: ${this.seenTokens.size}`);
  }

  // ── VOLUME TRACKING ──

  _scheduleVolumeCheck(tokenRecord) {
    if (!tokenRecord.contractAddress) return;
    const now = Date.now();
    this.perfData.volumeChecks.push(
      { addr: tokenRecord.contractAddress, checkAt: now + 3600000, type: "1h" },
      { addr: tokenRecord.contractAddress, checkAt: now + 21600000, type: "6h" },
      { addr: tokenRecord.contractAddress, checkAt: now + 86400000, type: "24h" },
    );
    this._savePerformanceData();
  }

  async runVolumeChecks() {
    const now = Date.now();
    const due = (this.perfData.volumeChecks || []).filter(c => c.checkAt <= now);
    if (due.length === 0) return;

    this.log.info(`Running ${due.length} volume checks...`);
    const remaining = this.perfData.volumeChecks.filter(c => c.checkAt > now);

    for (const check of due) {
      try {
        const data = await this._httpGet(`https://api.dexscreener.com/latest/dex/tokens/${check.addr}`);
        const pair = (data?.pairs || []).find(p => p.chainId === "base");
        const vol24 = pair?.volume?.h24 || 0;
        const vol1h = pair?.volume?.h1 || 0;

        this.log.info(`  ${check.type}: ${check.addr.slice(0, 10)}... vol24=$${Math.round(vol24)} vol1h=$${Math.round(vol1h)}`);

        const token = this.tokenData.tokens.find(t => t.contractAddress === check.addr);
        if (token) {
          if (!token.volumeData) token.volumeData = {};
          token.volumeData[check.type] = { vol24, vol1h, checkedAt: new Date().toISOString() };

          // Track successful duplications (our token actually got volume!)
          if (check.type === "24h" && vol24 > 0) {
            this.perfData.duplications.successful = (this.perfData.duplications.successful || 0) + 1;
            this._savePerformanceData();
          }
          this._saveTokenData();
        }
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        this.log.warn(`Volume check failed: ${e.message}`);
      }
    }

    this.perfData.volumeChecks = remaining;
    this._savePerformanceData();
  }

  // ── FEE MANAGEMENT ──

  async checkFees() {
    this.log.info("Checking fees...");
    try {
      const output = this._runBankr("fees", 60000);

      const claimableMatch = output.match(/CLAIMABLE WETH[^│]*│[^│]*│\s*([\d.]+)/i) ||
                             output.match(/Claimable:\s*([\d.]+)\s*WETH/i) ||
                             output.match(/(\d+\.\d{4,})\s*│\s*pending/i);
      const claimable = claimableMatch ? parseFloat(claimableMatch[1]) : 0;

      const earnedMatch = output.match(/TOTAL EARNED[^│]*│[^│]*│\s*([\d.]+)/i);
      const totalEarned = earnedMatch ? parseFloat(earnedMatch[1]) : 0;

      if (totalEarned > 0) this.tokenData.stats.totalFeesEarned = totalEarned;
      this._saveTokenData();

      this.log.info(`Fees — Claimable: ${claimable} WETH | Earned: ${totalEarned} WETH`);

      if (claimable >= this.config.feeClaimThreshold) {
        await this.claimAllFees();
      }
      return { claimable, totalEarned };
    } catch (e) {
      this.log.warn(`Fee check failed: ${e.message}`);
      return null;
    }
  }

  async claimAllFees() {
    try {
      const output = this._runBankr("fees claim --yes", 120000);
      const amountMatch = output.match(/([\d.]+)\s*WETH/i);
      if (amountMatch) {
        const claimed = parseFloat(amountMatch[1]);
        this.tokenData.stats.totalFeesClaimed += claimed;
        this._saveTokenData();
        await this.notify(`💰 Fees claimed: ${claimed} WETH | Total: ${this.tokenData.stats.totalFeesClaimed.toFixed(6)} WETH`);
      }
    } catch (e) {
      this.log.error(`Fee claim failed: ${e.message}`);
    }
  }

  async checkClubGoal() {
    // Club already active — unlimited launches, 95% fee share
    if (!this.tokenData.clubGoal?.subscribed) {
      this.tokenData.clubGoal = { subscribed: true, subscribedAt: new Date().toISOString(), plan: "unlimited" };
      this._saveTokenData();
      this.log.info("Club status synced — unlimited launches active.");
    }
  }

  // ── TRENDING NARRATIVE LAUNCHES ──

  // ── SOLANA SNIPE DEPLOYMENT ──

  async _deploySolanaSnipe(token) {
    const results = [];

    // Deploy on Base (fast REST API)
    try {
      const { output, contractAddress } = await this._deployFast(token.name, token.symbol);
      const urlMatch = output.match(/https:\/\/www\.bankr\.bot\/launches\/0x[a-fA-F0-9]{40}/);

      const tokenRecord = {
        name: token.name,
        symbol: token.symbol,
        strategy: "solana_snipe",
        contractAddress,
        chain: "base",
        bankrUrl: urlMatch ? urlMatch[0] : null,
        sourceAddress: token.address,
        solVolume: token.solVolume,
        solTxns: token.solTxns,
        launchedAt: new Date().toISOString(),
        feesEarned: 0,
        feesClaimed: 0,
        volumeData: {},
      };

      this.tokenData.tokens.push(tokenRecord);
      this.tokenData.stats.totalLaunched++;
      this.tokenData.launchesToday++;
      this._saveTokenData();
      this._scheduleVolumeCheck(tokenRecord);
      this.perfData.duplications.total++;
      this._savePerformanceData();
      results.push(tokenRecord);

      await this.notify(
        `🌊 *SOLANA SNIPE!* [bankr → Base]\n` +
        `Name: ${token.name} ($${token.symbol})\n` +
        `Contract: \`${contractAddress}\`\n` +
        `Solana vol: $${token.solVolume} | txns: ${token.solTxns}\n` +
        `${urlMatch ? urlMatch[0] + "\n" : ""}` +
        `Today: ${this.tokenData.launchesToday}/${this.config.maxLaunchesPerDay}`
      );
    } catch (e) {
      this.log.error(`Solana snipe Base deploy failed: ${e.message}`);
    }

    this.duplicatedSources.add(token.address);
    this.deployedNames.add(`${token.name}::${token.symbol}`);
    this.lastLaunchTime = Date.now();

    return results.length > 0 ? results[0] : null;
  }

  // ── WALLET TRACKER DEPLOYMENT ──

  async _deployWalletTrack(token) {
    // Deploy on Base (primary)
    try {
      const { output, contractAddress } = await this._deployFast(token.name, token.symbol);
      const urlMatch = output.match(/https:\/\/www\.bankr\.bot\/launches\/0x[a-fA-F0-9]{40}/);

      const tokenRecord = {
        name: token.name,
        symbol: token.symbol,
        strategy: "wallet_tracker",
        contractAddress,
        chain: "base",
        bankrUrl: urlMatch ? urlMatch[0] : null,
        sourceAddress: token.address,
        trackedWallet: token.trackedWallet,
        launchedAt: new Date().toISOString(),
        feesEarned: 0,
        feesClaimed: 0,
        volumeData: {},
      };

      this.tokenData.tokens.push(tokenRecord);
      this.tokenData.stats.totalLaunched++;
      this.tokenData.launchesToday++;
      this._saveTokenData();

      this.duplicatedSources.add(token.address);
      this.deployedNames.add(`${token.name}::${token.symbol}`);
      this.lastLaunchTime = Date.now();
      this._scheduleVolumeCheck(tokenRecord);
      this.perfData.duplications.total++;
      this._savePerformanceData();

      await this.notify(
        `🔍 *WALLET TRACK DEPLOY!* [bankr → Base]\n` +
        `Name: ${token.name} ($${token.symbol})\n` +
        `Contract: \`${contractAddress}\`\n` +
        `Tracked deployer: ${token.trackedWallet}\n` +
        `${urlMatch ? urlMatch[0] + "\n" : ""}` +
        `Today: ${this.tokenData.launchesToday}/${this.config.maxLaunchesPerDay}`
      );

      return tokenRecord;
    } catch (e) {
      this.log.error(`Wallet track deploy failed: ${e.message}`);
      return null;
    }
  }

  // ── WALLET TRACKER: DISCOVER & TRACK TOP DEPLOYERS ──

  _loadTrackedWallets() {
    try {
      if (fs.existsSync(TRACKED_WALLETS_FILE)) {
        return JSON.parse(fs.readFileSync(TRACKED_WALLETS_FILE, "utf8"));
      }
    } catch {}
    return { wallets: [], lastDiscovery: null };
  }

  _saveTrackedWallets(data) {
    try { fs.writeFileSync(TRACKED_WALLETS_FILE, JSON.stringify(data, null, 2)); }
    catch (e) { this.log.error(`Tracked wallets save failed: ${e.message}`); }
  }

  async discoverTopDeployers() {
    this.log.info("── Discovering top token deployers ──");
    const walletData = this._loadTrackedWallets();
    const deployerMap = new Map(); // deployer → { tokens: [], totalVol }

    // Scan recent bankr launches for successful deployers
    try {
      const data = await this._httpGet("https://api.bankr.bot/token-launches");
      if (data?.launches && Array.isArray(data.launches)) {
        for (const t of data.launches) {
          if (!t.tokenAddress || t.status !== "deployed" || !t.deployer) continue;
          if (!deployerMap.has(t.deployer)) deployerMap.set(t.deployer, { tokens: [], totalVol: 0 });
          deployerMap.get(t.deployer).tokens.push(t.tokenAddress);
        }
      }
    } catch (e) { this.log.warn(`Bankr deployer scan failed: ${e.message}`); }

    // Scan DexScreener for Base tokens with volume — check their deployers
    try {
      const data = await this._httpGet("https://api.dexscreener.com/token-profiles/latest/v1");
      if (Array.isArray(data)) {
        const baseTokens = data.filter(t => t.chainId === "base" && t.tokenAddress).slice(0, 50);
        // Check volume in batches
        for (let i = 0; i < baseTokens.length; i += 30) {
          const batch = baseTokens.slice(i, i + 30);
          const addresses = batch.map(t => t.tokenAddress).join(",");
          try {
            const pairData = await this._httpGet(`https://api.dexscreener.com/latest/dex/tokens/${addresses}`);
            if (pairData?.pairs) {
              for (const pair of pairData.pairs) {
                if (pair.chainId !== "base") continue;
                const vol = pair.volume?.h24 || 0;
                if (vol > 1000 && pair.info?.deployer) {
                  const dep = pair.info.deployer.toLowerCase();
                  if (!deployerMap.has(dep)) deployerMap.set(dep, { tokens: [], totalVol: 0 });
                  const entry = deployerMap.get(dep);
                  entry.tokens.push(pair.baseToken?.address);
                  entry.totalVol += vol;
                }
              }
            }
          } catch {}
          if (i + 30 < baseTokens.length) await new Promise(r => setTimeout(r, 500));
        }
      }
    } catch {}

    // Rank deployers by number of tokens with volume
    const ranked = [...deployerMap.entries()]
      .filter(([, v]) => v.tokens.length >= 2)
      .sort((a, b) => b[1].totalVol - a[1].totalVol)
      .slice(0, 20);

    if (ranked.length > 0) {
      walletData.wallets = ranked.map(([addr, data]) => ({
        address: addr,
        tokenCount: data.tokens.length,
        totalVolume: Math.round(data.totalVol),
        trackedSince: new Date().toISOString(),
        lastTokens: data.tokens.slice(-5),
      }));
      walletData.lastDiscovery = new Date().toISOString();
      this._saveTrackedWallets(walletData);
      this.log.info(`Discovered ${ranked.length} top deployers. Top: ${ranked[0]?.[0]?.slice(0, 10)}... (${ranked[0]?.[1].tokens.length} tokens, $${Math.round(ranked[0]?.[1].totalVol)} vol)`);
    } else {
      this.log.info("No qualifying deployers found this cycle.");
    }
  }

  async _fetchTrackedWalletTokens() {
    const tokens = [];
    const walletData = this._loadTrackedWallets();
    if (!walletData.wallets || walletData.wallets.length === 0) return tokens;

    // Check each tracked wallet's recent token launches via bankr API
    try {
      const data = await this._httpGet("https://api.bankr.bot/token-launches");
      if (data?.launches && Array.isArray(data.launches)) {
        const trackedAddrs = new Set(walletData.wallets.map(w => w.address.toLowerCase()));
        for (const t of data.launches) {
          if (!t.deployer || !trackedAddrs.has(t.deployer.toLowerCase())) continue;
          if (!t.tokenAddress || !t.tokenName || !t.tokenSymbol) continue;
          if (t.status !== "deployed") continue;
          tokens.push({
            name: t.tokenName,
            symbol: t.tokenSymbol,
            address: t.tokenAddress.toLowerCase(),
            source: "wallet-tracker",
            trackedWallet: t.deployer,
          });
        }
        if (tokens.length > 0) this.log.info(`  Tracked wallets: ${tokens.length} tokens from top deployers`);
      }
    } catch (e) {
      this.log.warn(`Tracked wallet token fetch failed: ${e.message}`);
    }

    return tokens;
  }

  async _fetchTrendingNarratives() {
    const narratives = [];

    // Local social-trends.json
    try {
      const trendsFile = path.join(DATA_DIR, "social-trends.json");
      if (fs.existsSync(trendsFile)) {
        const trends = JSON.parse(fs.readFileSync(trendsFile, "utf8"));
        const coins = Array.isArray(trends) ? trends : (trends.coins || []);
        for (const t of coins.slice(0, 10)) {
          if (t.name && t.symbol && !narratives.find(n => n.symbol === t.symbol.toUpperCase())) {
            narratives.push({ name: t.name, symbol: t.symbol.toUpperCase(), score: t.score || 0, source: "local-trends" });
          }
        }
      }
    } catch {}

    return narratives;
  }

  async _launchTrendingToken() {
    if (!this._checkDailyLimit()) {
      this.log.info("Trending launch skipped — daily limit reached.");
      return null;
    }

    const narratives = await this._fetchTrendingNarratives();
    if (narratives.length === 0) {
      this.log.info("No trending narratives found for launch.");
      return null;
    }

    // Pick a trending coin we haven't deployed yet
    for (const trend of narratives) {
      const nameKey = `${trend.name}::${trend.symbol}`;
      if (this.deployedNames.has(nameKey)) continue;

      this.log.info(`\nTRENDING LAUNCH: ${trend.name} ($${trend.symbol}) [${trend.source}]`);

      try {
        const { output, contractAddress } = await this._deployFast(trend.name, trend.symbol);

        const urlMatch = output.match(/https:\/\/www\.bankr\.bot\/launches\/0x[a-fA-F0-9]{40}/);

        const tokenRecord = {
          name: trend.name,
          symbol: trend.symbol,
          strategy: "trending_narrative",
          contractAddress,
          chain: "base",
          bankrUrl: urlMatch ? urlMatch[0] : null,
          sourceAddress: null,
          trendSource: trend.source,
          trendScore: trend.score,
          launchedAt: new Date().toISOString(),
          feesEarned: 0,
          feesClaimed: 0,
          volumeData: {},
        };

        this.tokenData.tokens.push(tokenRecord);
        this.tokenData.stats.totalLaunched++;
        this.tokenData.launchesToday++;
        this._saveTokenData();

        this.deployedNames.add(nameKey);
        this._scheduleVolumeCheck(tokenRecord);
        this.lastLaunchTime = Date.now();

        await this.notify(
          `🔥 *TRENDING LAUNCH!* [bankr → Base]\n` +
          `Name: ${trend.name} ($${trend.symbol})\n` +
          `Contract: \`${contractAddress}\`\n` +
          `Trend: ${trend.source} (score: ${trend.score})\n` +
          `${urlMatch ? urlMatch[0] + "\n" : ""}` +
          `Today: ${this.tokenData.launchesToday}/${this.config.maxLaunchesPerDay}`
        );

        this.log.info(`Trending token deployed on Base at ${contractAddress}`);

        return tokenRecord;
      } catch (e) {
        this.log.error(`Trending launch failed for ${trend.name}: ${e.message}`);
        continue;
      }
    }

    this.log.info("All trending tokens already deployed.");
    return null;
  }

  // ── NOTIFICATION & STATS ──

  async notify(message) {
    for (const n of this.notifiers) {
      try { await n.broadcast(message); } catch (e) { this.log.error(`Notify error: ${e.message}`); }
    }
  }

  getStats() {
    return {
      ...this.tokenData.stats,
      tokens: this.tokenData.tokens.slice(-20),
      launchesToday: this.tokenData.launchesToday,
      clubGoal: this.tokenData.clubGoal,
      seenTokens: this.seenTokens.size,
      duplicatedSources: this.duplicatedSources.size,
      pendingVolumeChecks: (this.perfData.volumeChecks || []).length,
      duplications: this.perfData.duplications,
    };
  }
}

// ══════════════════════════════════════════════════════
// STANDALONE RUNNER
// ══════════════════════════════════════════════════════
if (require.main === module) {
  const cron = require("node-cron");
  const log = new Logger("bankr-main");

  const launcher = new BankrLauncher({
    config: {
      maxLaunchesPerDay: parseInt(process.env.BANKR_MAX_LAUNCHES_PER_DAY || "200"),
    },
  });

  log.info("=== BANKR LAUNCHER v9 (BASE SNIPER — FIXED FILTERS) STARTING ===");
  log.info(`Max launches/day: ${launcher.config.maxLaunchesPerDay} (Club: ACTIVE — unlimited, 95% fees)`);
  log.info(`Chain: Base (REST API)`);
  log.info(`Monitor: every 30s | Max token age: ${MAX_TOKEN_AGE_MS / 60000} min | Min volume: $${MIN_VOLUME_TRIGGER} | Max volume: $${MAX_VOLUME_CAP} | Min txns: ${MIN_TXN_COUNT}`);

  // CORE: Monitor every 30 seconds — speed is everything, GeoMarket was 1 min old
  cron.schedule("*/30 * * * * *", async () => {
    try { await launcher.monitorAndDuplicate(); }
    catch (e) { log.error("Monitor cycle error:", e.message); }
  });

  // Fee check: Every 2 hours
  cron.schedule("15 */2 * * *", async () => {
    try {
      log.info("─── Fee check ───");
      await launcher.checkFees();
      await launcher.checkClubGoal();
    } catch (e) { log.error("Fee cycle error:", e.message); }
  });

  // Volume checks: Every hour
  cron.schedule("30 * * * *", async () => {
    try {
      log.info("─── Volume checks ───");
      await launcher.runVolumeChecks();
    } catch (e) { log.error("Volume check error:", e.message); }
  });

  // Trending narrative launch: Every 3 hours
  cron.schedule("0 */3 * * *", async () => {
    try {
      log.info("─── Trending narrative launch ───");
      await launcher._launchTrendingToken();
    } catch (e) { log.error("Trending launch error:", e.message); }
  });

  // Wallet tracker: Discover top deployers every 6 hours
  cron.schedule("0 */6 * * *", async () => {
    try {
      log.info("─── Wallet tracker discovery ───");
      await launcher.discoverTopDeployers();
    } catch (e) { log.error("Wallet tracker error:", e.message); }
  });

  // Initial run
  (async () => {
    try {
      log.info("Running initial monitor cycle...");
      await launcher.discoverTopDeployers();
      await launcher.monitorAndDuplicate();
      await launcher.checkFees();
    } catch (e) {
      log.error("Initial run error:", e.message);
    }
  })();
}

module.exports = { BankrLauncher };
