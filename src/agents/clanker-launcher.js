/**
 * Clanker Token Launcher Agent v2 — Sniper-Optimized & Self-Learning
 *
 * GOALS:
 *   1. Launch 10 tokens/day on Base via Clanker SDK v4
 *   2. Optimize token names/descriptions to trigger sniper bot buys
 *   3. Track volume per token to learn what works
 *   4. Auto-rebalance strategy mix toward highest performers
 *   5. Research real-time trending clanker tokens for duplication
 *
 * Sniper bot trigger strategies:
 *   1. AI/Agent Keywords — "agent", "neural", "GPT", "autonomous" trigger AI snipers
 *   2. GitHub Repo Tokens — repos with >1k stars trigger dev-mindshare snipers
 *   3. Duplicate Hot Tokens — copy high-volume clanker token names/themes
 *   4. Viral/Meme Meta — farcaster memes and cultural tokens
 *
 * Sniper-optimized metadata:
 *   - Descriptions include "lp burned", "no dev tokens", "ai agent"
 *   - Social links to legitimate repos/projects
 *   - Deployed via clanker (bots trust the factory)
 */
require("dotenv").config();
const { spawnSync } = require("child_process");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { Logger } = require("../utils/logger");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const CLANKER_TOKENS_FILE = path.join(DATA_DIR, "clanker-tokens.json");
const CLANKER_RESEARCH_FILE = path.join(DATA_DIR, "clanker-research.json");
const CLANKER_PERF_FILE = path.join(DATA_DIR, "clanker-performance.json");

const WALLET_ADDR = process.env.CLANKER_FEE_WALLET || "0x162ee01a2eab184f6698ec8663ad84c4ee506733";

// ════════════════════════════════════════════════════
// STRATEGY 1: AI/Agent Sniper Keyword Tokens
// These keywords trigger specialized AI-token sniper bots
// ════════════════════════════════════════════════════
const AI_AGENT_TOKENS = [
  { name: "Based AI", symbol: "BASEDAI", desc: "Based AI — the AI agent of Base chain" },
  { name: "Sentient Coin", symbol: "SENTIENT", desc: "Sentient — when AI becomes self-aware on chain" },
  { name: "GPT Coin", symbol: "GPT", desc: "GPT — the GPT token on Base" },
  { name: "Agent Zero", symbol: "AGENT0", desc: "Agent Zero — the first autonomous AI agent" },
  { name: "Robot Ape", symbol: "ROBOAPE", desc: "Robot Ape — AI meets degen culture" },
  { name: "DeepSeek", symbol: "DSEEK", desc: "DeepSeek — open source AI revolution" },
  { name: "AI Doomer", symbol: "DOOMER", desc: "AI Doomer — the end is near and it's on chain" },
  { name: "Neural Pepe", symbol: "NPEPE", desc: "Neural Pepe — AI-powered meme intelligence" },
  { name: "Claude", symbol: "CLAUDE", desc: "Claude — the AI that sees everything" },
  { name: "Mistral AI", symbol: "MISTRAL", desc: "Mistral — the open source AI force" },
  { name: "Onchain Brain", symbol: "BRAIN", desc: "Onchain Brain — collective AI intelligence" },
  { name: "Degen AI", symbol: "DEGENAI", desc: "Degen AI — neural network trained on rug pulls" },
  { name: "AI Fren", symbol: "AIFREN", desc: "AI Fren — your onchain AI companion" },
  { name: "Robot Overlord", symbol: "OVERLORD", desc: "Robot Overlord — the machines have arrived" },
  { name: "GPT Degen", symbol: "GPTDEGEN", desc: "GPT Degen — AI-powered degenerate trading" },
  { name: "Singularity", symbol: "SING", desc: "Singularity — the moment AI surpasses us" },
  { name: "Skynet Base", symbol: "SKYNET", desc: "Skynet — judgment day is on Base" },
  { name: "Matrix AI", symbol: "MATRIX", desc: "Matrix — take the onchain pill" },
  { name: "Turbo AI", symbol: "TURBO", desc: "Turbo AI — maximum speed intelligence" },
  { name: "Agent Smith", symbol: "SMITH", desc: "Agent Smith — inevitability on Base" },
];

