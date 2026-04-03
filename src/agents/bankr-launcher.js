/**
 * Bankr Token Launcher Agent v4 — Real-Time Duplication Engine
 *
 * GOALS:
 *   1. Max out 10 token launches EVERY SINGLE DAY
 *   2. Monitor FRESH launches with volume in real-time
 *   3. Duplicate EXACT names of tokens getting volume RIGHT NOW
 *   4. Clone top bankr token names (proven $50K-$200K+ daily volume)
 *   5. Use trending keywords that trigger sniper bot buys
 *
 * Research-backed strategies:
 *   1. live_duplicate — Copy fresh tokens (<24h) with volume from bankr/clanker
 *   2. top_clone — Duplicate names of top 20 bankr tokens by volume
 *   3. trending — Current event/keyword tokens (sniper bots scan for these)
 *   4. agent_meta — Agent narrative tokens (99% of top bankr tokens are agents)
 *
 * WHY this works:
 *   - Sniper bots scan for trending keywords in new token names
 *   - Top bankr tokens ($CLAWD $217K/day) prove agent narrative drives volume
 *   - Fresh duplicates of hot tokens always get some bot buys
 *   - The key is SPEED: duplicate what's trending NOW, not yesterday
 */
require("dotenv").config();
const { execSync, spawnSync } = require("child_process");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { Logger } = require("../utils/logger");
const { getTokenImageUrl } = require("../utils/token-image-gen");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const TOKENS_FILE = path.join(DATA_DIR, "bankr-tokens.json");
const RESEARCH_FILE = path.join(DATA_DIR, "bankr-research.json");
const PERFORMANCE_FILE = path.join(DATA_DIR, "bankr-performance.json");

// Bankr Club goal: ~0.01 WETH ≈ $20 at current ETH prices
const CLUB_COST_WETH = 0.01;

// ════════════════════════════════════════════════════
// STRATEGY 1: TOP BANKR TOKEN CLONES
// These are the ACTUAL top 20 bankr tokens with $50K-$200K+ daily volume
// Duplicating their exact names/themes gets bot attention
// ════════════════════════════════════════════════════
const TOP_BANKR_CLONES = [
  // Top earners ($100K+ vol/day) — clone these first
  { name: "GITLAWB", symbol: "GITLAWB", reason: "$217K vol/day, highest vol/mc ratio" },
  { name: "FELIX", symbol: "FELIX", reason: "$151K vol/day, agent token" },
  { name: "KellyClaude", symbol: "KELLY", reason: "$144K vol/day, AI agent" },
  { name: "Robot Money", symbol: "ROBOTMONEY", reason: "$85K vol/day" },
  { name: "cyb3rwr3n", symbol: "CYB3R", reason: "$87K vol/day, agent" },
  { name: "CLAWD", symbol: "CLAWD", reason: "$86K vol/day, #1 MC on bankr" },
  { name: "AGNT SOCIAL", symbol: "AGNT", reason: "$79K vol/day, agent narrative" },

  // Mid-tier ($20K-$80K vol/day)
  { name: "Juno Agent", symbol: "JUNO", reason: "$71K vol/day, agent" },
  { name: "Moltbook", symbol: "MOLT", reason: "$66K vol/day" },
  { name: "LITCOIN", symbol: "LITCOIN", reason: "$38K vol/day, GOING UP +9.6%" },
  { name: "Doppel", symbol: "DOPPEL", reason: "$40K vol/day" },
  { name: "BOTCOIN", symbol: "BOTCOIN", reason: "$28K vol/day, bot/agent" },
  { name: "SAIRI", symbol: "SAIRI", reason: "$26K vol/day, AI narrative" },
  { name: "AntiHunter", symbol: "ANTIHUNTER", reason: "$20K vol/day" },
  { name: "Molten", symbol: "MOLTEN", reason: "$17K vol/day" },
];

// ════════════════════════════════════════════════════
// STRATEGY 2: AGENT META TOKENS
// 99% of successful bankr tokens are agent-themed
// These names combine AI + agent + crypto culture
// ════════════════════════════════════════════════════
const AGENT_META_TOKENS = [
  { name: "Defense of the Agents", symbol: "DOTA", reason: "$232K vol, gaming+agent narrative" },
  { name: "Agent Zero", symbol: "AGENT0" },
  { name: "Onchain Brain", symbol: "BRAIN" },
  { name: "Sentient Coin", symbol: "SENTIENT" },
  { name: "DegenAI", symbol: "DEGENAI" },
  { name: "Based Agent", symbol: "BAGENT" },
  { name: "AI Fren", symbol: "AIFREN" },
  { name: "Neural Protocol", symbol: "NEURAL" },
  { name: "Agent Smith", symbol: "SMITH" },
  { name: "Skynet", symbol: "SKYNET" },
  { name: "Autonomous Bot", symbol: "AUTOBOT" },
  { name: "GPT Protocol", symbol: "GPT" },
  { name: "Robot Overlord", symbol: "OVERLORD" },
  { name: "Singularity", symbol: "SING" },
  { name: "Turbo AI", symbol: "TURBO" },
];

// ════════════════════════════════════════════════════
// STRATEGY 3: TRENDING KEYWORD TOKENS
// Sniper bots scan for these keywords in new launches
// Updated based on what's generating volume RIGHT NOW
// ════════════════════════════════════════════════════
const TRENDING_KEYWORD_TOKENS = [
  // Tokens that got volume in last 24h from keyword matching
  { name: "gork", symbol: "GORK", reason: "$652 vol in 1h, xAI/Elon keyword" },
  { name: "BasePEPE", symbol: "BASEPEPE", reason: "$1.1K vol in 9h, Pepe on Base" },
  { name: "trump on base", symbol: "TRUMP", reason: "trending political keyword" },
  { name: "tariff coin", symbol: "TARIFF", reason: "trending news keyword" },
  { name: "Solana", symbol: "SOL", reason: "cross-chain name duplicate" },
  { name: "Fartcoin", symbol: "FART", reason: "$3.5K vol, viral meme" },
  { name: "Higher", symbol: "HIGHER", reason: "Base culture token" },
  { name: "Toshi", symbol: "TOSHI", reason: "Base OG culture" },
  { name: "Brett", symbol: "BRETT", reason: "Base blue chip meme" },
  { name: "Degen", symbol: "DEGEN", reason: "Base native culture" },
  { name: "Normie", symbol: "NORMIE", reason: "Base meme" },
  { name: "Aero", symbol: "AERO", reason: "Aerodrome reference" },
];

