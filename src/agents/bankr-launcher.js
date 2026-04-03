/**
 * Bankr Token Launcher Agent v5 — Instant Sniper Duplicate Engine
 *
 * STRATEGY: Monitor for brand-new token launches every 2 minutes.
 * When a fresh token (<10 min old) shows ANY volume on DexScreener,
 * IMMEDIATELY deploy a duplicate on bankr.bot to catch sniper bots.
 *
 * Why this works:
 *   - Sniper bots buy tokens with certain names IMMEDIATELY on launch
 *   - If we deploy a duplicate within minutes, snipers may buy ours too
 *   - Speed > strategy — timing is everything
 *
 * Sources monitored:
 *   1. api.bankr.bot/token-launches — bankr's own fresh token launches
 *   2. DexScreener token profiles — newly promoted Base tokens
 *   3. DexScreener token boosts — boosted Base tokens
 */

require("dotenv").config();
const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");
const { Logger } = require("../utils/logger");

// ── FILE PATHS ──
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const TOKENS_FILE = path.join(DATA_DIR, "bankr-tokens.json");
const PERFORMANCE_FILE = path.join(DATA_DIR, "bankr-performance.json");

// ── INSTANT SNIPER CONFIG ──
const FEE_WALLET = process.env.BANKR_FEE_WALLET || "0x162ee01a2eab184f6698ec8663ad84c4ee506733";
const CLUB_COST_WETH = 0.02;
const MAX_TOKEN_AGE_MS = 10 * 60 * 1000;    // Only duplicate tokens < 10 minutes old
const MIN_VOLUME_TRIGGER = 50;                // $50 volume = sniper activity detected
const SEEN_TOKEN_TTL_MS = 60 * 60 * 1000;    // Forget tokens seen > 1 hour ago