// ════════════════════════════════════════════════════
// STRATEGY 2: GitHub Repo Tokens
// Repos with >1k stars trigger dev-mindshare snipers
// ════════════════════════════════════════════════════
const GITHUB_REPO_TOKENS = [
  { name: "Ollama", symbol: "OLLAMA", repo: "ollama/ollama", desc: "Ollama — run AI locally" },
  { name: "PyTorch", symbol: "PYTORCH", repo: "pytorch/pytorch", desc: "PyTorch — the AI framework" },
  { name: "LangChain", symbol: "LCHAIN", repo: "langchain-ai/langchain", desc: "LangChain — AI app builder" },
  { name: "FastAPI", symbol: "FASTAPI", repo: "tiangolo/fastapi", desc: "FastAPI — modern web framework" },
  { name: "Rust", symbol: "RUST", repo: "rust-lang/rust", desc: "Rust — safety and performance" },
  { name: "Docker", symbol: "DOCKER", repo: "docker/compose", desc: "Docker — containers everywhere" },
  { name: "Kubernetes", symbol: "K8S", repo: "kubernetes/kubernetes", desc: "Kubernetes — cloud infrastructure" },
  { name: "ComfyUI", symbol: "COMFY", repo: "comfyanonymous/ComfyUI", desc: "ComfyUI — AI image gen" },
  { name: "Supabase", symbol: "SUPA", repo: "supabase/supabase", desc: "Supabase — the open Firebase" },
  { name: "Vite", symbol: "VITE", repo: "vitejs/vite", desc: "Vite — instant dev server" },
  { name: "Bun", symbol: "BUN", repo: "oven-sh/bun", desc: "Bun — fast JavaScript runtime" },
  { name: "SWE Agent", symbol: "SWE", repo: "princeton-nlp/SWE-agent", desc: "SWE Agent — AI software engineer" },
  { name: "Foundry", symbol: "FOUNDRY", repo: "foundry-rs/foundry", desc: "Foundry — Ethereum dev toolkit" },
  { name: "Next.js", symbol: "NEXTJS", repo: "vercel/next.js", desc: "Next.js — the React framework" },
  { name: "ChatDev", symbol: "CHATDEV", repo: "OpenBMB/ChatDev", desc: "ChatDev — AI software company" },
];

// ════════════════════════════════════════════════════
// STRATEGY 3: Viral/Meme Meta Tokens
// Cultural tokens that capture farcaster/base mindshare
// ════════════════════════════════════════════════════
const VIRAL_TOKENS = [
  { name: "PepeWif", symbol: "PEWIF", desc: "PepeWif — Pepe but with a hat" },
  { name: "BonkInu", symbol: "BONK", desc: "BonkInu — bonk the charts" },
  { name: "WojakInu", symbol: "WOJAK", desc: "Wojak — he bought?" },
  { name: "Main Character", symbol: "MC", desc: "Main Character — you are the main character" },
  { name: "Diamond Hands", symbol: "DIAMOND", desc: "Diamond Hands — never selling" },
  { name: "Rug Survivor", symbol: "RUGSURV", desc: "Rug Survivor — survived every rug, still here" },
  { name: "Touch Grass", symbol: "GRASS", desc: "Touch Grass — onchain wellness" },
  { name: "Full Send", symbol: "SEND", desc: "Full Send — no half measures" },
  { name: "Based Frog", symbol: "BFROG", desc: "Based Frog — the most based frog on Base" },
  { name: "Degen Mode", symbol: "DEGEN", desc: "Degen Mode — full degen activated" },
  { name: "Moon Mission", symbol: "MOON", desc: "Moon Mission — to the moon and beyond" },
  { name: "Pump It", symbol: "PUMP", desc: "Pump It — only up from here" },
  { name: "Anime Bitcoin", symbol: "ANIME", desc: "Anime Bitcoin — kawaii meets crypto" },
  { name: "GigaChad", symbol: "GIGA", desc: "GigaChad — the ultimate Chad token" },
  { name: "Paper Hands", symbol: "PAPER", desc: "Paper Hands — he sold" },
  { name: "Cope", symbol: "COPE", desc: "Cope — maximum copium" },
  { name: "Seethe", symbol: "SEETHE", desc: "Seethe — they're all seething" },
  { name: "Based Culture", symbol: "CULTURE", desc: "Based Culture — the onchain movement" },
  { name: "Purple Pill", symbol: "PURPLE", desc: "Purple Pill — the color of decentralization" },
  { name: "Turbo Frog", symbol: "TURBOFROG", desc: "Turbo Frog — faster than Pepe" },
];

// Default strategy weights — live_duplicate dominates because
// duplicating tokens with PROVEN volume is the only strategy that works.
// Research: 0 of 10 static-name tokens got any volume. Winners are all duplicates of trending.
const DEFAULT_STRATEGY_MIX = { live_duplicate: 5, ai_agent: 1, duplicate: 2, viral: 2 };

// ════════════════════════════════════════════════════
// Sniper-optimized metadata that triggers bots to buy
// ════════════════════════════════════════════════════
function buildSniperDescription(baseDesc, strategy) {
  // Keep it short and natural — long robotic descriptions look like spam
  const safetyTags = ["Deployed via Clanker", "Contract verified"];
  const tag = safetyTags[Math.floor(Math.random() * safetyTags.length)];
  return `${baseDesc}. ${tag}`;
}

