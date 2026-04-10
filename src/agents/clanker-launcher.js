/**
 * Clanker Token Launcher Agent v3 — Instant Sniper Duplicate Engine
 *
 * STRATEGY: Monitor for brand-new token launches every 2 minutes.
 * When a fresh token (<10 min old) shows ANY volume on DexScreener,
 * IMMEDIATELY deploy a duplicate via Clanker SDK to catch sniper bots.
 *
 * Same approach as bankr v5 but deploys on Clanker (clanker-sdk CLI).
 *
 * Sources monitored:
 *   1. clanker.world API — newest clanker token launches
 *   2. DexScreener token profiles — newly promoted Base tokens
 *   3. DexScreener token boosts — boosted Base tokens
 */

require("dotenv").config();
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");
const { Logger } = require("../utils/logger");

// ── FILE PATHS ──
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const CLANKER_TOKENS_FILE = path.join(DATA_DIR, "clanker-tokens.json");
const CLANKER_PERF_FILE = path.join(DATA_DIR, "clanker-performance.json");

// ── INSTANT SNIPER CONFIG ──
const WALLET_ADDR = process.env.CLANKER_FEE_WALLET || "0x162ee01a2eab184f6698ec8663ad84c4ee506733";
const MAX_TOKEN_AGE_MS = 30 * 60 * 1000;    // Duplicate tokens < 30 minutes old (wider net = more launches)
const MIN_VOLUME_TRIGGER = 500;               // $500 volume = real traction (filters noise)
const MIN_TXN_COUNT = 5;                      // At least 5 txns = real interest, not bot wash
const SEEN_TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // Forget tokens seen > 2 hours ago
const INITIAL_MARKET_CAP = "5";               // 5 ETH initial mcap

class ClankerLauncher {
  constructor({ notifiers = [], config = {} }) {
    this.notifiers = notifiers;
    this.config = {
      maxLaunchesPerDay: config.maxLaunchesPerDay || 50,
      ...config,
    };
    this.log = new Logger("clanker-launcher");
    this._ensureDataDir();
    this.tokenData = this._loadTokenData();
    this.perfData = this._loadPerformanceData();

    // Track tokens we've already seen (address → firstSeen timestamp)
    this.seenTokens = new Map();
    // Track source tokens we've already duplicated (by address)
    this.duplicatedSources = new Set(
      this.tokenData.tokens.filter(t => t.sourceAddress).map(t => t.sourceAddress)
    );
    // Track names we've already deployed
    this.deployedNames = new Set(
      this.tokenData.tokens.map(t => `${t.name}::${t.symbol}`)
    );

    this.log.info(
      `Clanker Launcher v3 (instant sniper) initialized. ` +
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
      if (fs.existsSync(CLANKER_TOKENS_FILE)) {
        const data = JSON.parse(fs.readFileSync(CLANKER_TOKENS_FILE, "utf8"));
        if (!data.dailyHistory) data.dailyHistory = [];
        return data;
      }
    } catch {}
    return {
      tokens: [],
      stats: { totalLaunched: 0, totalFeesEarned: 0 },
      lastLaunchDate: null,
      launchesToday: 0,
      dailyHistory: [],
    };
  }