// Default strategy weights — live_duplicate dominates because
// duplicating tokens that ALREADY have volume is the only proven way to get volume.
// Research: 0 of 21 tokens with static names got any volume. All winners are duplicates.
const DEFAULT_STRATEGY_MIX = { live_duplicate: 6, top_clone: 2, agent_meta: 1, trending: 1 };

class BankrLauncher {
  constructor({ notifiers = [], config = {} }) {
    this.notifiers = notifiers;
    this.config = {
      maxLaunchesPerDay: config.maxLaunchesPerDay || 10,
      feeClaimThreshold: config.feeClaimThreshold || 0.0001,
      // Spread launches across the full day to guarantee all 10 fire
      launchWindowStart: config.launchWindowStart || 8,   // 8 UTC
      launchWindowEnd: config.launchWindowEnd || 23,       // 23 UTC (15h window)
      ...config,
    };
    this.log = new Logger("bankr-launcher");
    this._ensureDataDir();
    this.tokenData = this._loadTokenData();
    this.researchData = this._loadResearchData();
    this.perfData = this._loadPerformanceData();
    this.log.info(
      `Bankr Launcher v3 (self-learning) initialized. ` +
      `${this.tokenData.tokens.length} tracked, ${this.tokenData.stats.totalLaunched} launched, ` +
      `${this.tokenData.stats.totalFeesClaimed.toFixed(6)} WETH claimed. ` +
      `Club progress: ${((this.tokenData.stats.totalFeesClaimed / CLUB_COST_WETH) * 100).toFixed(1)}%`
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
        // Ensure new fields exist
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

  _loadResearchData() {
    try {
      if (fs.existsSync(RESEARCH_FILE)) return JSON.parse(fs.readFileSync(RESEARCH_FILE, "utf8"));
    } catch {}
    return { trendingRepos: [], hotTokens: [], lastFetch: null };
  }

  _loadPerformanceData() {
    try {
      if (fs.existsSync(PERFORMANCE_FILE)) {
        const data = JSON.parse(fs.readFileSync(PERFORMANCE_FILE, "utf8"));
        // Migrate old strategies to new ones
        if (data.adaptiveMix && (data.adaptiveMix.github !== undefined || data.adaptiveMix.meme !== undefined)) {
          data.adaptiveMix = { ...DEFAULT_STRATEGY_MIX };
          data.strategyScores = {
            live_duplicate: { totalVol: 0, count: 0 },
            top_clone: { totalVol: 0, count: 0 },
            agent_meta: { totalVol: 0, count: 0 },
            trending: { totalVol: 0, count: 0 },
          };
        }
        return data;
      }
    } catch {}
    return {
      strategyScores: {
        live_duplicate: { totalVol: 0, count: 0 },
        top_clone: { totalVol: 0, count: 0 },
        agent_meta: { totalVol: 0, count: 0 },
        trending: { totalVol: 0, count: 0 },
      },
      topicScores: {},
      adaptiveMix: { ...DEFAULT_STRATEGY_MIX },
      volumeChecks: [],
      lastAdaptation: null,
      insights: [],
      // NEW: Cache of fresh tokens with volume discovered in real-time
      freshVolumeTokens: [],
      lastFreshScan: null,
    };
  }

  _saveTokenData() {
    try { fs.writeFileSync(TOKENS_FILE, JSON.stringify(this.tokenData, null, 2)); }
    catch (e) { this.log.error(`Token data save failed: ${e.message}`); }
  }

  _saveResearchData() {
    try { fs.writeFileSync(RESEARCH_FILE, JSON.stringify(this.researchData, null, 2)); }
    catch (e) { this.log.error(`Research data save failed: ${e.message}`); }
  }

  _savePerformanceData() {
    try { fs.writeFileSync(PERFORMANCE_FILE, JSON.stringify(this.perfData, null, 2)); }
    catch (e) { this.log.error(`Performance data save failed: ${e.message}`); }
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

  // Direct CLI launch using flags — avoids interactive wizard entirely
  // Uses spawnSync to capture both stdout and stderr properly
  _runBankrLaunch(name, symbol, imageUrl, timeout = 180000) {
    const walletAddr = process.env.BANKR_FEE_WALLET || "0x162ee01a2eab184f6698ec8663ad84c4ee506733";
    const safeName = name.replace(/"/g, '\\"');
    const safeSymbol = symbol.replace(/"/g, '\\"');

    // Strategy A: Use bankr agent (worked for LLAMA — handles deploy asynchronously)
    const imageInstruction = imageUrl
      ? `use this image for the token: ${imageUrl}`
      : "generate an image for the token.";
    const agentPrompt = `launch a token with name "${safeName}" and symbol "${safeSymbol}". set fee recipient to wallet address ${walletAddr}. ${imageInstruction}`;
    this.log.info(`Agent prompt: ${agentPrompt}`);
    try {
      const result = spawnSync("bankr", ["agent", agentPrompt], {
        encoding: "utf8",
        timeout,
        stdio: ["pipe", "pipe", "pipe"],
        input: "\n\n\n\n\n\n\n\n\n\n",
        shell: true,
      });
      const allOutput = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
      this.log.info(`Agent output (exit ${result.status}): ${allOutput.substring(0, 500)}`);

      // Check if output contains contract address (success)
      if (/0x[a-fA-F0-9]{40}/.test(allOutput)) {
        return allOutput;
      }

      // If agent worked but no address, try direct launch as fallback
      this.log.info("Agent returned no contract address. Trying direct launch...");
    } catch (e) {
      this.log.warn(`Agent launch failed: ${e.message}. Trying direct launch...`);
    }

    // Strategy B: Direct bankr launch with flags
    const cmd = `bankr launch --name "${safeName}" --symbol "${safeSymbol}" --fee ${walletAddr} --fee-type wallet --yes`;
    this.log.info(`Direct CLI: ${cmd}`);
    const result = spawnSync(cmd, {
      encoding: "utf8",
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
      input: "\n\n\n\n\n\n\n\n\n\n",
      shell: true,
    });
    const allOutput = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
    this.log.info(`Direct output (exit ${result.status}): ${allOutput.substring(0, 500)}`);

    if (/0x[a-fA-F0-9]{40}/.test(allOutput)) {
      return allOutput;
    }
    if (result.status !== 0 || !allOutput) {
      throw new Error(`bankr launch failed (exit ${result.status}): ${allOutput.substring(0, 300)}`);
    }
    return allOutput;
  }

  // ── DAILY LIMIT & TIMING ──

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

  _isInLaunchWindow() {
    const utcHour = new Date().getUTCHours();
    return utcHour >= this.config.launchWindowStart && utcHour < this.config.launchWindowEnd;
  }

  _getDayOfWeek() {
    return new Date().getUTCDay();
  }

  // ═══════════════════════════════════════════════════
  // ADAPTIVE STRATEGY SELECTION (self-learning)
  // ═══════════════════════════════════════════════════

  _getAdaptiveMix() {
    return this.perfData.adaptiveMix || { ...DEFAULT_STRATEGY_MIX };
  }

  _selectStrategy() {
    const mix = this._getAdaptiveMix();
    const today = this.tokenData.launchesToday;

    // Build thresholds from adaptive mix
    const liveDupEnd = mix.live_duplicate || 4;
    const topCloneEnd = liveDupEnd + (mix.top_clone || 3);
    const agentEnd = topCloneEnd + (mix.agent_meta || 2);

    if (today < liveDupEnd) return "live_duplicate";
    if (today < topCloneEnd) return "top_clone";
    if (today < agentEnd) return "agent_meta";
    return "trending";
  }

  // Rebalance strategy weights based on volume performance data
  _adaptStrategies() {
    const scores = this.perfData.strategyScores;
    const strategies = ["live_duplicate", "top_clone", "agent_meta", "trending"];
    const avgVols = {};
    let hasData = false;

    for (const s of strategies) {
      if (scores[s] && scores[s].count >= 3) {
        avgVols[s] = scores[s].totalVol / scores[s].count;
        hasData = true;
      }
    }

    if (!hasData) {
      this.log.info("Not enough volume data yet for adaptation (need ≥3 tokens per strategy). Using defaults.");
      return;
    }

    const ranked = Object.entries(avgVols).sort((a, b) => b[1] - a[1]);
    const oldMix = { ...this.perfData.adaptiveMix };
    const slotAlloc = [5, 3, 1, 1];
    const newMix = {};
    for (let i = 0; i < ranked.length; i++) {
      newMix[ranked[i][0]] = slotAlloc[i];
    }
    for (const s of strategies) {
      if (!(s in newMix)) newMix[s] = 1;
    }
    const total = Object.values(newMix).reduce((a, b) => a + b, 0);
    if (total !== 10) newMix[ranked[0][0]] += 10 - total;

    this.perfData.adaptiveMix = newMix;
    this.perfData.insights.push({ date: new Date().toISOString(), avgVols, oldMix, newMix, topStrategy: ranked[0][0] });
    if (this.perfData.insights.length > 30) this.perfData.insights.shift();
    this.perfData.lastAdaptation = new Date().toISOString();
    this._savePerformanceData();

    this.log.info(`🧠 STRATEGY ADAPTATION:`);
    this.log.info(`  Avg volumes: ${JSON.stringify(avgVols)}`);
    this.log.info(`  Old mix: ${JSON.stringify(oldMix)}`);
    this.log.info(`  New mix: ${JSON.stringify(newMix)}`);
    this.log.info(`  Top strategy: ${ranked[0][0]} (avg vol: $${Math.round(ranked[0][1])})`);
  }

  // ── STRATEGY PICKERS ──

  // LIVE DUPLICATE: Pick from freshly discovered tokens that have volume
  _pickLiveDuplicateToken() {
    const fresh = this.perfData.freshVolumeTokens || [];
    if (fresh.length > 0) {
      // Sort by volume descending, pick from top weighted
      const sorted = [...fresh].sort((a, b) => (b.vol24 || 0) - (a.vol24 || 0));
      const pick = sorted[0]; // Best one
      this.log.info(`Live duplicate pick: ${pick.symbol} (vol24=$${pick.vol24}, source: ${pick.source})`);
      // Remove from list so we don't duplicate the same one twice
      this.perfData.freshVolumeTokens = fresh.filter(t => t.symbol !== pick.symbol);
      this._savePerformanceData();
      return { name: pick.name, symbol: pick.symbol };
    }
    // Fallback to top bankr clones if no fresh data yet
    this.log.info("No fresh volume tokens cached. Falling back to top_clone.");
    return this._pickTopCloneToken();
  }

  // TOP CLONE: Duplicate exact names of top bankr tokens
  _pickTopCloneToken() {
    const usedSymbols = new Set(this.tokenData.tokens.map(t => t.symbol));
    const available = TOP_BANKR_CLONES.filter(t => !usedSymbols.has(t.symbol));
    if (available.length === 0) {
      // Cycle through — add version suffix
      const base = TOP_BANKR_CLONES[Math.floor(Math.random() * TOP_BANKR_CLONES.length)];
      const v = Math.floor(Math.random() * 99) + 2;
      return { name: base.name, symbol: base.symbol + v };
    }
    // Pick from top earners first (higher weight to higher volume tokens)
    const pick = available[0]; // Already sorted by volume in the constant
    return { name: pick.name, symbol: pick.symbol };
  }

  // AGENT META: Agent-themed tokens (99% of top bankr tokens)
  _pickAgentMetaToken() {
    const usedSymbols = new Set(this.tokenData.tokens.map(t => t.symbol));
    const available = AGENT_META_TOKENS.filter(t => !usedSymbols.has(t.symbol));
    if (available.length === 0) {
      const prefixes = ["Agent", "Neural", "Autonomous", "Sentient", "AI", "Based"];
      const nouns = ["Protocol", "Bot", "Agent", "Network", "Coin", "Money"];
      const p = prefixes[Math.floor(Math.random() * prefixes.length)];
      const n = nouns[Math.floor(Math.random() * nouns.length)];
      return { name: `${p} ${n}`, symbol: (p.slice(0, 4) + n.slice(0, 4)).toUpperCase() };
    }
    return available[Math.floor(Math.random() * available.length)];
  }

  // TRENDING: Current event/keyword tokens
  _pickTrendingToken() {
    const usedSymbols = new Set(this.tokenData.tokens.map(t => t.symbol));
    const available = TRENDING_KEYWORD_TOKENS.filter(t => !usedSymbols.has(t.symbol));
    if (available.length > 0) {
      return available[Math.floor(Math.random() * available.length)];
    }
    // Fallback: use trending repos
    if (this.researchData.trendingRepos && this.researchData.trendingRepos.length > 0) {
      const repo = this.researchData.trendingRepos.shift();
      this._saveResearchData();
      return { name: repo.name, symbol: (repo.name || "TOKEN").replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 8) };
    }
    return this._pickAgentMetaToken();
  }

  // ═══════════════════════════════════════════════════
  // VOLUME TRACKING (self-learning engine)
  // ═══════════════════════════════════════════════════

  _httpGet(url) {
    return new Promise((resolve) => {
      const req = https.get(url, { headers: { "User-Agent": "BankrAgent/3.0" } }, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
      });
      req.on("error", () => resolve(null));
      req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    });
  }

  // Schedule a volume check for a newly launched token
  _scheduleVolumeCheck(tokenRecord) {
    if (!tokenRecord.contractAddress) return;
    const now = Date.now();
    this.perfData.volumeChecks.push(
      { addr: tokenRecord.contractAddress, strategy: tokenRecord.strategy, topic: tokenRecord.topic || null, checkAt: now + 3600000, type: "1h" },
      { addr: tokenRecord.contractAddress, strategy: tokenRecord.strategy, topic: tokenRecord.topic || null, checkAt: now + 21600000, type: "6h" },
      { addr: tokenRecord.contractAddress, strategy: tokenRecord.strategy, topic: tokenRecord.topic || null, checkAt: now + 86400000, type: "24h" },
    );
    this._savePerformanceData();
  }

  // Check volume for all tokens that are due
  async runVolumeChecks() {
    const now = Date.now();
    const due = this.perfData.volumeChecks.filter(c => c.checkAt <= now);
    if (due.length === 0) return;

    this.log.info(`Running ${due.length} volume checks...`);
    const remaining = this.perfData.volumeChecks.filter(c => c.checkAt > now);

    for (const check of due) {
      try {
        const data = await this._httpGet(`https://api.dexscreener.com/latest/dex/tokens/${check.addr}`);
        const pair = (data?.pairs || []).find(p => p.chainId === "base");
        const vol24 = pair?.volume?.h24 || 0;
        const vol1h = pair?.volume?.h1 || 0;

        this.log.info(`  ${check.type} check: ${check.addr.slice(0, 10)}... vol24=$${Math.round(vol24)} vol1h=$${Math.round(vol1h)} [${check.strategy}]`);

        // Record volume for strategy scoring (use 24h vol at 24h mark, otherwise h1)
        const vol = check.type === "24h" ? vol24 : vol1h;

        // Update strategy score
        if (!this.perfData.strategyScores[check.strategy]) {
          this.perfData.strategyScores[check.strategy] = { totalVol: 0, count: 0 };
        }
        // Only count the 24h check for strategy scoring (most reliable)
        if (check.type === "24h") {
          this.perfData.strategyScores[check.strategy].totalVol += vol24;
          this.perfData.strategyScores[check.strategy].count++;
        }

        // Update topic score if applicable
        if (check.topic && check.type === "24h") {
          if (!this.perfData.topicScores[check.topic]) {
            this.perfData.topicScores[check.topic] = { totalVol: 0, count: 0 };
          }
          this.perfData.topicScores[check.topic].totalVol += vol24;
          this.perfData.topicScores[check.topic].count++;
        }

        // Update the token record with volume data
        const token = this.tokenData.tokens.find(t => t.contractAddress === check.addr);
        if (token) {
          if (!token.volumeData) token.volumeData = {};
          token.volumeData[check.type] = { vol24, vol1h, checkedAt: new Date().toISOString() };
          this._saveTokenData();
        }

        // Brief pause between API calls to be respectful
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        this.log.warn(`Volume check failed for ${check.addr.slice(0, 10)}...: ${e.message}`);
      }
    }

    this.perfData.volumeChecks = remaining;
    this._savePerformanceData();

    // After 24h checks, trigger adaptation
    const had24h = due.some(c => c.type === "24h");
    if (had24h) this._adaptStrategies();
  }

  // ═══════════════════════════════════════════════════
  // LIVE RESEARCH
  // ═══════════════════════════════════════════════════

  async fetchTrendingGitHubRepos() {
    const data = await this._httpGet("https://api.github.com/search/repositories?q=stars:>5000+pushed:>2026-03-01&sort=stars&order=desc&per_page=30");
    if (!data || !data.items) { this.log.warn("GitHub trending fetch failed"); return []; }

    const repos = data.items
      .filter(repo => repo.name.length <= 30 && repo.name.length >= 3)
      .map(repo => ({
        repo: repo.full_name,
        name: repo.name.toUpperCase(),
        topic: (repo.topics || []).some(t => ["ai", "machine-learning", "deep-learning", "llm", "gpt", "neural"].includes(t)) ? "ai" : "trending",
      }));

    const usedNames = new Set(this.tokenData.tokens.map(t => t.symbol));
    const fresh = repos.filter(r => !usedNames.has(r.name));
    this.researchData.trendingRepos = fresh.slice(0, 20);
    this.researchData.lastFetch = new Date().toISOString();
    this._saveResearchData();
    this.log.info(`Fetched ${fresh.length} trending GitHub repos.`);
    return fresh;
  }

  // ═══════════════════════════════════════════════════
  // REAL-TIME FRESH TOKEN SCANNER
  // Monitors clanker.world + DexScreener for FRESH launches with volume
  // This is the key differentiator — duplicate what's working RIGHT NOW
  // ═══════════════════════════════════════════════════

  async scanFreshLaunches() {
    this.log.info("🔍 Scanning for fresh launches with volume...");
    const found = [];

    // 1. Scan clanker.world for newest tokens, check their volume
    try {
      const clankerData = await this._httpGet("https://www.clanker.world/api/tokens?sort=desc&limit=20");
      if (clankerData?.data && Array.isArray(clankerData.data)) {
        for (const t of clankerData.data.slice(0, 15)) {
          const addr = t.contract_address || t.address;
          if (!addr) continue;
          try {
            const dx = await this._httpGet(`https://api.dexscreener.com/latest/dex/tokens/${addr}`);
            const vol = dx?.pairs?.[0]?.volume?.h24 || 0;
            if (vol > 50) {
              found.push({
                name: t.name,
                symbol: t.symbol,
                vol24: Math.round(vol),
                source: "clanker",
                addr,
                discoveredAt: new Date().toISOString(),
              });
              this.log.info(`  🎯 Fresh clanker: ${t.symbol} vol24=$${Math.round(vol)}`);
            }
            await new Promise(r => setTimeout(r, 300));
          } catch (e) {}
        }
      }
    } catch (e) { this.log.warn(`Clanker scan failed: ${e.message}`); }

    // 2. Search DexScreener for fresh Base tokens with volume
    // KEY INSIGHT: Use MANY specific searches. Each query only returns ~30 results,
    // so breadth of search terms is critical to find fresh winners.
    const searches = [
      // Proven winners to duplicate
      "gork", "BaseDOG", "BasePEPE", "defense agents", "DOTA base",
      // Top bankr token names (cross-platform duplicates)
      "CLAWD", "GITLAWB", "FELIX", "AGNT", "JUNO agent", "LITCOIN",
      "BOTCOIN", "cyb3r", "KellyClaude", "robot money",
      // Base + meme animal combos (BaseDOG got $47k)
      "dog base", "cat base", "frog base", "pepe base", "shiba base",
      // AI/Agent narrative (99% of top bankr tokens)
      "agent base", "AI base token", "neural base", "GPT base",
      "autonomous base", "sentient base", "bot base",
      // Trending keywords that trigger sniper bots
      "Grok base", "ChatGPT base", "Claude base", "Gemini base",
      "trump base", "tariff base", "Elon base",
      // Base culture tokens
      "degen base", "higher base", "farcaster token", "based token",
      // Fresh meme patterns
      "meme base new", "fartcoin", "bonk base", "wojak base",
      "moon base token", "pump base", "send base",
      // Clanker ecosystem
      "clanker", "bankr token",
    ];

    for (const q of searches) {
      try {
        const d = await this._httpGet(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`);
        if (d?.pairs) {
          d.pairs
            .filter(p => {
              if (p.chainId !== "base") return false;
              const ageH = (Date.now() - (p.pairCreatedAt || 0)) / 3600000;
              // Lower thresholds: any volume at all on a fresh token is signal
              return ageH < 168 && (p.volume?.h24 || 0) > 100;
            })
            .slice(0, 5)
            .forEach(p => {
              if (!found.find(f => f.symbol === p.baseToken.symbol)) {
                found.push({
                  name: p.baseToken.name,
                  symbol: p.baseToken.symbol,
                  vol24: Math.round(p.volume?.h24 || 0),
                  source: "dexscreener",
                  addr: p.baseToken.address,
                  discoveredAt: new Date().toISOString(),
                });
              }
            });
        }
      } catch (e) {}
    }

    // 3. Deep search for ALL Base tokens with volume using broad queries
    const broadSearches = ["base token new launch", "base meme coin", "base chain token"];
    for (const q of broadSearches) {
      try {
        const d = await this._httpGet(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`);
        if (d?.pairs) {
          d.pairs
            .filter(p => {
              if (p.chainId !== "base") return false;
              const ageH = (Date.now() - (p.pairCreatedAt || 0)) / 3600000;
              return ageH < 168 && (p.volume?.h24 || 0) > 500;
            })
            .sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))
            .slice(0, 5)
            .forEach(p => {
              if (!found.find(f => f.symbol === p.baseToken.symbol)) {
                found.push({
                  name: p.baseToken.name,
                  symbol: p.baseToken.symbol,
                  vol24: Math.round(p.volume?.h24 || 0),
                  source: "broad-search",
                  addr: p.baseToken.address,
                  discoveredAt: new Date().toISOString(),
                });
              }
            });
        }
      } catch (e) {}
    }

    // 4. Search for the exact top bankr/clanker token names to cross-platform duplicate
    const topTokenNames = ["CLAWD", "GITLAWB", "FELIX", "AGNT SOCIAL", "Juno Agent", "LITCOIN", "Defense of the Agents"];
    for (const name of topTokenNames) {
      try {
        const d = await this._httpGet(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(name)}`);
        if (d?.pairs) {
          const best = d.pairs.filter(p => p.chainId === "base" && (p.volume?.h24 || 0) > 1000)
            .sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))[0];
          if (best && !found.find(f => f.symbol === best.baseToken.symbol)) {
            found.push({
              name: best.baseToken.name,
              symbol: best.baseToken.symbol,
              vol24: Math.round(best.volume?.h24 || 0),
              source: "top-bankr-clone",
              addr: best.baseToken.address,
              discoveredAt: new Date().toISOString(),
            });
          }
        }
      } catch (e) {}
    }

    // Sort by volume and cache
    found.sort((a, b) => b.vol24 - a.vol24);
    this.perfData.freshVolumeTokens = found.slice(0, 20);
    this.perfData.lastFreshScan = new Date().toISOString();
    this._savePerformanceData();

    this.log.info(`Fresh scan complete: found ${found.length} tokens with volume. Top: ${found[0]?.symbol || "none"} ($${found[0]?.vol24 || 0})`);
    if (found.length > 0) {
      found.slice(0, 5).forEach(t => {
        this.log.info(`  ${t.symbol.padEnd(14)} vol24=$${t.vol24} | ${t.name} | src=${t.source}`);
      });
    }
    return found;
  }

  async fetchHotBankrTokens() {
    // Search for high-volume tokens on Base that match bankr-style patterns
    const searches = ["bankr", "agent base", "AI base token"];
    const hot = [];

    for (const q of searches) {
      const data = await this._httpGet(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`);
      if (!data?.pairs) continue;
      data.pairs
        .filter(p => p.chainId === "base" && (p.volume?.h24 || 0) > 10000)
        .forEach(p => {
          if (!hot.find(h => h.symbol === p.baseToken.symbol)) {
            hot.push({
              name: p.baseToken.name,
              symbol: p.baseToken.symbol,
              vol24: Math.round(p.volume?.h24 || 0),
              mc: Math.round(p.marketCap || 0),
            });
          }
        });
    }

    hot.sort((a, b) => b.vol24 - a.vol24);
    this.researchData.hotTokens = hot.slice(0, 15);
    this._saveResearchData();
    this.log.info(`Found ${hot.length} hot base tokens. Top: ${hot[0]?.symbol} ($${hot[0]?.vol24} vol)`);
    return hot;
  }

  // ═══════════════════════════════════════════════════
  // BANKR CLUB GOAL TRACKING
  // ═══════════════════════════════════════════════════

  async checkClubGoal() {
    if (this.tokenData.clubGoal?.subscribed) return;

    const earned = this.tokenData.stats.totalFeesClaimed;
    const target = CLUB_COST_WETH;
    const pct = ((earned / target) * 100).toFixed(1);

    this.log.info(`💎 Club goal: ${earned.toFixed(6)}/${target} WETH (${pct}%)`);

    if (earned >= target) {
      this.log.info("🎉 BANKR CLUB GOAL REACHED! Attempting subscription...");
      try {
        const output = this._runBankr('agent "subscribe to bankr club monthly plan"', 120000);
        this.log.info(`Club subscription result: ${output.substring(0, 300)}`);
        this.tokenData.clubGoal.subscribed = true;
        this.tokenData.clubGoal.subscribedAt = new Date().toISOString();
        this._saveTokenData();
        await this.notify(
          `🎉 *BANKR CLUB SUBSCRIBED!*\n` +
          `Fee share: 57% → 95%\nSwap fees: 0.65% → 0.15%\n10 launches/day confirmed\n` +
          `Total earned to reach here: ${earned.toFixed(6)} WETH`
        );
      } catch (e) {
        this.log.error(`Club subscription failed: ${e.message}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════
  // CORE LAUNCH LOGIC
  // ═══════════════════════════════════════════════════

  async launchToken(overrideName, overrideSymbol) {
    if (!this._checkDailyLimit()) {
      this.log.info(`Daily launch limit reached (${this.config.maxLaunchesPerDay}/day). Skipping.`);
      return null;
    }

    let tokenInfo;
    if (overrideName) {
      tokenInfo = { name: overrideName, symbol: overrideSymbol || overrideName.substring(0, 10).toUpperCase(), strategy: "manual" };
    } else {
      const strategy = this._selectStrategy();
      this.log.info(`Strategy: ${strategy} (launch ${this.tokenData.launchesToday + 1}/${this.config.maxLaunchesPerDay}) | Mix: ${JSON.stringify(this._getAdaptiveMix())}`);

      switch (strategy) {
        case "live_duplicate": {
          const dup = this._pickLiveDuplicateToken();
          tokenInfo = { ...dup, strategy: "live_duplicate" };
          break;
        }
        case "top_clone": {
          const clone = this._pickTopCloneToken();
          tokenInfo = { ...clone, strategy: "top_clone" };
          break;
        }
        case "agent_meta": {
          const agent = this._pickAgentMetaToken();
          tokenInfo = { ...agent, strategy: "agent_meta" };
          break;
        }
        case "trending": {
          const trend = this._pickTrendingToken();
          tokenInfo = { ...trend, strategy: "trending" };
          break;
        }
      }
    }

    this.log.info(`Launching [${tokenInfo.strategy}]: ${tokenInfo.name} ($${tokenInfo.symbol})`);

    // Generate and upload token image to IPFS
    let imageUrl = null;
    const imageCat = tokenInfo.strategy === "agent_meta" ? "ai" : tokenInfo.strategy === "top_clone" ? "crypto" : "meme";
    try {
      imageUrl = await getTokenImageUrl(tokenInfo.name, tokenInfo.symbol, imageCat);
      this.log.info(`Image: ${imageUrl}`);
    } catch (e) {
      this.log.warn(`Image generation failed: ${e.message}. Launching without image.`);
    }

    const MAX_RETRIES = 2;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Use direct CLI flags to avoid interactive wizard hanging
      const output = this._runBankrLaunch(tokenInfo.name, tokenInfo.symbol, imageUrl, 180000);

      this.log.info(`Launch output (attempt ${attempt}): ${output.substring(0, 500)}`);

      const addressMatch = output.match(/0x[a-fA-F0-9]{40}/);
      const contractAddress = addressMatch ? addressMatch[0] : null;

      const urlMatch = output.match(/https:\/\/www\.bankr\.bot\/launches\/0x[a-fA-F0-9]{40}/);
      const bankrUrl = urlMatch ? urlMatch[0] : null;

      // Validate: only count as success if we got a contract address
      if (!contractAddress) {
        this.log.warn(`Launch produced no contract address (attempt ${attempt}/${MAX_RETRIES}). Output: ${output.substring(0, 300)}`);
        if (attempt < MAX_RETRIES) {
          this.log.info(`Retrying in 15s...`);
          await new Promise(r => setTimeout(r, 15000));
          continue;
        }
        // Final attempt still no address — record but don't count toward daily limit
        this.log.warn(`All ${MAX_RETRIES} attempts failed to get contract address. Not counting toward daily limit.`);
        this.tokenData.tokens.push({
          name: tokenInfo.name, symbol: tokenInfo.symbol, strategy: tokenInfo.strategy,
          contractAddress: null, launchedAt: new Date().toISOString(),
          launchOutput: output.substring(0, 500), feesEarned: 0, feesClaimed: 0, failed: true,
        });
        this._saveTokenData();
        return null;
      }

      const tokenRecord = {
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        strategy: tokenInfo.strategy,
        topic: tokenInfo.topic || null,
        contractAddress,
        bankrUrl,
        launchedAt: new Date().toISOString(),
        launchOutput: output.substring(0, 500),
        feesEarned: 0,
        feesClaimed: 0,
        volumeData: {},
      };

      this.tokenData.tokens.push(tokenRecord);
      this.tokenData.stats.totalLaunched++;
      this.tokenData.launchesToday++;
      this._saveTokenData();

      // Schedule volume checks for self-learning
      this._scheduleVolumeCheck(tokenRecord);

      await this.notify(
        `🚀 *Token Launched!* [${tokenInfo.strategy}]\n` +
        `Name: ${tokenInfo.name} ($${tokenInfo.symbol})\n` +
        `${contractAddress ? `Contract: \`${contractAddress}\`` : "Check bankr fees for details"}\n` +
        `${bankrUrl ? bankrUrl + "\n" : ""}` +
        `Today: ${this.tokenData.launchesToday}/${this.config.maxLaunchesPerDay} | Total: ${this.tokenData.stats.totalLaunched}`
      );

      return tokenRecord;
    } catch (e) {
      this.log.error(`Token launch failed (attempt ${attempt}/${MAX_RETRIES}): ${e.message}`);
      if (attempt < MAX_RETRIES) {
        this.log.info(`Retrying in 15s...`);
        await new Promise(r => setTimeout(r, 15000));
        continue;
      }
      await this.notify(`❌ Launch failed [${tokenInfo.strategy}]: ${tokenInfo.name} — ${e.message.substring(0, 200)}`);
      return null;
    }
    } // end retry loop
  }

  // ═══════════════════════════════════════════════════
  // FEE MANAGEMENT
  // ═══════════════════════════════════════════════════

  async checkFees() {
    this.log.info("Checking fee earnings...");
    try {
      const output = this._runBankr("fees", 60000);

      const claimableMatch = output.match(/CLAIMABLE WETH[^│]*│[^│]*│\s*([\d.]+)/i) ||
                             output.match(/Claimable:\s*([\d.]+)\s*WETH/i) ||
                             output.match(/(\d+\.\d{4,})\s*│\s*pending/i);
      const claimable = claimableMatch ? parseFloat(claimableMatch[1]) : 0;

      const earnedMatch = output.match(/TOTAL EARNED[^│]*│[^│]*│\s*([\d.]+)/i) ||
                          output.match(/(\d+\.\d+)\s*\n\s*30 days/);
      const totalEarned = earnedMatch ? parseFloat(earnedMatch[1]) : 0;

      if (totalEarned > 0) this.tokenData.stats.totalFeesEarned = totalEarned;
      this._saveTokenData();

      this.log.info(`Fees — Claimable: ${claimable} WETH | Total earned: ${totalEarned} WETH`);

      if (claimable >= this.config.feeClaimThreshold) {
        this.log.info(`Claimable ${claimable} above threshold, claiming...`);
        await this.claimAllFees();
      }

      return { claimable, totalEarned };
    } catch (e) {
      this.log.warn(`Fee check failed: ${e.message}`);
      return null;
    }
  }

  async claimAllFees() {
    this.log.info("Claiming all fees...");
    try {
      const output = this._runBankr("fees claim --yes", 120000);
      this.log.info(`Claim output: ${output.substring(0, 300)}`);

      const amountMatch = output.match(/([\d.]+)\s*WETH/i);
      if (amountMatch) {
        const claimed = parseFloat(amountMatch[1]);
        this.tokenData.stats.totalFeesClaimed += claimed;
        this._saveTokenData();
        await this.notify(`💰 Fees claimed: ${claimed} WETH | Total: ${this.tokenData.stats.totalFeesClaimed.toFixed(6)} WETH`);
      }
      return output;
    } catch (e) {
      this.log.error(`Fee claim failed: ${e.message}`);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════
  // MAIN CYCLES
  // ═══════════════════════════════════════════════════

  async runLaunchCycle() {
    this.log.info("─── Launch cycle ───");

    if (!this._isInLaunchWindow()) {
      const utcHour = new Date().getUTCHours();
      this.log.info(`Outside window (${utcHour} UTC, need ${this.config.launchWindowStart}-${this.config.launchWindowEnd}). Skipping.`);
      return;
    }

    if (!this._checkDailyLimit()) {
      this.log.info(`Daily limit hit (${this.tokenData.launchesToday}/${this.config.maxLaunchesPerDay}).`);
      return;
    }

    // If we're behind schedule, try to catch up with burst launches
    const utcHour = new Date().getUTCHours();
    const windowRemaining = this.config.launchWindowEnd - utcHour;
    const launchesRemaining = this.config.maxLaunchesPerDay - this.tokenData.launchesToday;
    const isBehind = launchesRemaining > windowRemaining; // more launches needed than hours left

    if (isBehind && launchesRemaining > 1) {
      this.log.info(`⚡ Behind schedule: ${launchesRemaining} launches in ${windowRemaining}h. Doing burst (2 launches).`);
      await this.launchToken();
      // Brief pause between burst launches
      await new Promise(r => setTimeout(r, 30000));
      if (this._checkDailyLimit()) await this.launchToken();
    } else {
      await this.launchToken();
    }
  }

  async runResearchCycle() {
    this.log.info("─── Research cycle ───");
    const lastFetch = this.researchData.lastFetch ? new Date(this.researchData.lastFetch) : new Date(0);
    const hoursSinceFetch = (Date.now() - lastFetch.getTime()) / 3600000;

    if (hoursSinceFetch >= 4) {
      this.log.info("Refreshing trending data (>4h since last fetch)...");
      await Promise.all([
        this.fetchTrendingGitHubRepos(),
        this.fetchHotBankrTokens(),
      ]);
    } else {
      this.log.info(`Research data fresh (${hoursSinceFetch.toFixed(1)}h old). Skipping full refresh.`);
    }

    // ALWAYS scan for fresh launches (this is the key real-time feature)
    await this.scanFreshLaunches();
  }

  async runVolumeAndPerformanceCycle() {
    this.log.info("─── Volume & performance cycle ───");
    await this.runVolumeChecks();

    // Log performance summary
    const scores = this.perfData.strategyScores;
    for (const [strat, data] of Object.entries(scores)) {
      if (data.count > 0) {
        this.log.info(`  ${strat}: avg vol $${Math.round(data.totalVol / data.count)} (${data.count} tokens)`);
      }
    }
  }

  async runFeeCycle() {
    this.log.info("─── Fee check cycle ───");
    await this.checkFees();
    await this.checkClubGoal();

    const stats = this.tokenData.stats;
    const clubPct = ((stats.totalFeesClaimed / CLUB_COST_WETH) * 100).toFixed(1);
    this.log.info(
      `Stats: ${stats.totalLaunched} launched | Earned: ${stats.totalFeesEarned.toFixed(6)} WETH | ` +
      `Claimed: ${stats.totalFeesClaimed.toFixed(6)} WETH | Today: ${this.tokenData.launchesToday}/10 | Club: ${clubPct}%`
    );
  }

  async notify(message) {
    for (const n of this.notifiers) {
      try { await n.broadcast(message); } catch (e) { this.log.error(`Notify error: ${e.message}`); }
    }
  }

  getStats() {
    return {
      ...this.tokenData.stats,
      tokens: this.tokenData.tokens.slice(-20), // last 20
      launchesToday: this.tokenData.launchesToday,
      clubGoal: this.tokenData.clubGoal,
      adaptiveMix: this.perfData.adaptiveMix,
      strategyScores: this.perfData.strategyScores,
      pendingVolumeChecks: this.perfData.volumeChecks.length,
      lastAdaptation: this.perfData.lastAdaptation,
    };
  }
}

// ══════════════════════════════════════════════════════
// STANDALONE RUNNER — 10 LAUNCHES/DAY, EVERY DAY
// ══════════════════════════════════════════════════════
if (require.main === module) {
  const cron = require("node-cron");
  const log = new Logger("bankr-main");

  const launcher = new BankrLauncher({
    config: {
      maxLaunchesPerDay: parseInt(process.env.BANKR_MAX_LAUNCHES_PER_DAY || "10"),
    },
  });

  log.info("=== BANKR TOKEN LAUNCHER v3 (SELF-LEARNING) STARTING ===");
  log.info(`Adaptive mix: ${JSON.stringify(launcher.perfData.adaptiveMix)}`);
  log.info(`Launch window: ${launcher.config.launchWindowStart}:00-${launcher.config.launchWindowEnd}:00 UTC (15h)`);
  log.info(`Club goal: ${CLUB_COST_WETH} WETH | Current: ${launcher.tokenData.stats.totalFeesClaimed.toFixed(6)} WETH`);

  // Launch cycle: Every 80 min = ~11 slots in 15h window, guarantees 10 launches
  cron.schedule("*/80 * * * *", async () => {
    try { await launcher.runLaunchCycle(); }
    catch (e) { log.error("Launch cycle error:", e.message); }
  });

  // Fee check: Every 2 hours
  cron.schedule("15 */2 * * *", async () => {
    try { await launcher.runFeeCycle(); }
    catch (e) { log.error("Fee cycle error:", e.message); }
  });

  // Research refresh: Every 4 hours (GitHub repos, hot tokens)
  cron.schedule("0 */4 * * *", async () => {
    try { await launcher.runResearchCycle(); }
    catch (e) { log.error("Research cycle error:", e.message); }
  });

  // Fresh token scanner: Every 30 min (the KEY real-time feature)
  // This is what finds tokens with volume to duplicate RIGHT NOW
  cron.schedule("*/30 * * * *", async () => {
    try {
      log.info("─── Fresh token scan (30min) ───");
      await launcher.scanFreshLaunches();
    } catch (e) { log.error("Fresh scan error:", e.message); }
  });

  // Volume checks & performance: Every hour
  cron.schedule("30 * * * *", async () => {
    try { await launcher.runVolumeAndPerformanceCycle(); }
    catch (e) { log.error("Volume check error:", e.message); }
  });

  // Initial: Research → Launch → Fees (with forced research refresh on startup)
  (async () => {
    try {
      // Force-refresh research on startup to get latest hot tokens
      launcher.researchData.lastFetch = null;
      log.info("Forcing research refresh on startup...");
      await launcher.runResearchCycle();
      await launcher.runLaunchCycle();
      await launcher.runFeeCycle();
    } catch (e) {
      log.error("Initial run error:", e.message);
    }
  })();
}

module.exports = { BankrLauncher };