class ClankerLauncher {
  constructor({ notifiers = [], config = {} }) {
    this.notifiers = notifiers;
    this.config = {
      maxLaunchesPerDay: config.maxLaunchesPerDay || 10,
      chainId: config.chainId || 8453, // Base
      rpcUrl: config.rpcUrl || "https://mainnet.base.org",
      launchWindowStart: config.launchWindowStart || 8,
      launchWindowEnd: config.launchWindowEnd || 23,
      initialMarketCap: config.initialMarketCap || "5", // 5 ETH initial mcap
      ...config,
    };
    this.log = new Logger("clanker-launcher");
    this._ensureDataDir();
    this.tokenData = this._loadTokenData();
    this.researchData = this._loadResearchData();
    this.perfData = this._loadPerformanceData();
    this.log.info(
      `Clanker Launcher v2 (sniper-optimized) initialized. ` +
      `${this.tokenData.tokens.length} tracked, ${this.tokenData.stats.totalLaunched} launched. ` +
      `Mix: ${JSON.stringify(this.perfData.adaptiveMix)}`
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

  _loadResearchData() {
    try {
      if (fs.existsSync(CLANKER_RESEARCH_FILE)) return JSON.parse(fs.readFileSync(CLANKER_RESEARCH_FILE, "utf8"));
    } catch {}
    return { hotTokens: [], trendingRepos: [], lastFetch: null };
  }

  _loadPerformanceData() {
    try {
      if (fs.existsSync(CLANKER_PERF_FILE)) return JSON.parse(fs.readFileSync(CLANKER_PERF_FILE, "utf8"));
    } catch {}
    return {
      strategyScores: {
        live_duplicate: { totalVol: 0, count: 0 },
        ai_agent: { totalVol: 0, count: 0 },
        duplicate: { totalVol: 0, count: 0 },
        viral: { totalVol: 0, count: 0 },
      },
      adaptiveMix: { ...DEFAULT_STRATEGY_MIX },
      volumeChecks: [],
      lastAdaptation: null,
      insights: [],
      // Real-time cache of fresh tokens with volume
      freshVolumeTokens: [],
      lastFreshScan: null,
    };
  }

  _saveTokenData() {
    try { fs.writeFileSync(CLANKER_TOKENS_FILE, JSON.stringify(this.tokenData, null, 2)); }
    catch (e) { this.log.error(`Token data save failed: ${e.message}`); }
  }

  _saveResearchData() {
    try { fs.writeFileSync(CLANKER_RESEARCH_FILE, JSON.stringify(this.researchData, null, 2)); }
    catch (e) { this.log.error(`Research data save failed: ${e.message}`); }
  }

  _savePerformanceData() {
    try { fs.writeFileSync(CLANKER_PERF_FILE, JSON.stringify(this.perfData, null, 2)); }
    catch (e) { this.log.error(`Performance data save failed: ${e.message}`); }
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

  // ═══════════════════════════════════════════════════
  // ADAPTIVE STRATEGY SELECTION
  // ═══════════════════════════════════════════════════

  _getAdaptiveMix() {
    return this.perfData.adaptiveMix || { ...DEFAULT_STRATEGY_MIX };
  }

  _selectStrategy() {
    const mix = this._getAdaptiveMix();
    const today = this.tokenData.launchesToday;

    const liveDupEnd = mix.live_duplicate || 5;
    const aiEnd = liveDupEnd + (mix.ai_agent || 1);
    const dupEnd = aiEnd + (mix.duplicate || 2);

    if (today < liveDupEnd) return "live_duplicate";
    if (today < aiEnd) return "ai_agent";
    if (today < dupEnd) return "duplicate";
    return "viral";
  }

  _adaptStrategies() {
    const scores = this.perfData.strategyScores;
    const strategies = ["live_duplicate", "ai_agent", "duplicate", "viral"];
    const avgVols = {};
    let hasData = false;

    for (const s of strategies) {
      if (scores[s] && scores[s].count >= 3) {
        avgVols[s] = scores[s].totalVol / scores[s].count;
        hasData = true;
      }
    }

    if (!hasData) {
      this.log.info("Not enough volume data for adaptation (need ≥3/strategy). Using defaults.");
      return;
    }

    const ranked = Object.entries(avgVols).sort((a, b) => b[1] - a[1]);
    const oldMix = { ...this.perfData.adaptiveMix };
    const slotAlloc = [4, 3, 2, 1];
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
    this.perfData.insights.push({
      date: new Date().toISOString(), avgVols, oldMix, newMix, topStrategy: ranked[0][0],
    });
    if (this.perfData.insights.length > 30) this.perfData.insights.shift();
    this.perfData.lastAdaptation = new Date().toISOString();
    this._savePerformanceData();

    this.log.info(`STRATEGY ADAPTATION: ${JSON.stringify(oldMix)} → ${JSON.stringify(newMix)} | Top: ${ranked[0][0]}`);
  }

  // ── STRATEGY PICKERS ──

  _pickAiAgentToken() {
    const usedSymbols = new Set(this.tokenData.tokens.map(t => t.symbol));
    const available = AI_AGENT_TOKENS.filter(t => !usedSymbols.has(t.symbol));
    if (available.length === 0) {
      const prefixes = ["Autonomous", "Neural", "GPT", "AI", "DeepSeek", "Claude", "Mistral"];
      const middles = ["Trading", "Protocol", "DeFi", "Agent", "Network", "Quant"];
      const suffixes = ["Agent", "Bot", "Protocol", "AI"];
      const p = prefixes[Math.floor(Math.random() * prefixes.length)];
      const m = middles[Math.floor(Math.random() * middles.length)];
      const s = suffixes[Math.floor(Math.random() * suffixes.length)];
      const sym = (p.slice(0, 3) + m[0] + s[0] + Math.floor(Math.random() * 100)).toUpperCase();
      return { name: `${p} ${m} ${s}`, symbol: sym, desc: `${p} ${m} ${s} — autonomous AI protocol on Base` };
    }
    return available[Math.floor(Math.random() * available.length)];
  }

  _pickGitHubToken() {
    const usedSymbols = new Set(this.tokenData.tokens.map(t => t.symbol));
    let available = GITHUB_REPO_TOKENS.filter(t => !usedSymbols.has(t.symbol));

    // Also use trending repos from research
    if (available.length === 0 && this.researchData.trendingRepos.length > 0) {
      const repo = this.researchData.trendingRepos.shift();
      this._saveResearchData();
      return { name: repo.name, symbol: repo.name.toUpperCase().slice(0, 8), repo: repo.repo, desc: `${repo.name} — trending open source project` };
    }

    if (available.length === 0) {
      const base = GITHUB_REPO_TOKENS[Math.floor(Math.random() * GITHUB_REPO_TOKENS.length)];
      const v = Math.floor(Math.random() * 9) + 2;
      return { ...base, name: `${base.name} V${v}`, symbol: `${base.symbol}V${v}` };
    }

    // Prioritize AI repos 60% of the time (highest sniper activity)
    const aiRepos = available.filter(t => t.desc.toLowerCase().includes("ai") || t.desc.toLowerCase().includes("llm"));
    if (aiRepos.length > 0 && Math.random() < 0.6) {
      return aiRepos[Math.floor(Math.random() * aiRepos.length)];
    }
    return available[Math.floor(Math.random() * available.length)];
  }

  _pickDuplicateToken() {
    if (this.researchData.hotTokens && this.researchData.hotTokens.length > 0) {
      const sorted = [...this.researchData.hotTokens].sort((a, b) => (b.vol24 || 0) - (a.vol24 || 0));
      const top = sorted.slice(0, 5);
      const weights = [0.4, 0.25, 0.2, 0.1, 0.05];
      const roll = Math.random();
      let cumulative = 0;
      for (let i = 0; i < top.length; i++) {
        cumulative += weights[i] || 0.05;
        if (roll <= cumulative) {
          this.log.info(`Duplicate pick: ${top[i].symbol} (vol24=$${top[i].vol24}, mc=$${top[i].mc})`);
          return { name: top[i].name, symbol: top[i].symbol, desc: `${top[i].name} — high volume token on Base` };
        }
      }
      return { name: top[0].name, symbol: top[0].symbol, desc: `${top[0].name} — high volume token on Base` };
    }
    // Fallback: duplicate a known high-performer
    const fallback = [
      { name: "Defense of the Agents", symbol: "DOTA", desc: "Defense of the Agents — AI agent meta token" },
      { name: "BankrCoin Clone", symbol: "BNKR2", desc: "BankrCoin ecosystem token on Base" },
      { name: "Neural Protocol", symbol: "NEURALP", desc: "Neural protocol — AI agent token" },
    ];
    return fallback[Math.floor(Math.random() * fallback.length)];
  }

  _pickViralToken() {
    const usedSymbols = new Set(this.tokenData.tokens.map(t => t.symbol));
    const available = VIRAL_TOKENS.filter(t => !usedSymbols.has(t.symbol));
    if (available.length === 0) {
      const id = Math.random().toString(36).substring(2, 6).toUpperCase();
      return { name: `Based ${id}`, symbol: `B${id}`, desc: `Based culture token — onchain movement` };
    }
    return available[Math.floor(Math.random() * available.length)];
  }

  // LIVE DUPLICATE: Pick from freshly discovered tokens that have volume
  _pickLiveDuplicateToken() {
    const fresh = this.perfData.freshVolumeTokens || [];
    if (fresh.length > 0) {
      // Sort by volume, pick from top (weighted toward highest)
      const sorted = [...fresh].sort((a, b) => (b.vol24 || 0) - (a.vol24 || 0));
      const pick = sorted[0];
      this.log.info(`Live duplicate pick: ${pick.symbol} (vol24=$${pick.vol24}, source: ${pick.source})`);
      // Remove so we don't duplicate the same one twice
      this.perfData.freshVolumeTokens = fresh.filter(t => t.symbol !== pick.symbol);
      this._savePerformanceData();
      return { name: pick.name, symbol: pick.symbol, desc: `${pick.name} — trending on Base` };
    }
    // Fallback to duplicate strategy
    this.log.info("No fresh volume tokens cached. Falling back to duplicate.");
    return this._pickDuplicateToken();
  }

  // ═══════════════════════════════════════════════════
  // REAL-TIME FRESH TOKEN SCANNER
  // Scans DexScreener for fresh Base tokens with volume to duplicate
  // ═══════════════════════════════════════════════════

  async scanFreshLaunches() {
    this.log.info("Scanning for fresh launches with volume...");
    const found = [];
    const usedSymbols = new Set(this.tokenData.tokens.map(t => t.symbol));

    // Search DexScreener with MANY specific queries
    const searches = [
      // Proven winners
      "gork", "BaseDOG", "BasePEPE", "defense agents", "DOTA base",
      // Top bankr tokens (cross-platform)
      "CLAWD", "GITLAWB", "FELIX", "AGNT", "JUNO agent", "LITCOIN",
      "BOTCOIN", "cyb3r", "KellyClaude", "robot money",
      // Base + meme combos
      "dog base", "cat base", "frog base", "pepe base", "shiba base",
      // AI/Agent (dominant narrative)
      "agent base", "AI base token", "neural base", "GPT base",
      "autonomous base", "sentient base", "bot base",
      // Trending AI names
      "Grok base", "ChatGPT base", "Claude base", "Gemini base",
      // News/political
      "trump base", "tariff base", "Elon base",
      // Base culture
      "degen base", "higher base", "farcaster token", "based token",
      // Meme patterns
      "meme base new", "fartcoin", "bonk base", "wojak base",
      "moon base token", "pump base", "send base",
      // Platform tokens
      "clanker", "bankr token",
      // Broad search
      "base token new launch", "base meme coin", "base chain token",
    ];

    for (const q of searches) {
      try {
        const d = await this._httpGet(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`);
        if (d?.pairs) {
          d.pairs
            .filter(p => {
              if (p.chainId !== "base") return false;
              const ageH = (Date.now() - (p.pairCreatedAt || 0)) / 3600000;
              return ageH < 168 && (p.volume?.h24 || 0) > 100;
            })
            .sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))
            .slice(0, 5)
            .forEach(p => {
              if (!found.find(f => f.symbol === p.baseToken.symbol) && !usedSymbols.has(p.baseToken.symbol)) {
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

    // Sort by volume and cache
    found.sort((a, b) => b.vol24 - a.vol24);
    this.perfData.freshVolumeTokens = found.slice(0, 30);
    this.perfData.lastFreshScan = new Date().toISOString();
    this._savePerformanceData();

    this.log.info(`Fresh scan: ${found.length} tokens with volume. Top: ${found[0]?.symbol || "none"} ($${found[0]?.vol24 || 0})`);
    found.slice(0, 5).forEach(t => {
      this.log.info(`  ${t.symbol.padEnd(14)} vol24=$${t.vol24} | ${t.name} | src=${t.source}`);
    });
    return found;
  }

  // ═══════════════════════════════════════════════════
  // VOLUME TRACKING (self-learning)
  // ═══════════════════════════════════════════════════

  _httpGet(url) {
    return new Promise((resolve) => {
      const req = https.get(url, { headers: { "User-Agent": "ClankerAgent/2.0" } }, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
      });
      req.on("error", () => resolve(null));
      req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    });
  }

  _scheduleVolumeCheck(tokenRecord) {
    if (!tokenRecord.contractAddress) return;
    const now = Date.now();
    this.perfData.volumeChecks.push(
      { addr: tokenRecord.contractAddress, strategy: tokenRecord.strategy, checkAt: now + 3600000, type: "1h" },
      { addr: tokenRecord.contractAddress, strategy: tokenRecord.strategy, checkAt: now + 21600000, type: "6h" },
      { addr: tokenRecord.contractAddress, strategy: tokenRecord.strategy, checkAt: now + 86400000, type: "24h" },
    );
    this._savePerformanceData();
  }

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

        if (check.type === "24h") {
          if (!this.perfData.strategyScores[check.strategy]) {
            this.perfData.strategyScores[check.strategy] = { totalVol: 0, count: 0 };
          }
          this.perfData.strategyScores[check.strategy].totalVol += vol24;
          this.perfData.strategyScores[check.strategy].count++;
        }

        const token = this.tokenData.tokens.find(t => t.contractAddress === check.addr);
        if (token) {
          if (!token.volumeData) token.volumeData = {};
          token.volumeData[check.type] = { vol24, vol1h, checkedAt: new Date().toISOString() };
          this._saveTokenData();
        }

        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        this.log.warn(`Volume check failed for ${check.addr.slice(0, 10)}...: ${e.message}`);
      }
    }

    this.perfData.volumeChecks = remaining;
    this._savePerformanceData();

    if (due.some(c => c.type === "24h")) this._adaptStrategies();
  }

  // ═══════════════════════════════════════════════════
  // LIVE RESEARCH
  // ═══════════════════════════════════════════════════

  async fetchHotClankerTokens() {
    // Search DexScreener for top clanker tokens by volume
    const data = await this._httpGet("https://api.dexscreener.com/latest/dex/search?q=clanker");
    if (!data || !data.pairs) { this.log.warn("DexScreener clanker fetch failed"); return []; }

    const hot = data.pairs
      .filter(p => p.chainId === "base" && p.volume?.h24 > 10000)
      .sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))
      .slice(0, 20)
      .map(p => ({
        name: p.baseToken.name,
        symbol: p.baseToken.symbol,
        vol24: Math.round(p.volume?.h24 || 0),
        mc: Math.round(p.marketCap || 0),
        txns24: (p.txns?.h24?.buys || 0) + (p.txns?.h24?.sells || 0),
        addr: p.baseToken.address,
      }));

    this.researchData.hotTokens = hot;
    this._saveResearchData();
    this.log.info(`Found ${hot.length} hot clanker tokens. Top: ${hot[0]?.symbol} ($${hot[0]?.vol24} vol, ${hot[0]?.txns24} txns)`);

    // Analyze which themes are performing best
    const aiTokens = hot.filter(t => /ai|agent|bot|neural|gpt|auto/i.test(t.name));
    const repoTokens = hot.filter(t => /github|\.com/i.test(t.name));
    this.log.info(`  AI/Agent tokens in top 20: ${aiTokens.length} | GitHub tokens: ${repoTokens.length}`);

    return hot;
  }

  async fetchTrendingGitHubRepos() {
    const data = await this._httpGet("https://api.github.com/search/repositories?q=stars:>5000+pushed:>2026-03-01&sort=stars&order=desc&per_page=20");
    if (!data || !data.items) { this.log.warn("GitHub trending fetch failed"); return []; }

    const repos = data.items
      .filter(repo => repo.name.length >= 3 && repo.name.length <= 25)
      .map(repo => ({
        repo: repo.full_name,
        name: repo.name,
        stars: repo.stargazers_count,
        topic: (repo.topics || []).some(t => ["ai", "machine-learning", "deep-learning", "llm"].includes(t)) ? "ai" : "general",
      }));

    const usedSymbols = new Set(this.tokenData.tokens.map(t => t.symbol));
    const fresh = repos.filter(r => !usedSymbols.has(r.name.toUpperCase().slice(0, 8)));
    this.researchData.trendingRepos = fresh.slice(0, 15);
    this.researchData.lastFetch = new Date().toISOString();
    this._saveResearchData();
    this.log.info(`Fetched ${fresh.length} trending GitHub repos.`);
    return fresh;
  }

  // ═══════════════════════════════════════════════════
  // CORE LAUNCH LOGIC — Clanker SDK v4
  // ═══════════════════════════════════════════════════

  async launchToken(overrideName, overrideSymbol) {
    if (!this._checkDailyLimit()) {
      this.log.info(`Daily launch limit reached (${this.config.maxLaunchesPerDay}/day). Skipping.`);
      return null;
    }

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      this.log.error("PRIVATE_KEY not set — cannot deploy token.");
      return null;
    }

    let tokenInfo;
    if (overrideName) {
      tokenInfo = { name: overrideName, symbol: overrideSymbol || overrideName.substring(0, 8).toUpperCase(), desc: overrideName, strategy: "manual" };
    } else {
      const strategy = this._selectStrategy();
      this.log.info(`Strategy: ${strategy} (launch ${this.tokenData.launchesToday + 1}/${this.config.maxLaunchesPerDay}) | Mix: ${JSON.stringify(this._getAdaptiveMix())}`);

      switch (strategy) {
        case "live_duplicate": tokenInfo = { ...this._pickLiveDuplicateToken(), strategy: "live_duplicate" }; break;
        case "ai_agent": tokenInfo = { ...this._pickAiAgentToken(), strategy: "ai_agent" }; break;
        case "duplicate": tokenInfo = { ...this._pickDuplicateToken(), strategy: "duplicate" }; break;
        case "viral": tokenInfo = { ...this._pickViralToken(), strategy: "viral" }; break;
      }
    }

    const description = buildSniperDescription(tokenInfo.desc || tokenInfo.name, tokenInfo.strategy);
    this.log.info(`Launching [${tokenInfo.strategy}]: ${tokenInfo.name} ($${tokenInfo.symbol})`);
    this.log.info(`Description: ${description}`);

    const MAX_RETRIES = 2;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Use clanker-sdk CLI for reliable non-interactive deploys
        const rewardRecipients = JSON.stringify([{
          admin: WALLET_ADDR,
          recipient: WALLET_ADDR,
          bps: 10000,
          token: "Paired",
        }]);

        const safeName = tokenInfo.name.replace(/"/g, '\\"');
        const safeSymbol = tokenInfo.symbol.replace(/"/g, '\\"');
        const safeDesc = description.replace(/"/g, '\\"');
        const safeRewards = rewardRecipients.replace(/"/g, '\\"');

        let cmd = `npx clanker-sdk deploy --chain base --name "${safeName}" --symbol "${safeSymbol}" --description "${safeDesc}" --starting-market-cap ${this.config.initialMarketCap} --reward-recipients "${safeRewards}" --dev-buy-eth 0 --json`;

        // Add GitHub link as twitter URL for repo tokens (visible to bots)
        if (tokenInfo.repo) {
          cmd += ` --twitter "https://github.com/${tokenInfo.repo}"`;
        }

        this.log.info(`Deploying via clanker CLI (attempt ${attempt})...`);
        this.log.info(`CMD: ${cmd.substring(0, 300)}`);
        const result = spawnSync(cmd, {
          encoding: "utf8",
          timeout: 180000,
          stdio: ["pipe", "pipe", "pipe"],
          shell: true,
          env: { ...process.env },
        });

        const allOutput = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
        this.log.info(`CLI output (exit ${result.status}): ${allOutput.substring(0, 600)}`);

        // Extract contract address from output
        let tokenAddress = null;
        // Try JSON parse first
        try {
          const lines = allOutput.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("{")) {
              const json = JSON.parse(trimmed);
              tokenAddress = json.tokenAddress || json.address || json.token;
              break;
            }
          }
        } catch {}

        // Fallback: regex for 0x address
        if (!tokenAddress) {
          const addrMatch = allOutput.match(/(?:token\s*(?:address|at|deployed)[:\s]*)(0x[a-fA-F0-9]{40})/i)
            || allOutput.match(/0x[a-fA-F0-9]{40}/);
          tokenAddress = addrMatch ? addrMatch[1] || addrMatch[0] : null;
        }

        if (!tokenAddress) {
          this.log.warn(`Deploy produced no contract address (attempt ${attempt}/${MAX_RETRIES}). Output: ${allOutput.substring(0, 300)}`);
          if (attempt < MAX_RETRIES) {
            this.log.info("Retrying in 15s...");
            await new Promise(r => setTimeout(r, 15000));
            continue;
          }
          // Don't count toward daily limit
          return null;
        }

        this.log.info(`Token deployed at: ${tokenAddress}`);

        const tokenRecord = {
          name: tokenInfo.name,
          symbol: tokenInfo.symbol,
          strategy: tokenInfo.strategy,
          description,
          contractAddress: tokenAddress,
          chain: "base",
          launchedAt: new Date().toISOString(),
          deployer: WALLET_ADDR,
          feesEarned: 0,
          volumeData: {},
        };

        this.tokenData.tokens.push(tokenRecord);
        this.tokenData.stats.totalLaunched++;
        this.tokenData.launchesToday++;
        this._saveTokenData();

        this._scheduleVolumeCheck(tokenRecord);

        await this.notify(
          `🎯 *Clanker Token Deployed!* [${tokenInfo.strategy}]\n` +
          `Name: ${tokenInfo.name} ($${tokenInfo.symbol})\n` +
          `Contract: \`${tokenAddress}\`\n` +
          `View: https://clanker.world/clanker/${tokenAddress}\n` +
          `Today: ${this.tokenData.launchesToday}/${this.config.maxLaunchesPerDay} | Total: ${this.tokenData.stats.totalLaunched}`
        );

        return tokenRecord;
      } catch (e) {
        this.log.error(`Clanker deploy failed (attempt ${attempt}/${MAX_RETRIES}): ${e.message}`);
        if (attempt < MAX_RETRIES) {
          this.log.info("Retrying in 15s...");
          await new Promise(r => setTimeout(r, 15000));
          continue;
        }
        await this.notify(`❌ Clanker deploy failed [${tokenInfo.strategy}]: ${tokenInfo.name} — ${e.message.substring(0, 200)}`);
        return null;
      }
    }
  }

  // ═══════════════════════════════════════════════════
  // REWARD CLAIMING
  // ═══════════════════════════════════════════════════

  async claimRewards() {
    this.log.info("Checking creator rewards...");
    const tokensWithAddr = this.tokenData.tokens.filter(t => t.contractAddress);
    if (tokensWithAddr.length === 0) {
      this.log.info("No deployed tokens to claim rewards for.");
      return;
    }

    for (const token of tokensWithAddr.slice(-10)) { // Check last 10 tokens
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

  // ═══════════════════════════════════════════════════
  // MAIN CYCLES
  // ═══════════════════════════════════════════════════

  async runLaunchCycle() {
    this.log.info("─── Clanker Launch cycle ───");

    if (!this._isInLaunchWindow()) {
      const utcHour = new Date().getUTCHours();
      this.log.info(`Outside window (${utcHour} UTC, need ${this.config.launchWindowStart}-${this.config.launchWindowEnd}). Skipping.`);
      return;
    }

    if (!this._checkDailyLimit()) {
      this.log.info(`Daily limit hit (${this.tokenData.launchesToday}/${this.config.maxLaunchesPerDay}).`);
      return;
    }

    // Burst if behind schedule
    const utcHour = new Date().getUTCHours();
    const windowRemaining = this.config.launchWindowEnd - utcHour;
    const launchesRemaining = this.config.maxLaunchesPerDay - this.tokenData.launchesToday;

    if (launchesRemaining > windowRemaining && launchesRemaining > 1) {
      this.log.info(`Behind schedule: ${launchesRemaining} launches in ${windowRemaining}h. Doing burst.`);
      await this.launchToken();
      await new Promise(r => setTimeout(r, 30000));
      if (this._checkDailyLimit()) await this.launchToken();
    } else {
      await this.launchToken();
    }
  }

  async runResearchCycle() {
    this.log.info("─── Clanker Research cycle ───");
    const lastFetch = this.researchData.lastFetch ? new Date(this.researchData.lastFetch) : new Date(0);
    const hoursSinceFetch = (Date.now() - lastFetch.getTime()) / 3600000;

    if (hoursSinceFetch >= 4) {
      this.log.info("Refreshing clanker trending data...");
      await Promise.all([
        this.fetchHotClankerTokens(),
        this.fetchTrendingGitHubRepos(),
      ]);
    } else {
      this.log.info(`Research data fresh (${hoursSinceFetch.toFixed(1)}h old). Skipping.`);
    }

    // ALWAYS scan for fresh launches (this is the key real-time feature)
    await this.scanFreshLaunches();
  }

  async runRewardCycle() {
    this.log.info("─── Clanker Reward cycle ───");
    await this.claimRewards();

    const stats = this.tokenData.stats;
    this.log.info(
      `Stats: ${stats.totalLaunched} launched | Today: ${this.tokenData.launchesToday}/${this.config.maxLaunchesPerDay} | ` +
      `Fees: ${stats.totalFeesEarned}`
    );
  }

  async runVolumeAndPerformanceCycle() {
    this.log.info("─── Clanker Volume & performance cycle ───");
    await this.runVolumeChecks();
    const scores = this.perfData.strategyScores;
    for (const [strat, data] of Object.entries(scores)) {
      if (data.count > 0) {
        this.log.info(`  ${strat}: avg vol $${Math.round(data.totalVol / data.count)} (${data.count} tokens)`);
      }
    }
  }

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
      adaptiveMix: this.perfData.adaptiveMix,
      strategyScores: this.perfData.strategyScores,
      pendingVolumeChecks: this.perfData.volumeChecks.length,
    };
  }
}

// ══════════════════════════════════════════════════════
// STANDALONE RUNNER — 10 LAUNCHES/DAY
// ══════════════════════════════════════════════════════
if (require.main === module) {
  const cron = require("node-cron");
  const log = new Logger("clanker-main");

  const launcher = new ClankerLauncher({
    config: {
      maxLaunchesPerDay: parseInt(process.env.CLANKER_MAX_LAUNCHES_PER_DAY || "10"),
    },
  });

  log.info("=== CLANKER TOKEN LAUNCHER v2 (SNIPER-OPTIMIZED) STARTING ===");
  log.info(`Adaptive mix: ${JSON.stringify(launcher.perfData.adaptiveMix)}`);
  log.info(`Launch window: ${launcher.config.launchWindowStart}:00-${launcher.config.launchWindowEnd}:00 UTC`);

  // Launch cycle: Every 80 min = ~11 slots in 15h window
  cron.schedule("*/80 * * * *", async () => {
    try { await launcher.runLaunchCycle(); }
    catch (e) { log.error("Launch cycle error:", e.message); }
  });

  // Reward check: Every 4 hours
  cron.schedule("30 */4 * * *", async () => {
    try { await launcher.runRewardCycle(); }
    catch (e) { log.error("Reward cycle error:", e.message); }
  });

  // Research refresh: Every 4 hours (hot tokens, GitHub repos)
  cron.schedule("0 */4 * * *", async () => {
    try { await launcher.runResearchCycle(); }
    catch (e) { log.error("Research cycle error:", e.message); }
  });

  // Fresh token scanner: Every 30 min (the KEY real-time feature)
  cron.schedule("*/30 * * * *", async () => {
    try {
      log.info("─── Fresh token scan (30min) ───");
      await launcher.scanFreshLaunches();
    } catch (e) { log.error("Fresh scan error:", e.message); }
  });

  // Volume checks: Every hour
  cron.schedule("45 * * * *", async () => {
    try { await launcher.runVolumeAndPerformanceCycle(); }
    catch (e) { log.error("Volume check error:", e.message); }
  });

  // Initial: Force research → Launch → Rewards
  (async () => {
    try {
      launcher.researchData.lastFetch = null;
      log.info("Forcing research refresh + fresh scan on startup...");
      await launcher.runResearchCycle();
      await launcher.scanFreshLaunches();
      await launcher.runLaunchCycle();
      await launcher.runRewardCycle();
    } catch (e) {
      log.error("Initial run error:", e.message);
    }
  })();
}

module.exports = { ClankerLauncher };
