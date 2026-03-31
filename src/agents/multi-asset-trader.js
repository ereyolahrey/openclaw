/**
 * Multi-Asset Prediction Market Trader
 *
 * Extends the V2 microstructure strategy from btc-trader to handle:
 * - ETH 15min markets
 * - BTC/ETH hourly markets
 * - FX hourly markets (GBPUSD, EURGBP, EURUSD, USDNGN)
 *
 * Each asset uses the same scoring engine but with appropriate data sources.
 * Currency: NGN (Nigerian Naira)
 */
require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { EMA, RSI } = require("technicalindicators");
const https = require("https");
const { BayseClient } = require("../utils/bayse-client");
const { Logger } = require("../utils/logger");

const httpClient = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  timeout: 30000,
});

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const JOURNAL_FILE = path.join(DATA_DIR, "multi-asset-journal.json");

// CoinGecko IDs for crypto assets
const COINGECKO_IDS = {
  BTCUSDT: { id: "bitcoin", vs: "usd" },
  ETHUSD:  { id: "ethereum", vs: "usd" },
};

// FX pair data sources — using free exchangerate.host API
const FX_PAIRS = {
  GBPUSD: { base: "GBP", quote: "USD" },
  EURGBP: { base: "EUR", quote: "GBP" },
  EURUSD: { base: "EUR", quote: "USD" },
  USDNGN: { base: "USD", quote: "NGN" },
};

// Timing windows per countdown type (minutes before close)
const TIMING_WINDOWS = {
  FIFTEEN_MINUTES: { earliest: 11, latest: 4 },
  HOURLY:          { earliest: 45, latest: 10 },
};

class MultiAssetTrader {
  constructor({ notifiers = [], config = {} }) {
    this.notifiers = notifiers;
    this.config = {
      maxPositionSize: config.maxPositionSize || 500,
      ...config,
    };
    this.bayse = new BayseClient();
    this.log = new Logger("multi-trader");
    this.tradedEventIds = new Set();
    this.analyzedEventIds = new Set();
    this.priceCache = new Map(); // pair => { price, candles, fetchedAt }

    this._ensureDataDir();
    this.journal = this._loadJournal();

    // Rebuild tradedEventIds from journal
    for (const t of this.journal.trades) {
      if (t.eventId) this.tradedEventIds.add(t.eventId);
    }

    this._startOutcomeChecker();
    this.log.info("Multi-Asset Trader initialized.");
  }

  _ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  _loadJournal() {
    try {
      if (fs.existsSync(JOURNAL_FILE)) return JSON.parse(fs.readFileSync(JOURNAL_FILE, "utf8"));
    } catch {}
    return { trades: [], stats: { wins: 0, losses: 0, totalPnl: 0 } };
  }

  _saveJournal() {
    try { fs.writeFileSync(JOURNAL_FILE, JSON.stringify(this.journal, null, 2)); } catch (e) {
      this.log.error(`Journal save failed: ${e.message}`);
    }
  }

  /* ── Price Data Sources ──────────────────────────────── */

  async fetchCryptoPrice(pair) {
    const geckoId = COINGECKO_IDS[pair];
    if (!geckoId) throw new Error(`Unknown crypto pair: ${pair}`);

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const [priceRes, ohlcRes] = await Promise.all([
          httpClient.get("https://api.coingecko.com/api/v3/simple/price", {
            params: {
              ids: geckoId.id,
              vs_currencies: geckoId.vs,
              include_24hr_vol: true,
              include_24hr_change: true,
            },
          }),
          httpClient.get(`https://api.coingecko.com/api/v3/coins/${geckoId.id}/ohlc`, {
            params: { vs_currency: geckoId.vs, days: "1" },
          }),
        ]);

        const d = priceRes.data[geckoId.id];
        const candles = ohlcRes.data.map(c => ({
          time: c[0], open: c[1], high: c[2], low: c[3], close: c[4] || c[3], volume: 0,
        }));

        return {
          price: d[geckoId.vs],
          change24h: d[`${geckoId.vs}_24h_change`],
          candles,
        };
      } catch (e) {
        if (attempt === 3) throw e;
        this.log.warn(`Crypto price fetch attempt ${attempt} failed for ${pair}: ${e.message}`);
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
  }

