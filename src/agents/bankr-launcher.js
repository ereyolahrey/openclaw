/**
 * Bankr Token Launcher Agent v3 — Self-Learning & Adaptive
 *
 * GOALS:
 *   1. Max out 10 token launches EVERY SINGLE DAY
 *   2. Track volume per token to learn what works
 *   3. Auto-rebalance strategy mix toward highest performers
 *   4. Save up fees to subscribe to Bankr Club ($20/mo → 95% fee share)
 *   5. Continuously research and adapt
 *
 * Three strategies with adaptive weighting:
 *   1. GitHub Repo Tokens — the #1 volume meta
 *   2. AI/Agent Sniper Keywords — triggers sniper bot buys
 *   3. Duplicate Hot Token Strategy — copies high-volume tokens
 *
 * Self-learning loop:
 *   - After launch, checks DexScreener volume at 1h, 6h, 24h intervals
 *   - Scores each strategy by avg volume generated
 *   - Shifts next day's strategy mix toward what's earning
 *   - Logs performance insights for continuous improvement
 */
require("dotenv").config();
const { execSync } = require("child_process");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { Logger } = require("../utils/logger");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const TOKENS_FILE = path.join(DATA_DIR, "bankr-tokens.json");
const RESEARCH_FILE = path.join(DATA_DIR, "bankr-research.json");
const PERFORMANCE_FILE = path.join(DATA_DIR, "bankr-performance.json");

// Bankr Club goal: ~0.01 WETH ≈ $20 at current ETH prices
const CLUB_COST_WETH = 0.01;

// ════════════════════════════════════════════════════
// STRATEGY 1: GitHub Repo Tokens (highest volume meta)
// ════════════════════════════════════════════════════
const GITHUB_REPO_POOL = [
  // AI/ML repos (top volume keywords that trigger sniper bots)
  { repo: "openai/whisper", name: "WHISPER", topic: "ai" },
  { repo: "langchain-ai/langchain", name: "LANGCHAIN", topic: "ai" },
  { repo: "ggerganov/llama.cpp", name: "LLAMA.CPP", topic: "ai" },
  { repo: "AUTOMATIC1111/stable-diffusion-webui", name: "STABLE-DIFFUSION-WEBUI", topic: "ai" },
  { repo: "comfyanonymous/ComfyUI", name: "COMFYUI", topic: "ai" },
  { repo: "lm-sys/FastChat", name: "FASTCHAT", topic: "ai" },
  { repo: "openai/openai-cookbook", name: "OPENAI-COOKBOOK", topic: "ai" },
  { repo: "deepseek-ai/DeepSeek-Coder", name: "DEEPSEEK-CODER", topic: "ai" },
  { repo: "meta-llama/llama", name: "LLAMA", topic: "ai" },
  { repo: "Stability-AI/generative-models", name: "GENERATIVE-MODELS", topic: "ai" },
  { repo: "mlc-ai/mlc-llm", name: "MLC-LLM", topic: "ai" },
  { repo: "OpenBMB/ChatDev", name: "CHATDEV", topic: "ai" },
  { repo: "smol-ai/developer", name: "SMOL-DEVELOPER", topic: "ai" },
  { repo: "princeton-nlp/SWE-agent", name: "SWE-AGENT", topic: "ai" },
  { repo: "anthropics/courses", name: "ANTHROPIC-COURSES", topic: "ai" },
  { repo: "open-webui/open-webui", name: "OPEN-WEBUI", topic: "ai" },
  { repo: "TabbyML/tabby", name: "TABBY", topic: "ai" },
  { repo: "run-llama/llama_index", name: "LLAMA-INDEX", topic: "ai" },
  // Developer tools repos (proven bankr volume generators)
  { repo: "docker/compose", name: "DOCKER-COMPOSE", topic: "devtools" },
  { repo: "grafana/grafana", name: "GRAFANA", topic: "devtools" },
  { repo: "prometheus/prometheus", name: "PROMETHEUS", topic: "devtools" },
  { repo: "hashicorp/terraform", name: "TERRAFORM", topic: "devtools" },
  { repo: "kubernetes/minikube", name: "MINIKUBE", topic: "devtools" },
  { repo: "vercel/next.js", name: "NEXT.JS", topic: "devtools" },
  { repo: "supabase/supabase", name: "SUPABASE", topic: "devtools" },
  { repo: "denoland/deno", name: "DENO", topic: "devtools" },
  { repo: "bun-sh/bun", name: "BUN", topic: "devtools" },
  { repo: "astral-sh/ruff", name: "RUFF", topic: "devtools" },
  { repo: "pnpm/pnpm", name: "PNPM", topic: "devtools" },
  { repo: "tauri-apps/tauri", name: "TAURI", topic: "devtools" },
  { repo: "vitejs/vite", name: "VITE", topic: "devtools" },
  { repo: "biomejs/biome", name: "BIOME", topic: "devtools" },
  { repo: "neovim/neovim", name: "NEOVIM", topic: "devtools" },
  { repo: "tmux/tmux", name: "TMUX", topic: "devtools" },
  // Crypto/Web3 repos
  { repo: "foundry-rs/foundry", name: "FOUNDRY", topic: "crypto" },
  { repo: "paradigmxyz/reth", name: "RETH", topic: "crypto" },
  { repo: "Uniswap/v4-core", name: "UNISWAP-V4", topic: "crypto" },
  { repo: "aave/aave-v3-core", name: "AAVE-V3", topic: "crypto" },
  { repo: "solana-labs/solana", name: "SOLANA-CORE", topic: "crypto" },
  // Viral/trending repos
  { repo: "yt-dlp/yt-dlp", name: "YT-DLP", topic: "viral" },
  { repo: "practical-tutorials/project-based-learning", name: "PROJECT-BASED-LEARNING", topic: "viral" },
  { repo: "codecrafters-io/build-your-own-x", name: "BUILD-YOUR-OWN-X", topic: "viral" },
  { repo: "krahets/hello-algo", name: "HELLO-ALGO", topic: "viral" },
  { repo: "rustdesk/rustdesk", name: "RUSTDESK", topic: "viral" },
  { repo: "excalidraw/excalidraw", name: "EXCALIDRAW", topic: "viral" },
];