  _loadPerformanceData() {
    try {
      if (fs.existsSync(CLANKER_PERF_FILE)) {
        const data = JSON.parse(fs.readFileSync(CLANKER_PERF_FILE, "utf8"));
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
    try { fs.writeFileSync(CLANKER_TOKENS_FILE, JSON.stringify(this.tokenData, null, 2)); }
    catch (e) { this.log.error(`Token data save failed: ${e.message}`); }
  }

  _savePerformanceData() {
    try { fs.writeFileSync(CLANKER_PERF_FILE, JSON.stringify(this.perfData, null, 2)); }
    catch (e) { this.log.error(`Performance data save failed: ${e.message}`); }
  }

  // ── HTTP HELPER ──

  _httpGet(url) {
    return new Promise((resolve) => {
      const req = https.get(url, { headers: { "User-Agent": "ClankerSniper/3.0" } }, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
      });
      req.on("error", () => resolve(null));
      req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    });
  }

  // Fast deployment via clanker-sdk CLI
  _deployFast(name, symbol) {
    const safeName = name.replace(/"/g, '\\"');
    const safeSymbol = symbol.replace(/"/g, '\\"');
    const desc = `${name} — deployed via Clanker. Contract verified`;

    const rewardRecipients = JSON.stringify([{
      admin: WALLET_ADDR,
      recipient: WALLET_ADDR,
      bps: 10000,
      token: "Paired",
    }]).replace(/"/g, '\\"');

    const cmd = `npx clanker-sdk deploy --chain base --name "${safeName}" --symbol "${safeSymbol}" --description "${desc}" --starting-market-cap ${INITIAL_MARKET_CAP} --reward-recipients "${rewardRecipients}" --dev-buy-eth 0 --json`;

    this.log.info(`FAST DEPLOY: ${cmd.substring(0, 300)}`);

    const result = spawnSync(cmd, {
      encoding: "utf8",
      timeout: 180000,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
      env: { ...process.env },
    });

    const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
    this.log.info(`Deploy output (exit ${result.status}): ${output.substring(0, 600)}`);

    // Extract contract address — try JSON first
    let tokenAddress = null;
    try {
      const lines = output.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("{")) {
          const json = JSON.parse(trimmed);
          tokenAddress = json.tokenAddress || json.address || json.token;
          break;
        }
      }
    } catch {}

    // Fallback: regex
    if (!tokenAddress) {
      const addrMatch = output.match(/(?:token\s*(?:address|at|deployed)[:\s]*)(0x[a-fA-F0-9]{40})/i)
        || output.match(/0x[a-fA-F0-9]{40}/);
      tokenAddress = addrMatch ? addrMatch[1] || addrMatch[0] : null;
    }

    if (!tokenAddress) {
      throw new Error(`No contract address: ${output.substring(0, 300)}`);
    }

    return { output, contractAddress: tokenAddress };
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

    // 1. Prune stale entries
    this._pruneSeenTokens();

    // 2. Fetch candidate tokens from all sources
    const candidates = await this._fetchAllSources();

    // 3. Filter out already-duplicated and already-deployed
    const unchecked = candidates.filter(t => {
      if (this.duplicatedSources.has(t.address)) return false;
      if (t.name && t.symbol && this.deployedNames.has(`${t.name}::${t.symbol}`)) return false;
      return true;
    });

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
      return;
    }

    this.log.info(`${hotTokens.length} HOT TOKEN(S) detected! Deploying duplicates...`);

    // 7. Deploy duplicates
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

    // Source 1: clanker.world API — newest tokens
    try {
      const data = await this._httpGet("https://www.clanker.world/api/tokens?sort=desc&limit=20");
      if (data?.data && Array.isArray(data.data)) {
        for (const t of data.data) {
          const addr = t.contract_address || t.address;
          if (!addr || !t.name || !t.symbol) continue;
          all.push({
            name: t.name,
            symbol: t.symbol,
            address: addr.toLowerCase(),
            source: "clanker",
          });
        }
        this.log.info(`  Clanker: ${all.length} tokens fetched`);
      }
    } catch (e) {
      this.log.warn(`Clanker API error: ${e.message}`);
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

    // Source 3: DexScreener token boosts
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

    // Source 4: DexScreener new pairs — freshly created Base pairs
    try {
      const data = await this._httpGet("https://api.dexscreener.com/latest/dex/pairs/base?sort=pairAge&order=asc");
      if (data?.pairs && Array.isArray(data.pairs)) {
        let count = 0;
        for (const pair of data.pairs) {
          if (!pair.baseToken?.address) continue;
          const addr = pair.baseToken.address.toLowerCase();
          if (!all.find(a => a.address === addr)) {
            all.push({
              name: pair.baseToken.name || null,
              symbol: pair.baseToken.symbol || null,
              address: addr,
              source: "dex-new-pairs",
            });
            count++;
          }
          if (count >= 30) break;
        }
        if (count > 0) this.log.info(`  DexScreener new pairs: ${count} Base tokens`);
      }
    } catch (e) {}

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

          // CORE FILTER: token < 30 min old AND has real volume + transaction count
          const txnCount = (pair.txns?.h1?.buys || 0) + (pair.txns?.h1?.sells || 0);
          if (pairAge > 0 && pairAge < MAX_TOKEN_AGE_MS && vol >= MIN_VOLUME_TRIGGER && txnCount >= MIN_TXN_COUNT) {
            const name = pair.baseToken?.name;
            const symbol = pair.baseToken?.symbol;
            const addr = pair.baseToken?.address?.toLowerCase();

            if (!name || !symbol || !addr) continue;
            if (this.duplicatedSources.has(addr)) continue;
            if (this.deployedNames.has(`${name}::${symbol}`)) continue;

            const ageMin = Math.round(pairAge / 60000) || 1;
            hot.push({
              name,
              symbol,
              address: addr,
              volume: Math.round(vol),
              ageMinutes: ageMin,
              marketCap: Math.round(pair.marketCap || 0),
              txns: txnCount,
              volPerMin: Math.round(vol / ageMin),
            });
          }
        }
      } catch (e) {
        this.log.warn(`DexScreener batch check failed: ${e.message}`);
      }

      if (i + 30 < tokens.length) await new Promise(r => setTimeout(r, 500));
    }

    // Sort by momentum (vol per minute) — highest momentum = best sniper target
    hot.sort((a, b) => b.volPerMin - a.volPerMin);

    for (const t of hot) {
      this.log.info(`  HOT: ${t.symbol.padEnd(12)} age=${t.ageMinutes}min vol=$${t.volume} mc=$${t.marketCap} txns=${t.txns} vel=$${t.volPerMin}/min`);
    }