  async fetchFXPrice(pair) {
    const fx = FX_PAIRS[pair];
    if (!fx) throw new Error(`Unknown FX pair: ${pair}`);

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // Use exchangerate.host for free FX data
        const res = await httpClient.get(`https://api.exchangerate.host/latest`, {
          params: { base: fx.base, symbols: fx.quote },
        });

        let rate;
        if (res.data && res.data.rates && res.data.rates[fx.quote]) {
          rate = res.data.rates[fx.quote];
        } else {
          // Fallback: try frankfurter.app
          const fallback = await httpClient.get(`https://api.frankfurter.app/latest`, {
            params: { from: fx.base, to: fx.quote },
          });
          rate = fallback.data.rates[fx.quote];
        }

        // For FX, generate synthetic candles from current price (since free APIs don't have OHLC)
        const candles = this._generateSyntheticCandles(rate, pair);

        return {
          price: rate,
          change24h: 0,
          candles,
        };
      } catch (e) {
        if (attempt === 3) throw e;
        this.log.warn(`FX price fetch attempt ${attempt} failed for ${pair}: ${e.message}`);
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
  }

  _generateSyntheticCandles(currentPrice, pair) {
    // For FX, we track prices over time in a local cache to build candles
    const cacheKey = `candles_${pair}`;
    if (!this._candleHistory) this._candleHistory = {};
    if (!this._candleHistory[cacheKey]) this._candleHistory[cacheKey] = [];

    const now = Date.now();
    this._candleHistory[cacheKey].push({ time: now, price: currentPrice });

    // Keep last 24 hours only
    const cutoff = now - 24 * 60 * 60 * 1000;
    this._candleHistory[cacheKey] = this._candleHistory[cacheKey].filter(p => p.time > cutoff);

    // Generate candles from stored price points
    const points = this._candleHistory[cacheKey];
    if (points.length < 2) {
      // Not enough data, create flat candles
      return Array.from({ length: 20 }, (_, i) => ({
        time: now - (20 - i) * 15 * 60000,
        open: currentPrice,
        high: currentPrice * 1.001,
        low: currentPrice * 0.999,
        close: currentPrice,
        volume: 0,
      }));
    }

    // Bucket into 15-min intervals
    const buckets = new Map();
    for (const p of points) {
      const bucket = Math.floor(p.time / (15 * 60000)) * (15 * 60000);
      if (!buckets.has(bucket)) {
        buckets.set(bucket, { time: bucket, prices: [] });
      }
      buckets.get(bucket).prices.push(p.price);
    }

    return Array.from(buckets.values())
      .sort((a, b) => a.time - b.time)
      .map(b => ({
        time: b.time,
        open: b.prices[0],
        high: Math.max(...b.prices),
        low: Math.min(...b.prices),
        close: b.prices[b.prices.length - 1],
        volume: 0,
      }));
  }

  async fetchPriceData(pair) {
    if (COINGECKO_IDS[pair]) {
      return this.fetchCryptoPrice(pair);
    } else if (FX_PAIRS[pair]) {
      return this.fetchFXPrice(pair);
    }
    throw new Error(`Unsupported pair: ${pair}`);
  }

  /* ── Regime Detection ────────────────────────────────── */
  detectRegime(candles, change24h) {
    const closes = candles.map(c => c.close);
    const recent = closes.slice(-12);
    if (recent.length < 2) return { regime: "unknown", volatility: 0, trend: 0 };

    const changes = [];
    for (let i = 1; i < recent.length; i++) {
      changes.push((recent[i] - recent[i - 1]) / recent[i - 1] * 100);
    }
    const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
    const variance = changes.reduce((a, c) => a + (c - mean) ** 2, 0) / changes.length;
    const volatility = Math.sqrt(variance);

    const n = recent.length;
    const xMean = (n - 1) / 2;
    const yMean = recent.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (recent[i] - yMean);
      den += (i - xMean) ** 2;
    }
    const slope = den ? num / den : 0;
    const trendStrength = (slope / yMean) * 100;

    let regime;
    if (volatility > 0.5) regime = "volatile";
    else if (Math.abs(trendStrength) > 0.05) regime = trendStrength > 0 ? "trending_up" : "trending_down";
    else regime = "ranging";