class BankrLauncher {
  constructor({ notifiers = [], config = {} }) {
    this.notifiers = notifiers;
    this.config = {
      maxLaunchesPerDay: config.maxLaunchesPerDay || 10,
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
      clubGoal: { target: CLUB_COST_WETH, subscribed: false },
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

  // Fast deployment — direct CLI, no agent, no image, maximum speed
  _deployFast(name, symbol) {
    const safeName = name.replace(/"/g, '\\"');
    const safeSymbol = symbol.replace(/"/g, '\\"');

    const cmd = `bankr launch --name "${safeName}" --symbol "${safeSymbol}" --fee ${FEE_WALLET} --fee-type wallet --yes`;
    this.log.info(`FAST DEPLOY: ${cmd}`);

    const result = spawnSync(cmd, {
      encoding: "utf8",
      timeout: 120000,
      stdio: ["pipe", "pipe", "pipe"],
      input: "\n\n\n\n\n\n\n\n\n\n",
      shell: true,
    });
    const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
    this.log.info(`Deploy output (exit ${result.status}): ${output.substring(0, 500)}`);

    // If direct launch didn't return address, try agent as fallback
    let addressMatch = output.match(/0x[a-fA-F0-9]{40}/);
    if (addressMatch) {
      return { output, contractAddress: addressMatch[0] };
    }

    // Fallback: bankr agent (handles image + deploy, slower but more reliable)
    this.log.info("Direct launch gave no address. Trying bankr agent...");
    const agentPrompt = `launch a token with name "${safeName}" and symbol "${safeSymbol}". set fee recipient to wallet address ${FEE_WALLET}. generate an image for the token.`;
    const agentResult = spawnSync("bankr", ["agent", agentPrompt], {
      encoding: "utf8",
      timeout: 180000,
      stdio: ["pipe", "pipe", "pipe"],
      input: "\n\n\n\n\n\n\n\n\n\n",
      shell: true,
    });
    const agentOutput = `${agentResult.stdout || ""}\n${agentResult.stderr || ""}`.trim();
    this.log.info(`Agent output (exit ${agentResult.status}): ${agentOutput.substring(0, 500)}`);

    addressMatch = agentOutput.match(/0x[a-fA-F0-9]{40}/);
    if (!addressMatch) {
      throw new Error(`No contract address from either method: ${output.substring(0, 200)}`);
    }
    return { output: agentOutput, contractAddress: addressMatch[0] };
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
      this.log.info("No hot tokens found (none with volume in first 10 min).");
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

          // CORE FILTER: token < 10 min old AND has volume
          if (pairAge > 0 && pairAge < MAX_TOKEN_AGE_MS && vol >= MIN_VOLUME_TRIGGER) {
            const name = pair.baseToken?.name;
            const symbol = pair.baseToken?.symbol;
            const addr = pair.baseToken?.address?.toLowerCase();

            if (!name || !symbol || !addr) continue;
            if (this.duplicatedSources.has(addr)) continue;
            if (this.deployedNames.has(`${name}::${symbol}`)) continue;

            hot.push({
              name,
              symbol,
              address: addr,
              volume: Math.round(vol),
              ageMinutes: Math.round(pairAge / 60000),
              marketCap: Math.round(pair.marketCap || 0),
              txns: (pair.txns?.h1?.buys || 0) + (pair.txns?.h1?.sells || 0),
            });
          }
        }
      } catch (e) {
        this.log.warn(`DexScreener batch check failed: ${e.message}`);
      }

      // Brief pause between batches
      if (i + 30 < tokens.length) await new Promise(r => setTimeout(r, 500));
    }

    // Sort by volume — highest volume = strongest sniper activity
    hot.sort((a, b) => b.volume - a.volume);

    for (const t of hot) {
      this.log.info(`  HOT: ${t.symbol.padEnd(12)} age=${t.ageMinutes}min vol=$${t.volume} mc=$${t.marketCap} txns=${t.txns}`);
    }

    return hot;
  }

  // ── INSTANT DEPLOYMENT ──

  async _deployDuplicate(sourceToken) {
    this.log.info(`\nDEPLOYING DUPLICATE: ${sourceToken.name} ($${sourceToken.symbol})`);
    this.log.info(`  Source: age=${sourceToken.ageMinutes}min vol=$${sourceToken.volume} txns=${sourceToken.txns}`);

    try {
      const { output, contractAddress } = this._deployFast(sourceToken.name, sourceToken.symbol);

      const urlMatch = output.match(/https:\/\/www\.bankr\.bot\/launches\/0x[a-fA-F0-9]{40}/);

      const tokenRecord = {
        name: sourceToken.name,
        symbol: sourceToken.symbol,
        strategy: "instant_duplicate",
        contractAddress,
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

      this._scheduleVolumeCheck(tokenRecord);

      this.perfData.duplications.total++;
      this._savePerformanceData();

      await this.notify(
        `🎯 *INSTANT DUPLICATE DEPLOYED!* [bankr]\n` +
        `Name: ${sourceToken.name} ($${sourceToken.symbol})\n` +
        `Contract: \`${contractAddress}\`\n` +
        `Source token: age=${sourceToken.ageMinutes}min vol=$${sourceToken.volume} txns=${sourceToken.txns}\n` +
        `${urlMatch ? urlMatch[0] + "\n" : ""}` +
        `Today: ${this.tokenData.launchesToday}/${this.config.maxLaunchesPerDay} | Total: ${this.tokenData.stats.totalLaunched}`
      );

      this.log.info(`Duplicate deployed at ${contractAddress}`);
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
    if (this.tokenData.clubGoal?.subscribed) return;
    const earned = this.tokenData.stats.totalFeesClaimed;
    if (earned >= CLUB_COST_WETH) {
      this.log.info("Club goal reached! Subscribing...");
      try {
        this._runBankr('agent "subscribe to bankr club monthly plan"', 120000);
        this.tokenData.clubGoal.subscribed = true;
        this.tokenData.clubGoal.subscribedAt = new Date().toISOString();
        this._saveTokenData();
        await this.notify(`🎉 BANKR CLUB SUBSCRIBED! Fee share: 57% → 95%`);
      } catch (e) {
        this.log.error(`Club subscription failed: ${e.message}`);
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
      maxLaunchesPerDay: parseInt(process.env.BANKR_MAX_LAUNCHES_PER_DAY || "10"),
    },
  });

  log.info("=== BANKR LAUNCHER v5 (INSTANT SNIPER DUPLICATE) STARTING ===");
  log.info(`Max launches/day: ${launcher.config.maxLaunchesPerDay}`);
  log.info(`Monitor: every 2 min | Max token age: ${MAX_TOKEN_AGE_MS / 60000} min | Min volume: $${MIN_VOLUME_TRIGGER}`);

  // CORE: Monitor every 2 minutes for hot new tokens to duplicate
  cron.schedule("*/2 * * * *", async () => {
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

  // Initial run
  (async () => {
    try {
      log.info("Running initial monitor cycle...");
      await launcher.monitorAndDuplicate();
      await launcher.checkFees();
    } catch (e) {
      log.error("Initial run error:", e.message);
    }
  })();
}

module.exports = { BankrLauncher };
