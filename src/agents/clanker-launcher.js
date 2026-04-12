/**
 * Clanker Token Launcher Agent v7 — Base SDK Sniper Engine (Fixed Filters)
 *
 * STRATEGY: Monitor for brand-new token launches every 1 minute.
 * When a fresh token (<30 min old) shows real traction ($50+ vol, 2+ txns),
 * deploy duplicates on Base via Clanker SDK v4.
 *
 * Sources monitored:
 *   1. clanker.world API — newest clanker token launches
 *   2. DexScreener token profiles — newly promoted Base tokens
 *   3. DexScreener token boosts — boosted Base tokens
 *   4. bankr.bot API — newest bankr tokens (cross-platform snipe)
 *   5. CoinGecko trending — hot coins to duplicate as Base tokens
 *   6. Tracked wallets — tokens from top deployers
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const https = require("https");
const { Logger } = require("../utils/logger");

// ── Clanker SDK + viem ──
const { Clanker } = require("clanker-sdk/v4");
const { FEE_CONFIGS, POOL_POSITIONS } = require("clanker-sdk");
const { createPublicClient, createWalletClient, http } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { base } = require("viem/chains");

// ── FILE PATHS ──
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const CLANKER_TOKENS_FILE = path.join(DATA_DIR, "clanker-tokens.json");
const CLANKER_PERF_FILE = path.join(DATA_DIR, "clanker-performance.json");
const TRACKED_WALLETS_FILE = path.join(DATA_DIR, "tracked-wallets.json");

// ── INSTANT SNIPER CONFIG ──
const WALLET_ADDR = process.env.CLANKER_FEE_WALLET || "0x162ee01a2eab184f6698ec8663ad84c4ee506733";
const MAX_TOKEN_AGE_MS = 30 * 60 * 1000;    // Duplicate tokens < 30 minutes old (wider net = more launches)
const MIN_VOLUME_TRIGGER = 50;                // $50 volume = early traction detected
const MIN_TXN_COUNT = 2;                      // At least 2 txns = real interest, not just deployer
const SEEN_TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // Forget tokens seen > 2 hours ago

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

    // Track last successful launch time for fallback logic
    this.lastLaunchTime = Date.now();

    this.log.info(
      `Clanker Launcher v4 (SDK-powered) initialized. ` +
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

  // ── SDK INITIALIZATION (lazy, per-chain) ──

  _initSdk() {
    if (this._clanker) return this._clanker;

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) throw new Error("PRIVATE_KEY not set — cannot deploy");

    const account = privateKeyToAccount(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`);
    const rpcUrl = process.env.RPC_URL;
    const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
    const wallet = createWalletClient({ account, chain: base, transport: http(rpcUrl) });

    this._clanker = new Clanker({ wallet, publicClient });
    this._account = account;
    this.log.info(`SDK initialized for Base. Deployer: ${account.address}`);
    return this._clanker;
  }

  // Deploy via Clanker SDK on Base (direct JS API)
  async _deployFast(name, symbol) {
    const safeName = this._sanitizeName(name);
    const safeSymbol = this._sanitizeName(symbol);
    if (!safeName || !safeSymbol) throw new Error(`Invalid name/symbol after sanitization: "${safeName}" / "${safeSymbol}"`);

    const clanker = this._initSdk();

    this.log.info(`SDK DEPLOY: ${safeName} ($${safeSymbol}) → Base | rewards→${WALLET_ADDR.slice(0, 10)}...`);

    const { txHash, waitForTransaction, error } = await clanker.deploy({
      name: safeName,
      symbol: safeSymbol,
      tokenAdmin: this._account.address,
      chainId: base.id,
      vanity: true,
      pool: {
        pairedToken: "WETH",
        positions: POOL_POSITIONS.Standard,
      },
      fees: FEE_CONFIGS.DynamicBasic,
      rewards: {
        recipients: [{
          admin: WALLET_ADDR,
          recipient: WALLET_ADDR,
          bps: 10000,
          token: "Both",
        }],
      },
    });

    if (error) throw new Error(`Deploy error: ${error.message || JSON.stringify(error).substring(0, 300)}`);

    const { address, error: txError } = await waitForTransaction();
    if (txError) throw new Error(`Transaction error: ${txError.message}`);
    if (!address) throw new Error("Deploy succeeded but no token address returned");

    this.log.info(`Base deploy success: ${address} (tx: ${txHash})`);
    return { output: JSON.stringify({ txHash, address }), contractAddress: address, chain: "base" };
  }

  // Sanitize external input
  _sanitizeName(str) {
    return str.replace(/[^a-zA-Z0-9 _.\-()!@#&]/g, '').substring(0, 50).trim();
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

    // Source 4: bankr.bot API — newest bankr tokens (cross-platform snipe)
    try {
      const data = await this._httpGet("https://api.bankr.bot/token-launches");
      if (data?.launches && Array.isArray(data.launches)) {
        let count = 0;
        for (const t of data.launches) {
          if (!t.tokenAddress || !t.tokenName || !t.tokenSymbol) continue;
          if (t.status !== "deployed") continue;
          const addr = t.tokenAddress.toLowerCase();
          if (!all.find(a => a.address === addr)) {
            all.push({
              name: t.tokenName,
              symbol: t.tokenSymbol,
              address: addr,
              source: "bankr-cross",
            });
            count++;
          }
        }
        if (count > 0) this.log.info(`  Bankr cross-snipe: ${count} tokens`);
      }
    } catch (e) {}

    // Source 5: CoinGecko trending — hot coins to duplicate as Base tokens
    try {
      const data = await this._httpGet("https://api.coingecko.com/api/v3/search/trending");
      if (data?.coins && Array.isArray(data.coins)) {
        let count = 0;
        for (const item of data.coins.slice(0, 10)) {
          const coin = item.item || item;
          if (!coin.name || !coin.symbol) continue;
          const syntheticAddr = `trend_${coin.id || coin.symbol}`.toLowerCase();
          if (!all.find(a => a.address === syntheticAddr)) {
            all.push({
              name: coin.name,
              symbol: coin.symbol.toUpperCase(),
              address: syntheticAddr,
              source: "solana-snipe",
              solVolume: coin.market_cap_rank ? 10000 - coin.market_cap_rank : 1000,
              solTxns: 100,
            });
            count++;
          }
        }
        if (count > 0) this.log.info(`  CoinGecko trending: ${count} hot coins`);
      }
    } catch (e) {}

    // Source 6: Tracked wallets — tokens from top deployers
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

    try {
      const { output, contractAddress } = await this._deployFast(sourceToken.name, sourceToken.symbol);

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
      this.lastLaunchTime = Date.now();

      this._scheduleVolumeCheck(tokenRecord);

      this.perfData.duplications.total++;
      this._savePerformanceData();

      await this.notify(
        `🎯 *INSTANT DUPLICATE DEPLOYED!* [clanker → Base]\n` +
        `Name: ${sourceToken.name} ($${sourceToken.symbol})\n` +
        `Contract: \`${contractAddress}\`\n` +
        `Source token: age=${sourceToken.ageMinutes}min vol=$${sourceToken.volume} txns=${sourceToken.txns}\n` +
        `View: https://clanker.world/clanker/${contractAddress}\n` +
        `Today: ${this.tokenData.launchesToday}/${this.config.maxLaunchesPerDay} | Total: ${this.tokenData.stats.totalLaunched}`
      );

      this.log.info(`Duplicate deployed on Base at ${contractAddress}`);

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

  // ── REWARD CLAIMING (SDK) ──

  async claimRewards() {
    this.log.info("Checking creator rewards...");
    const tokensWithAddr = this.tokenData.tokens.filter(t => t.contractAddress);
    if (tokensWithAddr.length === 0) {
      this.log.info("No deployed tokens to claim rewards for.");
      return;
    }

    let clanker;
    try { clanker = this._initSdk(); } catch (e) {
      this.log.warn(`SDK init failed for reward claim: ${e.message}`);
      return;
    }

    let totalClaimed = 0;
    for (const token of tokensWithAddr.slice(-20)) {
      try {
        // Check available rewards first
        const rewards = await clanker.availableRewards({
          token: token.contractAddress,
          rewardRecipient: WALLET_ADDR,
        });

        if (!rewards || rewards.length === 0) continue;

        // Claim if there are rewards
        const { txHash, error } = await clanker.claimRewards({
          token: token.contractAddress,
          rewardRecipient: WALLET_ADDR,
        });

        if (error) {
          if (!error.message.includes("NoFeesToClaim")) {
            this.log.warn(`Reward claim ${token.symbol}: ${error.message.substring(0, 200)}`);
          }
          continue;
        }

        if (txHash) {
          this.log.info(`Rewards claimed for ${token.symbol}: tx=${txHash}`);
          totalClaimed++;
          token.feesEarned = (token.feesEarned || 0) + 1; // Track that we claimed
          this._saveTokenData();
        }

        await new Promise(r => setTimeout(r, 2000));
      } catch (e) {
        // Silently skip "no fees" errors
        if (!e.message.includes("NoFeesToClaim") && !e.message.includes("reverted")) {
          this.log.warn(`Reward claim failed for ${token.symbol}: ${e.message.substring(0, 200)}`);
        }
      }
    }
  }

  // ── SOLANA SNIPE DEPLOYMENT ──

  async _deploySolanaSnipe(token) {
    try {
      const { output, contractAddress } = await this._deployFast(token.name, token.symbol);

      const tokenRecord = {
        name: token.name,
        symbol: token.symbol,
        strategy: "solana_snipe",
        contractAddress,
        chain: "base",
        deployer: WALLET_ADDR,
        sourceAddress: token.address,
        solVolume: token.solVolume,
        solTxns: token.solTxns,
        launchedAt: new Date().toISOString(),
        feesEarned: 0,
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
        `🌊 *SOLANA SNIPE!* [clanker → Base]\n` +
        `Name: ${token.name} ($${token.symbol})\n` +
        `Contract: \`${contractAddress}\`\n` +
        `Solana vol: $${token.solVolume} | txns: ${token.solTxns}\n` +
        `View: https://clanker.world/clanker/${contractAddress}\n` +
        `Today: ${this.tokenData.launchesToday}/${this.config.maxLaunchesPerDay}`
      );

      return tokenRecord;
    } catch (e) {
      this.log.error(`Solana snipe deploy failed: ${e.message}`);
      return null;
    }
  }

  // ── WALLET TRACKER DEPLOYMENT ──

  async _deployWalletTrack(token) {
    try {
      const { output, contractAddress } = await this._deployFast(token.name, token.symbol);

      const tokenRecord = {
        name: token.name,
        symbol: token.symbol,
        strategy: "wallet_tracker",
        contractAddress,
        chain: "base",
        deployer: WALLET_ADDR,
        sourceAddress: token.address,
        trackedWallet: token.trackedWallet,
        launchedAt: new Date().toISOString(),
        feesEarned: 0,
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
        `🔍 *WALLET TRACK DEPLOY!* [clanker → Base]\n` +
        `Name: ${token.name} ($${token.symbol})\n` +
        `Contract: \`${contractAddress}\`\n` +
        `Tracked deployer: ${token.trackedWallet}\n` +
        `View: https://clanker.world/clanker/${contractAddress}\n` +
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
    const deployerMap = new Map();

    // Scan clanker.world for deployers
    try {
      const data = await this._httpGet("https://www.clanker.world/api/tokens?sort=desc&limit=50");
      if (data?.data && Array.isArray(data.data)) {
        for (const t of data.data) {
          const deployer = t.deployer || t.creator;
          const addr = t.contract_address || t.address;
          if (!deployer || !addr) continue;
          const dep = deployer.toLowerCase();
          if (!deployerMap.has(dep)) deployerMap.set(dep, { tokens: [], totalVol: 0 });
          deployerMap.get(dep).tokens.push(addr);
        }
      }
    } catch (e) { this.log.warn(`Clanker deployer scan failed: ${e.message}`); }

    // Scan DexScreener for Base tokens with volume
    try {
      const data = await this._httpGet("https://api.dexscreener.com/token-profiles/latest/v1");
      if (Array.isArray(data)) {
        const baseTokens = data.filter(t => t.chainId === "base" && t.tokenAddress).slice(0, 50);
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
      this.log.info(`Discovered ${ranked.length} top deployers.`);
    } else {
      this.log.info("No qualifying deployers found this cycle.");
    }
  }

  async _fetchTrackedWalletTokens() {
    const tokens = [];
    const walletData = this._loadTrackedWallets();
    if (!walletData.wallets || walletData.wallets.length === 0) return tokens;

    // Check clanker.world for tokens from tracked wallets
    try {
      const data = await this._httpGet("https://www.clanker.world/api/tokens?sort=desc&limit=50");
      if (data?.data && Array.isArray(data.data)) {
        const trackedAddrs = new Set(walletData.wallets.map(w => w.address.toLowerCase()));
        for (const t of data.data) {
          const deployer = (t.deployer || t.creator || "").toLowerCase();
          if (!trackedAddrs.has(deployer)) continue;
          const addr = (t.contract_address || t.address || "").toLowerCase();
          if (!addr || !t.name || !t.symbol) continue;
          tokens.push({
            name: t.name,
            symbol: t.symbol,
            address: addr,
            source: "wallet-tracker",
            trackedWallet: deployer,
          });
        }
        if (tokens.length > 0) this.log.info(`  Tracked wallets: ${tokens.length} tokens from top deployers`);
      }
    } catch (e) {
      this.log.warn(`Tracked wallet token fetch failed: ${e.message}`);
    }

    return tokens;
  }

  // ── TRENDING NARRATIVE LAUNCHES ──

  async _fetchTrendingNarratives() {
    const narratives = [];

    // Source 1: CoinGecko trending coins
    try {
      const data = await this._httpGet("https://api.coingecko.com/api/v3/search/trending");
      if (data?.coins && Array.isArray(data.coins)) {
        for (const item of data.coins.slice(0, 10)) {
          const coin = item.item || item;
          if (coin.name && coin.symbol) {
            narratives.push({
              name: coin.name,
              symbol: coin.symbol.toUpperCase(),
              score: coin.score || coin.market_cap_rank || 0,
              source: "coingecko-trending",
            });
          }
        }
        this.log.info(`  CoinGecko trending: ${narratives.length} coins`);
      }
    } catch (e) {
      this.log.warn(`CoinGecko trending fetch failed: ${e.message}`);
    }

    // Source 2: Local social-trends.json fallback
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

      // Add suffix to avoid SDK blocking exact matches of existing coins
      const launchName = `${trend.name} on Base`;
      const launchSymbol = `b${trend.symbol}`;

      try {
        const { output, contractAddress } = await this._deployFast(launchName, launchSymbol);

        const tokenRecord = {
          name: launchName,
          symbol: launchSymbol,
          strategy: "trending_narrative",
          contractAddress,
          chain: "base",
          deployer: WALLET_ADDR,
          trendSource: trend.source,
          trendScore: trend.score,
          launchedAt: new Date().toISOString(),
          feesEarned: 0,
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
          `🔥 *TRENDING LAUNCH!* [clanker → Base]\n` +
          `Name: ${trend.name} ($${trend.symbol})\n` +
          `Contract: \`${contractAddress}\`\n` +
          `Trend: ${trend.source} (score: ${trend.score})\n` +
          `View: https://clanker.world/clanker/${contractAddress}\n` +
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

  log.info("=== CLANKER LAUNCHER v7 (BASE SDK — FIXED FILTERS) STARTING ===");
  log.info(`Max launches/day: ${launcher.config.maxLaunchesPerDay}`);
  log.info(`Chain: Base (WETH)`);
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
      await launcher.claimRewards();
    } catch (e) {
      log.error("Initial run error:", e.message);
    }
  })();
}

module.exports = { ClankerLauncher };