    return { regime, volatility, trend: trendStrength, change24h: change24h || 0 };
  }

  /* ── V2 Microstructure Analysis ──────────────────────── */
  analyse(candles, threshold, currentPrice, market, regimeInfo) {
    const closes = candles.map(c => c.close);
    const gap = currentPrice - threshold;
    const gapPct = (gap / threshold) * 100;
    const aboveThreshold = gap > 0;

    const recentCandles = candles.slice(-6);
    const ranges = recentCandles.map(c => Math.abs(c.high - c.low));
    const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
    const typicalMovePct = (avgRange / currentPrice) * 100;
    const gapStrength = typicalMovePct > 0 ? Math.abs(gapPct) / typicalMovePct : 0;

    const last5 = closes.slice(-5);
    let upCandles = 0, downCandles = 0;
    for (let i = 1; i < last5.length; i++) {
      if (last5[i] > last5[i - 1]) upCandles++;
      else if (last5[i] < last5[i - 1]) downCandles++;
    }
    const momentumDirection = upCandles > downCandles ? "UP" : downCandles > upCandles ? "DOWN" : "NEUTRAL";
    const momentumStrength = Math.abs(upCandles - downCandles) / Math.max(last5.length - 1, 1);

    const lastMove = closes.length >= 2 ? closes[closes.length - 1] - closes[closes.length - 2] : 0;
    const prevMove = closes.length >= 3 ? closes[closes.length - 2] - closes[closes.length - 3] : 0;
    const accelerating = Math.sign(lastMove) === Math.sign(prevMove) && Math.abs(lastMove) > Math.abs(prevMove);
    const decelerating = Math.sign(lastMove) !== Math.sign(prevMove);
    const movingAwayFromThreshold = (aboveThreshold && lastMove > 0) || (!aboveThreshold && lastMove < 0);

    const last3Range = closes.length >= 3
      ? Math.abs(closes[closes.length - 1] - closes[closes.length - 3]) / currentPrice * 100
      : 0;
    const spikeDetected = last3Range > typicalMovePct * 2;

    const upPrice = parseFloat(market.outcome1Price) || 0.5;
    const downPrice = parseFloat(market.outcome2Price) || 0.5;
    const marketDirection = upPrice > downPrice ? "UP" : "DOWN";
    const marketConviction = Math.abs(upPrice - downPrice);

    let score = 0;
    let maxPossibleScore = 0;
    const signals = {};

    // S1. Price position (weight: 3)
    const positionScore = aboveThreshold ? 1 : -1;
    score += positionScore * 3.0;
    maxPossibleScore += 3.0;
    signals.position = aboveThreshold ? "UP" : "DOWN";

    // S2. Gap strength (weight: 2.5)
    const gapScore = Math.min(gapStrength, 3) / 3 * (aboveThreshold ? 1 : -1);
    score += gapScore * 2.5;
    maxPossibleScore += 2.5;
    signals.gapStrength = gapStrength.toFixed(2) + "x (" + (aboveThreshold ? "UP" : "DOWN") + ")";

    // S3. Momentum alignment (weight: 2)
    const momScore = momentumDirection === "UP" ? momentumStrength : momentumDirection === "DOWN" ? -momentumStrength : 0;
    score += momScore * 2.0;
    maxPossibleScore += 2.0;
    signals.momentum = momentumDirection + " (" + (momentumStrength * 100).toFixed(0) + "%)";

    // S4. Acceleration (weight: 1.5)
    let accelScore = 0;
    if (movingAwayFromThreshold && accelerating) accelScore = aboveThreshold ? 0.8 : -0.8;
    else if (movingAwayFromThreshold) accelScore = aboveThreshold ? 0.3 : -0.3;
    else if (decelerating) accelScore = aboveThreshold ? -0.3 : 0.3;
    score += accelScore * 1.5;
    maxPossibleScore += 1.5;
    signals.acceleration = accelerating ? "accelerating" : decelerating ? "decelerating" : "steady";

    // S5. Mean reversion penalty (weight: 1.5)
    let reversionPenalty = 0;
    if (spikeDetected) {
      reversionPenalty = -Math.sign(score) * 0.5;
      signals.reversion = "SPIKE DETECTED";
    } else {
      signals.reversion = "none";
    }
    score += reversionPenalty * 1.5;
    maxPossibleScore += 1.5;

    // S6. Market agreement (weight: 2)
    const marketDir = marketDirection === "UP" ? 1 : -1;
    const marketScore = marketDir * Math.min(marketConviction * 2, 1);
    score += marketScore * 2.0;
    maxPossibleScore += 2.0;
    signals.market = marketDirection + " (conviction: " + (marketConviction * 100).toFixed(0) + "%)";

    // S7. RSI context (weight: 0.5)
    const rsi = RSI.calculate({ period: 14, values: closes });
    const latestRsi = rsi[rsi.length - 1];
    let ltScore = 0;
    if (latestRsi > 60) ltScore = 0.3;
    else if (latestRsi < 40) ltScore = -0.3;
    score += ltScore * 0.5;
    maxPossibleScore += 0.5;
    signals.rsi = latestRsi ? latestRsi.toFixed(1) : "N/A";

    const direction = score > 0 ? "UP" : score < 0 ? "DOWN" : "HOLD";
    const confidence = maxPossibleScore > 0 ? Math.abs(score) / maxPossibleScore : 0;
    const bullScore = score > 0 ? Math.abs(score) : 0;
    const bearScore = score < 0 ? Math.abs(score) : 0;

    const agreesWithMarket = direction === marketDirection;
    signals.agreesWithMarket = agreesWithMarket ? "YES" : "NO";

    const latest = {
      price: currentPrice, threshold, diff: gap,
      diffPct: gapPct.toFixed(4),
      gapStrength, typicalMovePct, spikeDetected,
    };

    return { signal: direction, confidence, bullScore, bearScore, latest, signals, regime: regimeInfo, agreesWithMarket };
  }

  /* ── Outcome checker ─────────────────────────────────── */
  _startOutcomeChecker() {
    this._outcomeInterval = setInterval(() => this._checkOutcomes().catch(e =>
      this.log.error(`Outcome check error: ${e.message}`)
    ), 120000);
    setTimeout(() => this._checkOutcomes().catch(() => {}), 30000);
  }

  async _checkOutcomes() {
    const unresolved = this.journal.trades.filter(t => !t.outcome);
    if (unresolved.length === 0) return;

    let activities;
    try {
      const resp = await this.bayse.getActivities({ limit: 100 });
      activities = resp.activities || resp.data || resp;
      if (!Array.isArray(activities)) return;
    } catch { return; }

    let updated = false;
    for (const trade of unresolved) {
      const payout = activities.find(a =>
        (a.type === "PAYOUT_WIN" || a.type === "PAYOUT_LOSS") &&
        a.eventId === trade.eventId &&
        a.outcomeId === trade.outcomeId
      );
      if (!payout) continue;

      const won = payout.type === "PAYOUT_WIN";
      trade.outcome = won ? "WIN" : "LOSS";
      trade.payout = payout.payout || 0;
      trade.resolvedAt = payout.createdAt;

      if (won) {
        this.journal.stats.wins++;
        this.journal.stats.totalPnl += (trade.payout - trade.amount);
      } else {
        this.journal.stats.losses++;
        this.journal.stats.totalPnl -= trade.amount;
      }

      this.log.info(`📝 ${trade.pair} ${trade.countdownType}: ${won ? "WIN ✅" : "LOSS ❌"} | ${trade.direction} @ ${trade.price} vs ${trade.threshold} | Payout: ₦${trade.payout}`);
      updated = true;

      const stats = this.journal.stats;
      const winRate = stats.wins + stats.losses > 0
        ? ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1)
        : "N/A";
      await this.notify(
        `${won ? "✅ WIN" : "❌ LOSS"} | ${trade.pair} ${trade.countdownType}\n` +
        `${trade.direction} @ ${trade.price} vs ${trade.threshold}\n` +
        `Payout: ₦${trade.payout} | Stake: ₦${trade.amount}\n` +
        `Record: ${stats.wins}W/${stats.losses}L (${winRate}%) | PnL: ₦${stats.totalPnl.toFixed(0)}`
      );
    }

    if (updated) this._saveJournal();
  }

  /* ── Trade a single event ────────────────────────────── */
  async tradeEvent(event) {
    const pair = event.assetSymbolPair;
    const countdownType = event.countdownType;

    if (this.tradedEventIds.has(event.id) || this.analyzedEventIds.has(event.id)) return;

    // Check timing
    const now = Date.now();
    const closeTime = new Date(event.closingDate).getTime();
    const minsLeft = (closeTime - now) / 60000;
    const window = TIMING_WINDOWS[countdownType] || TIMING_WINDOWS.FIFTEEN_MINUTES;

    if (minsLeft > window.earliest || minsLeft < window.latest) {
      if (minsLeft > window.earliest) {
        this.log.debug(`[${pair}/${countdownType}] Waiting… ${minsLeft.toFixed(1)} min left`);
      }
      return;
    }

    this.log.info(`─── ${pair} ${countdownType} cycle (${minsLeft.toFixed(1)} min to close) ───`);

    const market = event.markets[0];
    if (!market) {
      this.log.warn(`[${pair}] No market on event ${event.id}`);
      this.analyzedEventIds.add(event.id);
      return;
    }

    const threshold = parseFloat(market.marketThreshold);
    const upOutcomeId = market.outcome1Id;
    const downOutcomeId = market.outcome2Id;

    this.log.info(`Event: ${event.title} | Threshold: ${threshold} | Closes: ${event.closingDate}`);
    this.log.info(`Market: Up=${market.outcome1Price} Down=${market.outcome2Price}`);

    // Fetch price data
    let priceData;
    try {
      priceData = await this.fetchPriceData(pair);
    } catch (e) {
      this.log.error(`[${pair}] Price fetch failed: ${e.message}`);
      return;
    }

    const currentPrice = priceData.price;
    const candles = priceData.candles;
    const regimeInfo = this.detectRegime(candles, priceData.change24h);

    this.log.info(`[${pair}] Price: ${currentPrice} | Regime: ${regimeInfo.regime} | Vol: ${regimeInfo.volatility.toFixed(3)}`);

    // Analyse
    const analysis = this.analyse(candles, threshold, currentPrice, market, regimeInfo);

    this.log.info(`[${pair}] Signal: ${analysis.signal} | Confidence: ${(analysis.confidence * 100).toFixed(0)}%`);
    this.log.info(`[${pair}] Gap: ${analysis.latest.gapStrength?.toFixed(2)}x | Momentum: ${analysis.signals.momentum} | Market: ${analysis.signals.market}`);

    // Determine direction
    let direction = analysis.signal;

    // Minimum confidence
    if (analysis.confidence < 0.30) {
      this.log.info(`[${pair}] Low confidence (${(analysis.confidence * 100).toFixed(0)}%) — skipping.`);
      direction = "HOLD";
    }

    // Must agree with market
    if (direction !== "HOLD" && !analysis.agreesWithMarket) {
      this.log.info(`[${pair}] Disagrees with market — skipping.`);
      direction = "HOLD";
    }

    // Spike guard
    if (direction !== "HOLD" && analysis.latest.spikeDetected) {
      this.log.info(`[${pair}] Spike detected — skipping.`);
      direction = "HOLD";
    }

    if (direction === "HOLD") {
      this.analyzedEventIds.add(event.id);
      return;
    }

    // Share price filter
    const outcomeId = direction === "UP" ? upOutcomeId : downOutcomeId;
    const outcomeName = direction === "UP" ? "Up" : "Down";
    const sharePrice = direction === "UP"
      ? parseFloat(market.outcome1Price)
      : parseFloat(market.outcome2Price);

    if (sharePrice > 0.65) {
      this.log.info(`[${pair}] Share price ${sharePrice.toFixed(2)} > 0.65 — poor value, skipping.`);
      this.analyzedEventIds.add(event.id);
      return;
    }

    // Gap strength filter
    if (analysis.latest.gapStrength < 0.3) {
      this.log.info(`[${pair}] Gap strength ${analysis.latest.gapStrength.toFixed(2)}x < 0.3 — too close, skipping.`);
      this.analyzedEventIds.add(event.id);
      return;
    }

    // Place order
    const amount = this.config.maxPositionSize;
    this.log.info(`[${pair}] BUY ${outcomeName} | ₦${amount.toFixed(2)} @ ${(sharePrice * 100).toFixed(0)}c`);

    try {
      const orderResult = await this.bayse.placeOrder(event.id, market.id, outcomeId, amount);
      this.log.info(`[${pair}] Order placed: ${JSON.stringify(orderResult)}`);
      this.tradedEventIds.add(event.id);

      const tradeRecord = {
        time: new Date().toISOString(),
        pair, countdownType,
        direction, amount, outcomeId, outcomeName,
        eventId: event.id, marketId: market.id,
        threshold, price: currentPrice,
        diffPct: analysis.latest.diffPct,
        sharePrice, minsBeforeClose: minsLeft.toFixed(1),
        regime: regimeInfo.regime,
        confidence: analysis.confidence,
        signals: analysis.signals,
        outcome: null, payout: null,
      };
      this.journal.trades.push(tradeRecord);
      this._saveJournal();

      await this.notify(
        `🎯 *${pair} ${countdownType} Trade*\n` +
        `BUY ${outcomeName} | ₦${amount} @ ${(sharePrice * 100).toFixed(0)}c\n` +
        `Price: ${currentPrice} vs Threshold: ${threshold} (${analysis.latest.diffPct}%)\n` +
        `Confidence: ${(analysis.confidence * 100).toFixed(0)}% | Gap: ${analysis.latest.gapStrength.toFixed(2)}x\n` +
        `Record: ${this.journal.stats.wins}W/${this.journal.stats.losses}L`
      );
    } catch (err) {
      this.log.error(`[${pair}] Order failed: ${err.response?.data ? JSON.stringify(err.response.data) : err.message}`);
      this.analyzedEventIds.add(event.id);
    }
  }

  /* ── Main cycle — scan all tradable events ───────────── */
  async runCycle() {
    try {
      const events = await this.bayse.getAllTradableEvents();

      // Filter out BTC 15min events — those are handled by btc-trader
      const myEvents = events.filter(e =>
        !(e.assetSymbolPair === "BTCUSDT" && e.countdownType === "FIFTEEN_MINUTES")
      );

      if (myEvents.length === 0) {
        this.log.debug("No tradable events found (excluding BTC 15min).");
        return;
      }

      this.log.debug(`Found ${myEvents.length} tradable events to evaluate.`);

      // Process each event (sequentially to respect API rate limits)
      for (const event of myEvents) {
        try {
          await this.tradeEvent(event);
        } catch (e) {
          this.log.error(`Error trading ${event.assetSymbolPair}: ${e.message}`);
        }
        // Small delay between events to avoid hammering APIs
        await new Promise(r => setTimeout(r, 1000));
      }
    } catch (e) {
      this.log.error(`Cycle error: ${e.message}`);
    }
  }

  async notify(message) {
    for (const n of this.notifiers) {
      try { await n.broadcast(message); } catch (e) { this.log.error(`Notify error: ${e.message}`); }
    }
  }

  getStats() {
    return {
      ...this.journal.stats,
      totalTrades: this.journal.trades.length,
      recentTrades: this.journal.trades.slice(-10),
    };
  }

  destroy() {
    if (this._outcomeInterval) clearInterval(this._outcomeInterval);
  }
}

// ── Standalone runner ──
if (require.main === module) {
  const cron = require("node-cron");
  const log = new Logger("multi-trader-main");

  const trader = new MultiAssetTrader({
    config: {
      maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE || "500"),
    },
  });

  log.info("=== MULTI-ASSET TRADER STARTING ===");
  log.info("Assets: ETH 15min, BTC/ETH hourly, FX hourly (GBPUSD, EURGBP, EURUSD, USDNGN)");

  // Poll every minute — the trader checks timing windows internally
  cron.schedule("* * * * *", async () => {
    try { await trader.runCycle(); }
    catch (e) { log.error("Cycle error:", e.message); }
  });

  // Initial run
  trader.runCycle().catch(e => log.error("Initial cycle error:", e.message));
}

module.exports = { MultiAssetTrader };