// ════════════════════════════════════════════════════
// STRATEGY 2: AI/Agent Sniper Bot Keyword Tokens
// ════════════════════════════════════════════════════
const SNIPER_KEYWORD_TOKENS = [
  { name: "Autonomous Trading Agent", symbol: "AUTOTRADE" },
  { name: "Neural Protocol Agent", symbol: "NPROTOCOL" },
  { name: "GPT Trading Bot", symbol: "GPTBOT" },
  { name: "AI Hedge Fund Agent", symbol: "AIHEDGE" },
  { name: "Autonomous AI Robot", symbol: "AIROBOT" },
  { name: "GPT Agent Protocol", symbol: "GPTAGENT" },
  { name: "Neural Network Bot", symbol: "NEURALBOT" },
  { name: "Autonomous DeFi Agent", symbol: "DEFAGENT" },
  { name: "AI Protocol Agent", symbol: "AIPROTOCOL" },
  { name: "Robot Trading Agent", symbol: "ROBTRADE" },
  { name: "Autonomous Sniper Bot", symbol: "AUTOSNIPE" },
  { name: "GPT Neural Agent", symbol: "GPTNEURAL" },
  { name: "AI Agent Protocol", symbol: "AIAGENTP" },
  { name: "Autonomous Robot AI", symbol: "AUTOROBOT" },
  { name: "Neural AI Agent Bot", symbol: "NEURALAI" },
  { name: "Agent Protocol GPT", symbol: "AGENTGPT" },
  { name: "Autonomous Protocol Bot", symbol: "AUTOBOT" },
  { name: "GPT Autonomous Agent", symbol: "GPTAUTO" },
  { name: "AI Neural Protocol", symbol: "AINEURAL" },
  { name: "Robot Agent Protocol", symbol: "ROBOTAIP" },
  { name: "DeepSeek Autonomous Agent", symbol: "DEEPAGENT" },
  { name: "Claude Code Agent", symbol: "CLAUDEBOT" },
  { name: "AI Quant Protocol", symbol: "AIQUANT" },
  { name: "Neural DeFi Robot", symbol: "NEUDEFI" },
  { name: "GPT Market Agent", symbol: "GPTMKT" },
];