    return hot;
  }

  // ── INSTANT DEPLOYMENT ──

  async _deployDuplicate(sourceToken) {
    this.log.info(`\nDEPLOYING DUPLICATE: ${sourceToken.name} ($${sourceToken.symbol})`);
    this.log.info(`  Source: age=${sourceToken.ageMinutes}min vol=$${sourceToken.volume} txns=${sourceToken.txns}`);

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      this.log.error("PRIVATE_KEY not set — cannot deploy.");
      return null;
    }

    try {
      const { output, contractAddress } = this._deployFast(sourceToken.name, sourceToken.symbol);

      const tokenRecord = {
        name: sourceToken.name,
        symbol: sourceToken.symbol,
        strategy: "instant_duplicate",
        contractAddress,
        chain: "base",
        sourceAddress: sourceToken.address,
        sourceVolume: sourceToken.volume,
        sourceAge: sourceToken.ageMinutes,
        launchedAt: new Date().toISOString(),
        deployer: WALLET_ADDR,
        feesEarned: 0,
        volumeData: {},
      };

      this.tokenData.tokens.push(tokenRecord);
      this.tokenData.stats.totalLaunched++;
      this.tokenData.launchesToday++;
      this._saveTokenData();

      this.duplicatedSources.add(sourceToken.address);
      this.deployedNames.add(`${sourceToken.name}::${sourceToken.symbol}`);

      this._scheduleVolumeCheck(tokenRecord);

      this.perfData.duplications.total++;
      this._savePerformanceData();

      await this.notify(
        `🎯 *INSTANT DUPLICATE DEPLOYED!* [clanker]\n` +
        `Name: ${sourceToken.name} ($${sourceToken.symbol})\n` +
        `Contract: \`${contractAddress}\`\n` +
        `Source token: age=${sourceToken.ageMinutes}min vol=$${sourceToken.volume} txns=${sourceToken.txns}\n` +
        `View: https://clanker.world/clanker/${contractAddress}\n` +
        `Today: ${this.tokenData.launchesToday}/${this.config.maxLaunchesPerDay} | Total: ${this.tokenData.stats.totalLaunched}`
      );

      this.log.info(`Duplicate deployed at ${contractAddress}`);
      return tokenRecord;
    } catch (e) {
      this.log.error(`Deploy failed: ${e.message}`);
      await this.notify(`❌ Clanker deploy failed: ${sourceToken.name} ($${sourceToken.symbol}) — ${e.message.substring(0, 200)}`);
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

  // ── REWARD CLAIMING ──

  async claimRewards() {
    this.log.info("Checking creator rewards...");
    const tokensWithAddr = this.tokenData.tokens.filter(t => t.contractAddress);
    if (tokensWithAddr.length === 0) {
      this.log.info("No deployed tokens to claim rewards for.");
      return;
    }

    for (const token of tokensWithAddr.slice(-10)) {
      try {
        const result = spawnSync("npx", [
          "clanker-sdk", "rewards", "claim",
          "--chain", "base",
          "--token", token.contractAddress,
          "--json",
        ], {
          encoding: "utf8",
          timeout: 60000,
          stdio: ["pipe", "pipe", "pipe"],
          shell: true,
          env: { ...process.env },
        });
        const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
        if (output && !output.includes("no rewards") && !output.includes("0.0")) {
          this.log.info(`Reward claim ${token.symbol}: ${output.substring(0, 300)}`);
        }
        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        this.log.warn(`Reward claim failed for ${token.symbol}: ${e.message}`);
      }
    }
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
  const log = new Logger("clanker-main");

  const launcher = new ClankerLauncher({
    config: {
      maxLaunchesPerDay: parseInt(process.env.CLANKER_MAX_LAUNCHES_PER_DAY || "50"),
    },
  });

  log.info("=== CLANKER LAUNCHER v3 (INSTANT SNIPER DUPLICATE) STARTING ===");
  log.info(`Max launches/day: ${launcher.config.maxLaunchesPerDay}`);
  log.info(`Monitor: every 1 min | Max token age: ${MAX_TOKEN_AGE_MS / 60000} min | Min volume: $${MIN_VOLUME_TRIGGER} | Min txns: ${MIN_TXN_COUNT}`);

  // CORE: Monitor every 1 minute for hot new tokens to duplicate
  cron.schedule("* * * * *", async () => {
    try { await launcher.monitorAndDuplicate(); }
    catch (e) { log.error("Monitor cycle error:", e.message); }
  });

  // Reward check: Every 4 hours
  cron.schedule("30 */4 * * *", async () => {
    try {
      log.info("─── Reward check ───");
      await launcher.claimRewards();
    } catch (e) { log.error("Reward cycle error:", e.message); }
  });

  // Volume checks: Every hour
  cron.schedule("45 * * * *", async () => {
    try {
      log.info("─── Volume checks ───");
      await launcher.runVolumeChecks();
    } catch (e) { log.error("Volume check error:", e.message); }
  });

  // Initial run
  (async () => {
    try {
      log.info("Running initial monitor cycle...");
      await launcher.monitorAndDuplicate();
      await launcher.claimRewards();
    } catch (e) {
      log.error("Initial run error:", e.message);
    }
  })();
}

module.exports = { ClankerLauncher };
