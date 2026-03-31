/**
 * Bankr Token Launcher Agent v2 — Data-Driven Strategy
 *
 * Launches 10 tokens/day on Base via bankr CLI using three proven strategies:
 *   1. GitHub Repo Tokens — the #1 volume meta ($100K-$420K/day per token)
 *   2. AI/Agent Sniper Keywords — triggers automated sniper bot buys
 *   3. Duplicate Hot Token Strategy — copies high-volume token names
 *
 * Research findings driving this agent:
 *   - GitHub repo tokens (format: "REPO github.com/owner/REPO") dominate bankr
 *   - Top bankr tokens: GPT-SOVITS ($421K), IONIC-FRAMEWORK ($418K), FISH-SPEECH ($376K)
 *   - All use Uniswap V3 on Base with 0xadf address prefix
 *   - Sniper bots target: GPT, AI, AGENT, NEURAL, AUTONOMOUS, PROTOCOL, ROBOT
 *   - Best launch window: 12:00–16:00 UTC (US/EU overlap)
 *   - Best days: Monday & Tuesday (weekly momentum reset)
 *   - Fee model: 1.2% per swap, 57% to deployer (95% with Bankr Club)
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

// ════════════════════════════════════════════════════
// STRATEGY 1: GitHub Repo Tokens (highest volume meta)
// ════════════════════════════════════════════════════
// Format: name = "REPO-NAME github.com/owner/REPO-NAME"
// These get $100K-$420K daily volume on bankr
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
  // Crypto/Web3 repos
  { repo: "foundry-rs/foundry", name: "FOUNDRY", topic: "crypto" },
  { repo: "paradigmxyz/reth", name: "RETH", topic: "crypto" },
  { repo: "Uniswap/v4-core", name: "UNISWAP-V4", topic: "crypto" },
  { repo: "aave/aave-v3-core", name: "AAVE-V3", topic: "crypto" },
  // Viral/trending repos
  { repo: "yt-dlp/yt-dlp", name: "YT-DLP", topic: "viral" },
  { repo: "practical-tutorials/project-based-learning", name: "PROJECT-BASED-LEARNING", topic: "viral" },
  { repo: "codecrafters-io/build-your-own-x", name: "BUILD-YOUR-OWN-X", topic: "viral" },
  { repo: "krahets/hello-algo", name: "HELLO-ALGO", topic: "viral" },
];

// ════════════════════════════════════════════════════
// STRATEGY 2: AI/Agent Sniper Bot Keyword Tokens
// ════════════════════════════════════════════════════
// These keywords trigger automated sniper bots that buy immediately on launch
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
];

// ════════════════════════════════════════════════════
// STRATEGY 3: Duplicate Hot Token Names
// ════════════════════════════════════════════════════
// Tokens that already generate high volume — duplicates often catch spillover volume
const HOT_TOKEN_DUPLICATES = [
  { name: "Defense of the Agents", symbol: "DOTA" },
  { name: "Zen Browser", symbol: "ZEN" },
  { name: "Personal Computer", symbol: "PC" },
  { name: "Adaptive Computer", symbol: "AC" },
  { name: "Virtual Protocol", symbol: "VIRTUAL" },
  { name: "tokenbot", symbol: "CLANKER" },
  { name: "Robot Money", symbol: "ROBOTMONEY" },
];

// Strategy weights — how many of each type per 10 daily launches
const STRATEGY_MIX = {
  github: 5,      // 5 out of 10 are github repo tokens (highest volume)
  sniper: 3,      // 3 out of 10 are sniper keyword tokens
  duplicate: 1,   // 1 out of 10 is a duplicate of a hot token
  trending: 1,    // 1 out of 10 fetched from live DexScreener/GitHub trending
};

class BankrLauncher {
  constructor({ notifiers = [], config = {} }) {
    this.notifiers = notifiers;
    this.config = {
      maxLaunchesPerDay: config.maxLaunchesPerDay || 10,
      feeClaimThreshold: config.feeClaimThreshold || 0.0001,
      launchWindowStart: config.launchWindowStart || 12, // UTC hour
      launchWindowEnd: config.launchWindowEnd || 20,     // UTC hour (extended to 20)
      ...config,
    };
    this.log = new Logger("bankr-launcher");
    this._ensureDataDir();
    this.tokenData = this._loadTokenData();
    this.researchData = this._loadResearchData();
    this.log.info(
      `Bankr Launcher v2 initialized. ` +
      `${this.tokenData.tokens.length} tokens tracked, ` +
      `${this.tokenData.stats.totalLaunched} total launched, ` +
      `${this.tokenData.stats.totalFeesClaimed.toFixed(6)} WETH claimed.`
    );
  }

  _ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  _loadTokenData() {
    try {
      if (fs.existsSync(TOKENS_FILE)) return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
    } catch {}
    return {
      tokens: [],
      stats: { totalLaunched: 0, totalFeesEarned: 0, totalFeesClaimed: 0 },
      lastLaunchDate: null,
      launchesToday: 0,
      dailyHistory: [],
    };
  }

  _loadResearchData() {
    try {
      if (fs.existsSync(RESEARCH_FILE)) return JSON.parse(fs.readFileSync(RESEARCH_FILE, "utf8"));
    } catch {}
    return { trendingRepos: [], hotTokens: [], lastFetch: null };
  }

  _saveTokenData() {
    try {
      fs.writeFileSync(TOKENS_FILE, JSON.stringify(this.tokenData, null, 2));
    } catch (e) {
      this.log.error(`Token data save failed: ${e.message}`);
    }
  }

  _saveResearchData() {
    try {
      fs.writeFileSync(RESEARCH_FILE, JSON.stringify(this.researchData, null, 2));
    } catch (e) {
      this.log.error(`Research data save failed: ${e.message}`);
    }
  }

  _runBankr(args, timeout = 120000) {
    try {
      const result = execSync(`bankr ${args}`, {
        encoding: "utf8",
        timeout,
        stdio: ["pipe", "pipe", "pipe"],
        input: "\n\n\n\n", // Auto-skip any interactive prompts (image, tweet, etc.)
      });
      return result.trim();
    } catch (e) {
      const stderr = e.stderr ? e.stderr.toString() : "";
      const stdout = e.stdout ? e.stdout.toString() : "";
      throw new Error(`bankr ${args} failed: ${stderr || stdout || e.message}`);
    }
  }

  _checkDailyLimit() {
    const today = new Date().toISOString().split("T")[0];
    if (this.tokenData.lastLaunchDate !== today) {
      // Save yesterday's stats
      if (this.tokenData.lastLaunchDate) {
        this.tokenData.dailyHistory.push({
          date: this.tokenData.lastLaunchDate,
          launched: this.tokenData.launchesToday,
        });
        // Keep last 30 days
        if (this.tokenData.dailyHistory.length > 30) this.tokenData.dailyHistory.shift();
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
    return new Date().getUTCDay(); // 0=Sun, 1=Mon, 2=Tue...
  }

  // ── STRATEGY SELECTION ──

  _selectStrategy() {
    const today = this.tokenData.launchesToday;
    const day = this._getDayOfWeek();

    // On Mon/Tue, bias more towards github tokens (proven higher volume)
    const isHighVolDay = day === 1 || day === 2;

    if (today < STRATEGY_MIX.github + (isHighVolDay ? 1 : 0)) return "github";
    if (today < STRATEGY_MIX.github + STRATEGY_MIX.sniper) return "sniper";
    if (today < STRATEGY_MIX.github + STRATEGY_MIX.sniper + STRATEGY_MIX.duplicate) return "duplicate";
    return "trending";
  }

  // ── STRATEGY 1: GitHub Repo Token ──

  _pickGitHubRepoToken() {
    const usedNames = new Set(this.tokenData.tokens.map(t => t.symbol));
    const available = GITHUB_REPO_POOL.filter(r => !usedNames.has(r.name));

    if (available.length === 0) {
      // All repos used — pick from live trending data if available
      if (this.researchData.trendingRepos.length > 0) {
        const repo = this.researchData.trendingRepos.shift();
        this._saveResearchData();
        return repo;
      }
      // Fallback: re-use a random repo with a suffix
      const base = GITHUB_REPO_POOL[Math.floor(Math.random() * GITHUB_REPO_POOL.length)];
      const v = Math.floor(Math.random() * 9) + 2;
      return { ...base, name: `${base.name}-V${v}` };
    }

    // Prioritize AI topics (highest sniper bot activity)
    const aiRepos = available.filter(r => r.topic === "ai");
    if (aiRepos.length > 0 && Math.random() < 0.6) {
      return aiRepos[Math.floor(Math.random() * aiRepos.length)];
    }
    return available[Math.floor(Math.random() * available.length)];
  }

  _formatGitHubToken(repoInfo) {
    const fullName = `${repoInfo.name} github.com/${repoInfo.repo}`;
    return { name: fullName, symbol: repoInfo.name, strategy: "github" };
  }

  // ── STRATEGY 2: Sniper Keyword Token ──

  _pickSniperToken() {
    const usedNames = new Set(this.tokenData.tokens.map(t => t.symbol));
    const available = SNIPER_KEYWORD_TOKENS.filter(t => !usedNames.has(t.symbol));

    if (available.length === 0) {
      // Generate a random combo of sniper keywords
      const prefixes = ["Autonomous", "Neural", "GPT", "AI", "Robot"];
      const middles = ["Trading", "Protocol", "DeFi", "Agent", "Network"];
      const suffixes = ["Agent", "Bot", "Protocol", "AI", "Robot"];
      const p = prefixes[Math.floor(Math.random() * prefixes.length)];
      const m = middles[Math.floor(Math.random() * middles.length)];
      const s = suffixes[Math.floor(Math.random() * suffixes.length)];
      const name = `${p} ${m} ${s}`;
      const symbol = (p[0] + m[0] + s[0] + Math.floor(Math.random() * 100)).toUpperCase();
      return { name, symbol };
    }
    return available[Math.floor(Math.random() * available.length)];
  }

  // ── STRATEGY 3: Duplicate Hot Token ──

  _pickDuplicateToken() {
    // Check live research data for current hot tokens
    if (this.researchData.hotTokens.length > 0) {
      const hot = this.researchData.hotTokens[Math.floor(Math.random() * this.researchData.hotTokens.length)];
      return { name: hot.name, symbol: hot.symbol };
    }
    return HOT_TOKEN_DUPLICATES[Math.floor(Math.random() * HOT_TOKEN_DUPLICATES.length)];
  }

  // ── LIVE RESEARCH: Fetch trending data ──

  async fetchTrendingGitHubRepos() {
    return new Promise((resolve) => {
      const url = "https://api.github.com/search/repositories?q=stars:>5000+pushed:>2026-03-01&sort=stars&order=desc&per_page=20";
      const req = https.get(url, { headers: { "User-Agent": "BankrAgent/2.0", "Accept": "application/vnd.github.v3+json" } }, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => {
          try {
            const j = JSON.parse(d);
            const repos = (j.items || [])
              .filter(repo => repo.name.length <= 30 && repo.name.length >= 3)
              .map(repo => ({
                repo: repo.full_name,
                name: repo.name.toUpperCase(),
                topic: (repo.topics || []).some(t => ["ai", "machine-learning", "deep-learning", "llm"].includes(t)) ? "ai" : "trending",
              }));
            // Filter out ones we already launched
            const usedNames = new Set(this.tokenData.tokens.map(t => t.symbol));
            const fresh = repos.filter(r => !usedNames.has(r.name));
            this.researchData.trendingRepos = fresh.slice(0, 15);
            this.researchData.lastFetch = new Date().toISOString();
            this._saveResearchData();
            this.log.info(`Fetched ${fresh.length} trending GitHub repos for token names.`);
            resolve(fresh);
          } catch (e) {
            this.log.warn(`GitHub trending fetch failed: ${e.message}`);
            resolve([]);
          }
        });
      });
      req.on("error", (e) => { this.log.warn(`GitHub API error: ${e.message}`); resolve([]); });
      req.setTimeout(10000, () => { req.destroy(); resolve([]); });
    });
  }

  async fetchHotBankrTokens() {
    return new Promise((resolve) => {
      // Search DexScreener for high-volume Base tokens with bankr prefix
      const url = "https://api.dexscreener.com/latest/dex/search?q=github.com";
      const req = https.get(url, { headers: { "User-Agent": "BankrAgent/2.0" } }, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => {
          try {
            const j = JSON.parse(d);
            const hot = (j.pairs || [])
              .filter(p => p.chainId === "base" && p.volume?.h24 > 50000 && p.baseToken.address.toLowerCase().startsWith("0xadf"))
              .sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))
              .slice(0, 10)
              .map(p => ({
                name: p.baseToken.name,
                symbol: p.baseToken.symbol,
                vol24: Math.round(p.volume?.h24 || 0),
                mc: Math.round(p.marketCap || 0),
              }));
            this.researchData.hotTokens = hot;
            this._saveResearchData();
            this.log.info(`Found ${hot.length} hot bankr tokens for duplicate strategy. Top: ${hot[0]?.symbol} ($${hot[0]?.vol24} vol)`);
            resolve(hot);
          } catch (e) {
            this.log.warn(`DexScreener fetch failed: ${e.message}`);
            resolve([]);
          }
        });
      });
      req.on("error", (e) => { this.log.warn(`DexScreener API error: ${e.message}`); resolve([]); });
      req.setTimeout(10000, () => { req.destroy(); resolve([]); });
    });
  }

  // ── CORE LAUNCH LOGIC ──

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
      this.log.info(`Strategy selected: ${strategy} (launch ${this.tokenData.launchesToday + 1}/${this.config.maxLaunchesPerDay})`);

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
          // Use live trending data
          if (this.researchData.trendingRepos.length > 0) {
            const repo = this.researchData.trendingRepos.shift();
            this._saveResearchData();
            tokenInfo = this._formatGitHubToken(repo);
            tokenInfo.strategy = "trending";
          } else {
            // Fallback to github strategy
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
      // Sanitize name for CLI
      const safeName = tokenInfo.name.replace(/"/g, '\\"');
      const safeSymbol = tokenInfo.symbol.replace(/"/g, '\\"');

      // Use `bankr agent` for fully non-interactive deployment with fees to deployer
      const prompt = `launch a token called "${safeName}" with ticker ${safeSymbol}. direct all fees to my wallet.`;
      const output = this._runBankr(`agent "${prompt}"`, 180000);

      this.log.info(`Launch output: ${output.substring(0, 500)}`);

      // Parse contract address from agent response (format: 0x...)
      const addressMatch = output.match(/0x[a-fA-F0-9]{40}/);
      const contractAddress = addressMatch ? addressMatch[0] : null;

      // Parse bankr URL if present
      const urlMatch = output.match(/https:\/\/www\.bankr\.bot\/launches\/0x[a-fA-F0-9]{40}/);
      const bankrUrl = urlMatch ? urlMatch[0] : null;

      const tokenRecord = {
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        strategy: tokenInfo.strategy,
        contractAddress,
        bankrUrl,
        launchedAt: new Date().toISOString(),
        launchOutput: output.substring(0, 500),
        feesEarned: 0,
        feesClaimed: 0,
      };

      this.tokenData.tokens.push(tokenRecord);
      this.tokenData.stats.totalLaunched++;
      this.tokenData.launchesToday++;
      this._saveTokenData();

      await this.notify(
        `🚀 *Token Launched!* [${tokenInfo.strategy}]\n` +
        `Name: ${tokenInfo.name} ($${tokenInfo.symbol})\n` +
        `${contractAddress ? `Contract: \`${contractAddress}\`` : "Check bankr fees for details"}\n` +
        `${bankrUrl ? bankrUrl + "\n" : ""}` +
        `Launches today: ${this.tokenData.launchesToday}/${this.config.maxLaunchesPerDay} | Total: ${this.tokenData.stats.totalLaunched}`
      );

      return tokenRecord;
    } catch (e) {
      this.log.error(`Token launch failed: ${e.message}`);
      await this.notify(`❌ Launch failed [${tokenInfo.strategy}]: ${tokenInfo.name} — ${e.message.substring(0, 200)}`);
      return null;
    }
  }

  async checkFees() {
    this.log.info("Checking fee earnings...");
    try {
      const output = this._runBankr("fees", 60000);

      // Parse claimable amount from output
      const claimableMatch = output.match(/CLAIMABLE WETH[^│]*│[^│]*│\s*([\d.]+)/i) ||
                             output.match(/Claimable:\s*([\d.]+)\s*WETH/i);
      const claimable = claimableMatch ? parseFloat(claimableMatch[1]) : 0;

      // Parse total earned
      const earnedMatch = output.match(/TOTAL EARNED[^│]*│[^│]*│\s*([\d.]+)/i) ||
                          output.match(/(\d+\.\d+)\s*\n\s*30 days/);
      const totalEarned = earnedMatch ? parseFloat(earnedMatch[1]) : 0;

      if (totalEarned > 0) this.tokenData.stats.totalFeesEarned = totalEarned;
      this._saveTokenData();

      this.log.info(`Fees — Claimable: ${claimable} WETH | Total earned: ${totalEarned} WETH`);

      // Auto-claim if above threshold
      if (claimable >= this.config.feeClaimThreshold) {
        this.log.info(`Claimable ${claimable} WETH above threshold ${this.config.feeClaimThreshold}, claiming...`);
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
        await this.notify(`💰 Fees claimed: ${claimed} WETH | Total claimed: ${this.tokenData.stats.totalFeesClaimed.toFixed(6)} WETH`);
      }
      return output;
    } catch (e) {
      this.log.error(`Fee claim failed: ${e.message}`);
      return null;
    }
  }

  // ── MAIN CYCLES ──

  async runLaunchCycle() {
    this.log.info("─── Launch cycle ───");

    if (!this._isInLaunchWindow()) {
      const utcHour = new Date().getUTCHours();
      this.log.info(`Outside launch window (current: ${utcHour} UTC, window: ${this.config.launchWindowStart}-${this.config.launchWindowEnd} UTC). Skipping.`);
      return;
    }

    if (!this._checkDailyLimit()) {
      this.log.info(`Daily limit reached (${this.tokenData.launchesToday}/${this.config.maxLaunchesPerDay}).`);
      return;
    }

    // Launch one token per cycle (scheduled every 45 min during window = ~10 per day)
    const result = await this.launchToken();
    if (result) {
      this.log.info(`Successfully launched ${result.symbol}. ${this.tokenData.launchesToday}/${this.config.maxLaunchesPerDay} today.`);
    }
  }

  async runResearchCycle() {
    this.log.info("─── Research cycle ───");
    const lastFetch = this.researchData.lastFetch ? new Date(this.researchData.lastFetch) : new Date(0);
    const hoursSinceFetch = (Date.now() - lastFetch.getTime()) / 3600000;

    if (hoursSinceFetch >= 6) {
      this.log.info("Refreshing trending data (>6h since last fetch)...");
      await Promise.all([
        this.fetchTrendingGitHubRepos(),
        this.fetchHotBankrTokens(),
      ]);
    } else {
      this.log.info(`Research data fresh (${hoursSinceFetch.toFixed(1)}h old). Skipping fetch.`);
    }
  }

  async runFeeCycle() {
    this.log.info("─── Fee check cycle ───");
    await this.checkFees();

    const stats = this.tokenData.stats;
    this.log.info(
      `Stats: ${stats.totalLaunched} launched | ` +
      `Earned: ${stats.totalFeesEarned.toFixed(6)} WETH | ` +
      `Claimed: ${stats.totalFeesClaimed.toFixed(6)} WETH | ` +
      `Today: ${this.tokenData.launchesToday}/${this.config.maxLaunchesPerDay}`
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
      tokens: this.tokenData.tokens,
      launchesToday: this.tokenData.launchesToday,
      researchData: {
        trendingRepos: this.researchData.trendingRepos.length,
        hotTokens: this.researchData.hotTokens.length,
        lastFetch: this.researchData.lastFetch,
      },
    };
  }
}

// ── Standalone runner ──
if (require.main === module) {
  const cron = require("node-cron");
  const log = new Logger("bankr-main");

  const launcher = new BankrLauncher({
    config: {
      maxLaunchesPerDay: parseInt(process.env.BANKR_MAX_LAUNCHES_PER_DAY || "10"),
    },
  });

  log.info("=== BANKR TOKEN LAUNCHER v2 (DATA-DRIVEN) STARTING ===");
  log.info(`Strategy mix: ${JSON.stringify(STRATEGY_MIX)}`);
  log.info(`Launch window: ${launcher.config.launchWindowStart}:00-${launcher.config.launchWindowEnd}:00 UTC`);

  // Launch cycle: Every 45 min during the 8-hour launch window = ~10 launches/day
  cron.schedule("*/45 * * * *", async () => {
    try { await launcher.runLaunchCycle(); }
    catch (e) { log.error("Launch cycle error:", e.message); }
  });

  // Fee check: Every 2 hours
  cron.schedule("15 */2 * * *", async () => {
    try { await launcher.runFeeCycle(); }
    catch (e) { log.error("Fee cycle error:", e.message); }
  });

  // Research refresh: Every 6 hours
  cron.schedule("0 */6 * * *", async () => {
    try { await launcher.runResearchCycle(); }
    catch (e) { log.error("Research cycle error:", e.message); }
  });

  // Initial: Research first, then launch
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