// ════════════════════════════════════════════════════
// STRATEGY 3: Duplicate Hot Token Names
// ════════════════════════════════════════════════════
const HOT_TOKEN_DUPLICATES = [
  { name: "Defense of the Agents", symbol: "DOTA" },
  { name: "Zen Browser", symbol: "ZEN" },
  { name: "Personal Computer", symbol: "PC" },
  { name: "Adaptive Computer", symbol: "AC" },
  { name: "Virtual Protocol", symbol: "VIRTUAL" },
  { name: "tokenbot", symbol: "CLANKER" },
  { name: "Robot Money", symbol: "ROBOTMONEY" },
];

// Default strategy weights (will be overridden by adaptive learning)
const DEFAULT_STRATEGY_MIX = { github: 5, sniper: 3, duplicate: 1, trending: 1 };

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
      if (fs.existsSync(PERFORMANCE_FILE)) return JSON.parse(fs.readFileSync(PERFORMANCE_FILE, "utf8"));
    } catch {}
    return {
      strategyScores: { github: { totalVol: 0, count: 0 }, sniper: { totalVol: 0, count: 0 }, duplicate: { totalVol: 0, count: 0 }, trending: { totalVol: 0, count: 0 } },
      topicScores: {},     // e.g. { ai: { totalVol, count }, devtools: {...} }
      adaptiveMix: { ...DEFAULT_STRATEGY_MIX },
      volumeChecks: [],    // tokens pending volume check
      lastAdaptation: null,
      insights: [],        // log of strategy changes
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
        input: "\n\n\n\n",
      });
      return result.trim();
    } catch (e) {
      const stderr = e.stderr ? e.stderr.toString() : "";
      const stdout = e.stdout ? e.stdout.toString() : "";
      throw new Error(`bankr ${args} failed: ${stderr || stdout || e.message}`);
    }
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
    const day = this._getDayOfWeek();
    const isHighVolDay = day === 1 || day === 2;

    // Build thresholds from adaptive mix
    const githubEnd = mix.github + (isHighVolDay ? 1 : 0);
    const sniperEnd = githubEnd + mix.sniper - (isHighVolDay ? 1 : 0);
    const dupEnd = sniperEnd + mix.duplicate;

    if (today < githubEnd) return "github";
    if (today < sniperEnd) return "sniper";
    if (today < dupEnd) return "duplicate";
    return "trending";
  }

  // Rebalance strategy weights based on volume performance data
  _adaptStrategies() {
    const scores = this.perfData.strategyScores;
    const strategies = ["github", "sniper", "duplicate", "trending"];
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

    // Rank strategies by avg volume
    const ranked = Object.entries(avgVols).sort((a, b) => b[1] - a[1]);
    const oldMix = { ...this.perfData.adaptiveMix };

    // Allocate 10 slots: top strategy gets 5, second gets 3, third gets 1, fourth gets 1
    // But ensure minimum 1 slot each for exploration
    const slotAlloc = [5, 3, 1, 1];
    const newMix = {};
    for (let i = 0; i < ranked.length; i++) {
      newMix[ranked[i][0]] = slotAlloc[i];
    }
    // Fill in strategies without data at minimum 1
    for (const s of strategies) {
      if (!(s in newMix)) newMix[s] = 1;
    }
    // Normalize to exactly 10
    const total = Object.values(newMix).reduce((a, b) => a + b, 0);
    if (total !== 10) {
      newMix[ranked[0][0]] += 10 - total;
    }

    this.perfData.adaptiveMix = newMix;

    // Log the adaptation
    const insight = {
      date: new Date().toISOString(),
      avgVols,
      oldMix,
      newMix,
      topStrategy: ranked[0][0],
    };
    this.perfData.insights.push(insight);
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

  _pickGitHubRepoToken() {
    const usedNames = new Set(this.tokenData.tokens.map(t => t.symbol));
    let available = GITHUB_REPO_POOL.filter(r => !usedNames.has(r.name));

    if (available.length === 0) {
      if (this.researchData.trendingRepos.length > 0) {
        const repo = this.researchData.trendingRepos.shift();
        this._saveResearchData();
        return repo;
      }
      const base = GITHUB_REPO_POOL[Math.floor(Math.random() * GITHUB_REPO_POOL.length)];
      const v = Math.floor(Math.random() * 9) + 2;
      return { ...base, name: `${base.name}-V${v}` };
    }

    // Use topic performance data to pick the best topic
    const topicScores = this.perfData.topicScores || {};
    const topicAvgs = {};
    for (const [topic, data] of Object.entries(topicScores)) {
      if (data.count >= 2) topicAvgs[topic] = data.totalVol / data.count;
    }

    if (Object.keys(topicAvgs).length > 0) {
      // Pick from the highest-performing topic 70% of the time
      const bestTopic = Object.entries(topicAvgs).sort((a, b) => b[1] - a[1])[0][0];
      const topicRepos = available.filter(r => r.topic === bestTopic);
      if (topicRepos.length > 0 && Math.random() < 0.7) {
        return topicRepos[Math.floor(Math.random() * topicRepos.length)];
      }
    }

    // Default: prioritize AI repos 60% of the time
    const aiRepos = available.filter(r => r.topic === "ai");
    if (aiRepos.length > 0 && Math.random() < 0.6) {
      return aiRepos[Math.floor(Math.random() * aiRepos.length)];
    }
    return available[Math.floor(Math.random() * available.length)];
  }

  _formatGitHubToken(repoInfo) {
    const fullName = `${repoInfo.name} github.com/${repoInfo.repo}`;
    return { name: fullName, symbol: repoInfo.name, strategy: "github", topic: repoInfo.topic };
  }

  _pickSniperToken() {
    const usedNames = new Set(this.tokenData.tokens.map(t => t.symbol));
    const available = SNIPER_KEYWORD_TOKENS.filter(t => !usedNames.has(t.symbol));

    if (available.length === 0) {
      const prefixes = ["Autonomous", "Neural", "GPT", "AI", "Robot", "DeepSeek", "Claude"];
      const middles = ["Trading", "Protocol", "DeFi", "Agent", "Network", "Quant", "Market"];
      const suffixes = ["Agent", "Bot", "Protocol", "AI", "Robot", "Engine", "System"];
      const p = prefixes[Math.floor(Math.random() * prefixes.length)];
      const m = middles[Math.floor(Math.random() * middles.length)];
      const s = suffixes[Math.floor(Math.random() * suffixes.length)];
      const name = `${p} ${m} ${s}`;
      const symbol = (p.slice(0, 3) + m[0] + s[0] + Math.floor(Math.random() * 100)).toUpperCase();
      return { name, symbol };
    }
    return available[Math.floor(Math.random() * available.length)];
  }

  _pickDuplicateToken() {
    if (this.researchData.hotTokens.length > 0) {
      const hot = this.researchData.hotTokens[Math.floor(Math.random() * this.researchData.hotTokens.length)];
      return { name: hot.name, symbol: hot.symbol };
    }
    return HOT_TOKEN_DUPLICATES[Math.floor(Math.random() * HOT_TOKEN_DUPLICATES.length)];
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

  async fetchHotBankrTokens() {
    const data = await this._httpGet("https://api.dexscreener.com/latest/dex/search?q=github.com");
    if (!data || !data.pairs) { this.log.warn("DexScreener fetch failed"); return []; }

    const hot = data.pairs
      .filter(p => p.chainId === "base" && p.volume?.h24 > 50000 && p.baseToken.address.toLowerCase().startsWith("0xadf"))
      .sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))
      .slice(0, 15)
      .map(p => ({
        name: p.baseToken.name,
        symbol: p.baseToken.symbol,
        vol24: Math.round(p.volume?.h24 || 0),
        mc: Math.round(p.marketCap || 0),
      }));

    this.researchData.hotTokens = hot;
    this._saveResearchData();
    this.log.info(`Found ${hot.length} hot bankr tokens. Top: ${hot[0]?.symbol} ($${hot[0]?.vol24} vol)`);
    return hot;
  }

  // Also fetch new trending search terms to expand keyword coverage
  async fetchTrendingKeywords() {
    // Ask bankr's own AI for current insights
    try {
      const output = this._runBankr('agent "what tokens are trending on bankr right now? what keywords are generating the most volume this week?"', 60000);
      this.researchData.latestBankrInsight = output.substring(0, 1000);
      this.researchData.lastInsightFetch = new Date().toISOString();
      this._saveResearchData();
      this.log.info(`Bankr AI insight: ${output.substring(0, 200)}`);
    } catch (e) {
      this.log.warn(`Bankr insight fetch failed: ${e.message}`);
    }
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
        case "github": {
          const repo = this._pickGitHubRepoToken();
          tokenInfo = this._formatGitHubToken(repo);
          break;
        }
        case "sniper": {
          const sniper = this._pickSniperToken();
          tokenInfo = { ...sniper, strategy: "sniper" };
          break;
        }
        case "duplicate": {
          const dup = this._pickDuplicateToken();
          tokenInfo = { ...dup, strategy: "duplicate" };
          break;
        }
        case "trending": {
          if (this.researchData.trendingRepos.length > 0) {
            const repo = this.researchData.trendingRepos.shift();
            this._saveResearchData();
            tokenInfo = this._formatGitHubToken(repo);
            tokenInfo.strategy = "trending";
          } else {
            const repo = this._pickGitHubRepoToken();
            tokenInfo = this._formatGitHubToken(repo);
            tokenInfo.strategy = "trending-fallback";
          }
          break;
        }
      }
    }

    this.log.info(`Launching [${tokenInfo.strategy}]: ${tokenInfo.name} ($${tokenInfo.symbol})`);

    try {
      const safeName = tokenInfo.name.replace(/"/g, '\\"');
      const safeSymbol = tokenInfo.symbol.replace(/"/g, '\\"');

      const prompt = `launch a token called "${safeName}" with ticker ${safeSymbol}. direct all fees to my wallet.`;
      const output = this._runBankr(`agent "${prompt}"`, 180000);

      this.log.info(`Launch output: ${output.substring(0, 500)}`);

      const addressMatch = output.match(/0x[a-fA-F0-9]{40}/);
      const contractAddress = addressMatch ? addressMatch[0] : null;

      const urlMatch = output.match(/https:\/\/www\.bankr\.bot\/launches\/0x[a-fA-F0-9]{40}/);
      const bankrUrl = urlMatch ? urlMatch[0] : null;

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
      this.log.error(`Token launch failed: ${e.message}`);
      await this.notify(`❌ Launch failed [${tokenInfo.strategy}]: ${tokenInfo.name} — ${e.message.substring(0, 200)}`);
      return null;
    }
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
      // Fetch bankr AI insights less frequently
      if (hoursSinceFetch >= 12) {
        await this.fetchTrendingKeywords();
      }
    } else {
      this.log.info(`Research data fresh (${hoursSinceFetch.toFixed(1)}h old). Skipping.`);
    }
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

  // Research refresh: Every 4 hours
  cron.schedule("0 */4 * * *", async () => {
    try { await launcher.runResearchCycle(); }
    catch (e) { log.error("Research cycle error:", e.message); }
  });

  // Volume checks & performance: Every hour
  cron.schedule("30 * * * *", async () => {
    try { await launcher.runVolumeAndPerformanceCycle(); }
    catch (e) { log.error("Volume check error:", e.message); }
  });

  // Initial: Research → Launch → Fees
  (async () => {
    try {
      await launcher.runResearchCycle();
      await launcher.runLaunchCycle();
      await launcher.runFeeCycle();
    } catch (e) {
      log.error("Initial run error:", e.message);
    }
  })();
}

module.exports = { BankrLauncher };
