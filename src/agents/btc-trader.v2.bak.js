/**
 * BTC 15-Minute Prediction Market Trader — V2 Pro Strategy
 *
 * KEY INSIGHT: Traditional TA (EMA, RSI, MACD on hourly candles) is useless for
 * 15-minute binary predictions. Those indicators predict hours/days, not minutes.
 * 
 * NEW APPROACH — Microstructure-based:
 * 1. Price-vs-threshold momentum (is price accelerating away or reverting?)
 * 2. Volatility-adjusted gap scoring (is the gap meaningful relative to recent moves?)
 * 3. Multi-candle directional consistency (are last N candles all going one way?)
 * 4. Bayse market agreement (don't fight the crowd — require alignment)
 * 5. Value filter (only trade when shares offer +EV after fees)
 * 6. Mean-reversion detection (avoid traps where price just spiked)
 *
 * Currency: NGN (Nigerian Naira)
 */
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { EMA, RSI } = require("technicalindicators");
const https = require("https");
const { BayseClient } = require("../utils/bayse-client");
const { Logger } = require("../utils/logger");

// Shared axios instance that tolerates unstable SSL connections
const httpClient = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  timeout: 30000,
});

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const JOURNAL_FILE = path.join(DATA_DIR, "trade-journal.json");
const WEIGHTS_FILE = path.join(DATA_DIR, "indicator-weights.json");

// Default indicator weights — these evolve as the bot learns
const DEFAULT_WEIGHTS = {
  priceVsThreshold: 3.0,   // most critical: is price above/below the threshold?
  emaAlignment:     1.0,    // EMA9 vs EMA21
  emaTrend:         1.0,    // EMA21 vs EMA50
  rsi:              1.0,
  macd:             1.0,
  bollinger:        1.0,
  stochastic:       1.0,
  marketSentiment:  1.5,    // Bayse crowd probability
  momentum1h:       1.0,    // 1-hour price momentum
  gapSize:          1.5,    // how far price is from threshold (bigger gap = stronger signal)
};

class BTCTraderAgent {
  constructor({ bridge, notifiers = [], config = {} }) {
    this.bridge = bridge;
    this.notifiers = notifiers;
    this.config = {
      asset: config.asset || "BTC",
      interval: config.interval || "15m",
      maxPositionSize: config.maxPositionSize || 500,   // NGN
      riskPercent: config.riskPercent || 2,
    };
    this.bayse = new BayseClient();
    this.log = new Logger("btc-trader");
    this.tradeHistory = [];
    this.tradedEventIds = new Set(); // track events we already bet on
    this.analyzedEventIds = new Set(); // track events we already analyzed (including HOLD)
    this.cachedCandles = null;
    this.cachedCandlesEventId = null;

    // Persistent learning state
    this._ensureDataDir();
    this.journal = this._loadJournal();
    this.weights = this._loadWeights();
    this.pendingOutcomes = new Map(); // eventId → trade record awaiting resolution

    // Rebuild tradedEventIds from journal so restarts don't re-trade
    for (const t of this.journal.trades) {
      if (t.eventId) this.tradedEventIds.add(t.eventId);
    }

    // Kick off the outcome-checking loop (every 2 minutes)
    this._startOutcomeChecker();
  }

  /* ── Persistent storage ──────────────────────────────── */
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

  _loadWeights() {
    try {
      if (fs.existsSync(WEIGHTS_FILE)) return JSON.parse(fs.readFileSync(WEIGHTS_FILE, "utf8"));
    } catch {}
    return { ...DEFAULT_WEIGHTS };
  }

  _saveWeights() {
    try { fs.writeFileSync(WEIGHTS_FILE, JSON.stringify(this.weights, null, 2)); } catch (e) {
      this.log.error(`Weights save failed: ${e.message}`);
    }
  }

  /* ── Candle data from CoinGecko ────────────────────────── */
  async fetchCandles(limit = 100) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await httpClient.get("https://api.coingecko.com/api/v3/coins/bitcoin/ohlc", {
          params: { vs_currency: "usd", days: "1" },
        });
        return res.data.map(c => ({
          time: c[0], open: c[1], high: c[2], low: c[3], close: c[4] || c[3], volume: 0,
        }));
      } catch (e) {
        if (attempt === 3) throw e;
        this.log.warn(`Candle fetch attempt ${attempt} failed: ${e.message}, retrying...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  /* ── Get current BTC price + market context ──────────── */
  async fetchMarketData() {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await httpClient.get("https://api.coingecko.com/api/v3/simple/price", {
          params: {
            ids: "bitcoin", vs_currencies: "usd",
            include_24hr_vol: true, include_24hr_change: true, include_last_updated_at: true,
          },
        });
        const d = res.data.bitcoin;
        return {
          price: d.usd,
          volume24h: d.usd_24h_vol,
          change24h: d.usd_24h_change,
        };
      } catch (e) {
        if (attempt === 3) throw e;
        this.log.warn(`Market data fetch attempt ${attempt} failed: ${e.message}, retrying...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  /* ── Market regime detection ─────────────────────────── */
  detectRegime(candles, change24h) {
    const closes = candles.map(c => c.close);
    const recent = closes.slice(-12); // last ~6 hours of 30-min candles
    if (recent.length < 2) return { regime: "unknown", volatility: 0, trend: 0 };

    // Volatility: stddev of % changes
    const changes = [];
    for (let i = 1; i < recent.length; i++) {
      changes.push((recent[i] - recent[i - 1]) / recent[i - 1] * 100);
    }
    const mean = changes.reduce((a, b) => a + b, 0) / changes.length;
    const variance = changes.reduce((a, c) => a + (c - mean) ** 2, 0) / changes.length;
    const volatility = Math.sqrt(variance);

    // Trend: correlation of price with time (linear regression slope direction)
    const n = recent.length;
    const xMean = (n - 1) / 2;
    const yMean = recent.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (recent[i] - yMean);
      den += (i - xMean) ** 2;
    }
    const slope = den ? num / den : 0;
    const trendStrength = (slope / yMean) * 100; // normalized slope as %

    let regime;
    if (volatility > 0.5) regime = "volatile";
    else if (Math.abs(trendStrength) > 0.05) regime = trendStrength > 0 ? "trending_up" : "trending_down";
    else regime = "ranging";

    return { regime, volatility, trend: trendStrength, change24h: change24h || 0 };
  }

  /* ── V2 Microstructure Analysis for 15-min Binary Markets ── */
  analyse(candles, threshold, currentPrice, market, regimeInfo) {
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    // ── MICRO SIGNALS (these actually matter for 15-min predictions) ──

    // 1. CURRENT POSITION: Where is price relative to threshold?
    const gap = currentPrice - threshold;
    const gapPct = (gap / threshold) * 100;
    const aboveThreshold = gap > 0;

    // 2. VOLATILITY-ADJUSTED GAP: Is the gap meaningful?
    //    Use recent candle ranges to measure "typical 15-min movement"
    const recentCandles = candles.slice(-6); // last ~3 hours of 30-min candles
    const ranges = recentCandles.map(c => Math.abs(c.high - c.low));
    const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
    const typicalMovePct = (avgRange / currentPrice) * 100;
    // gapStrength: how many "typical moves" the gap represents
    const gapStrength = typicalMovePct > 0 ? Math.abs(gapPct) / typicalMovePct : 0;

    // 3. DIRECTIONAL MOMENTUM: Are recent candles consistently moving one direction?
    const last5 = closes.slice(-5);
    let upCandles = 0, downCandles = 0;
    for (let i = 1; i < last5.length; i++) {
      if (last5[i] > last5[i - 1]) upCandles++;
      else if (last5[i] < last5[i - 1]) downCandles++;
    }
    const momentumDirection = upCandles > downCandles ? "UP" : downCandles > upCandles ? "DOWN" : "NEUTRAL";
    const momentumStrength = Math.abs(upCandles - downCandles) / Math.max(last5.length - 1, 1);

    // 4. ACCELERATION: Is price accelerating toward or away from threshold?
    //    Compare last candle move vs previous candle move
    const lastMove = closes.length >= 2 ? closes[closes.length - 1] - closes[closes.length - 2] : 0;
    const prevMove = closes.length >= 3 ? closes[closes.length - 2] - closes[closes.length - 3] : 0;
    const accelerating = Math.sign(lastMove) === Math.sign(prevMove) && Math.abs(lastMove) > Math.abs(prevMove);
    const decelerating = Math.sign(lastMove) !== Math.sign(prevMove);
    const movingAwayFromThreshold = (aboveThreshold && lastMove > 0) || (!aboveThreshold && lastMove < 0);

    // 5. MEAN REVERSION RISK: Did price just spike? (Might snap back)
    const last3Range = closes.length >= 3
      ? Math.abs(closes[closes.length - 1] - closes[closes.length - 3]) / currentPrice * 100
      : 0;
    const spikeDetected = last3Range > typicalMovePct * 2; // moved 2x typical in 2 candles

    // 6. BAYSE MARKET ALIGNMENT: What does the crowd think?
    const upPrice = parseFloat(market.outcome1Price) || 0.5;
    const downPrice = parseFloat(market.outcome2Price) || 0.5;
    const marketDirection = upPrice > downPrice ? "UP" : "DOWN";
    const marketConviction = Math.abs(upPrice - downPrice); // 0 = split, 1 = certain

    // ── SCORING ENGINE ──
    // Each factor has a score between -1 (strongly DOWN) and +1 (strongly UP)
    let score = 0;
    let maxPossibleScore = 0;
    const signals = {};

    // S1. Price position (weight: 3) — THE most important signal
    const positionScore = aboveThreshold ? 1 : -1;
    const posWeight = 3.0;
    score += positionScore * posWeight;
    maxPossibleScore += posWeight;
    signals.position = aboveThreshold ? "UP" : "DOWN";

    // S2. Gap strength (weight: 2.5) — a gap of 2+ typical moves is very strong
    const gapScore = Math.min(gapStrength, 3) / 3 * (aboveThreshold ? 1 : -1); // normalized to [-1, 1]
    const gapWeight = 2.5;
    score += gapScore * gapWeight;
    maxPossibleScore += gapWeight;
    signals.gapStrength = gapStrength.toFixed(2) + "x (" + (aboveThreshold ? "UP" : "DOWN") + ")";

    // S3. Momentum alignment (weight: 2) — are candles confirming the gap direction?
    const momScore = momentumDirection === "UP" ? momentumStrength : momentumDirection === "DOWN" ? -momentumStrength : 0;
    const momWeight = 2.0;
    score += momScore * momWeight;
    maxPossibleScore += momWeight;
    signals.momentum = momentumDirection + " (" + (momentumStrength * 100).toFixed(0) + "%)";

    // S4. Acceleration (weight: 1.5) — price speeding away from threshold = good
    let accelScore = 0;
    if (movingAwayFromThreshold && accelerating) accelScore = aboveThreshold ? 0.8 : -0.8;
    else if (movingAwayFromThreshold) accelScore = aboveThreshold ? 0.3 : -0.3;
    else if (decelerating) accelScore = aboveThreshold ? -0.3 : 0.3; // reversal risk
    const accelWeight = 1.5;
    score += accelScore * accelWeight;
    maxPossibleScore += accelWeight;
    signals.acceleration = accelerating ? "accelerating" : decelerating ? "decelerating" : "steady";

    // S5. Mean reversion penalty (weight: 1.5) — reduce conviction if spiking
    let reversionPenalty = 0;
    if (spikeDetected) {
      // Reduce score toward zero — spike might revert
      reversionPenalty = -Math.sign(score) * 0.5;
      signals.reversion = "SPIKE DETECTED (penalty applied)";
    } else {
      signals.reversion = "none";
    }
    const revWeight = 1.5;
    score += reversionPenalty * revWeight;
    maxPossibleScore += revWeight;

    // S6. Bayse market agreement (weight: 2) — critical: don't fight the crowd
    const marketDir = marketDirection === "UP" ? 1 : -1;
    const marketScore = marketDir * Math.min(marketConviction * 2, 1); // scale conviction
    const mktWeight = 2.0;
    score += marketScore * mktWeight;
    maxPossibleScore += mktWeight;
    signals.market = marketDirection + " (conviction: " + (marketConviction * 100).toFixed(0) + "%)";

    // S7. Long-term context (weight: 0.5) — minor tiebreaker only
    const rsi = RSI.calculate({ period: 14, values: closes });
    const latestRsi = rsi[rsi.length - 1];
    let ltScore = 0;
    if (latestRsi > 60) ltScore = 0.3;
    else if (latestRsi < 40) ltScore = -0.3;
    const ltWeight = 0.5;
    score += ltScore * ltWeight;
    maxPossibleScore += ltWeight;
    signals.rsi = latestRsi ? latestRsi.toFixed(1) : "N/A";

    // ── DERIVE DIRECTION AND CONFIDENCE ──
    const direction = score > 0 ? "UP" : score < 0 ? "DOWN" : "HOLD";
    const confidence = maxPossibleScore > 0 ? Math.abs(score) / maxPossibleScore : 0;
    const bullScore = score > 0 ? Math.abs(score) : 0;
    const bearScore = score < 0 ? Math.abs(score) : 0;

    // ── AGREEMENT CHECK: Is our direction aligned with Bayse market? ──
    const agreesWithMarket = direction === marketDirection;
    signals.agreesWithMarket = agreesWithMarket ? "YES" : "NO";

    const ema9 = EMA.calculate({ period: 9, values: closes });
    const ema21 = EMA.calculate({ period: 21, values: closes });

    const latest = {
      price: currentPrice,
      threshold,
      diff: gap,
      diffPct: gapPct.toFixed(4),
      ema9: ema9[ema9.length - 1],
      ema21: ema21[ema21.length - 1],
      rsi: latestRsi,
      gapStrength,
      typicalMovePct,
      spikeDetected,
    };

    return { signal: direction, confidence, bullScore, bearScore, latest, signals, regime: regimeInfo, agreesWithMarket };
  }

  /* ── Outcome checker — learns from resolved trades ───── */
  _startOutcomeChecker() {
    // Check outcomes every 2 minutes
    this._outcomeInterval = setInterval(() => this._checkOutcomes().catch(e =>
      this.log.error(`Outcome check error: ${e.message}`)
    ), 120000);
    // Also do an initial check on startup (delayed 30s to let things settle)
    setTimeout(() => this._checkOutcomes().catch(() => {}), 30000);
  }

  async _checkOutcomes() {
    // Check any trades in the journal that haven't been resolved yet
    const unresolved = this.journal.trades.filter(t => !t.outcome);
    if (unresolved.length === 0) return;

    let activities;
    try {
      const resp = await this.bayse.getActivities({ limit: 50 });
      activities = resp.activities || resp.data || resp;
      if (!Array.isArray(activities)) return;
    } catch { return; }

    let updated = false;
    for (const trade of unresolved) {
      // Find matching PAYOUT_WIN or PAYOUT_LOSS in activities
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

      this.log.info(`📝 Trade resolved: ${won ? "WIN ✅" : "LOSS ❌"} | ${trade.direction} @ $${trade.price} vs $${trade.threshold} | Payout: ₦${trade.payout}`);

      // LEARN: Adjust indicator weights based on this outcome
      this._updateWeights(trade, won);
      updated = true;

      // Send outcome notification
      const stats = this.journal.stats;
      const winRate = stats.wins + stats.losses > 0
        ? ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1)
        : "N/A";
      await this.notify(
        `${won ? "✅ WIN" : "❌ LOSS"} | ${this._esc(trade.direction)} @ $${trade.price}\n` +
        `Payout: ₦${trade.payout} | Stake: ₦${trade.amount}\n` +
        `Record: ${stats.wins}W/${stats.losses}L (${winRate}%) | PnL: ₦${stats.totalPnl.toFixed(0)}`
      );
    }

    if (updated) {
      this._saveJournal();
      this._saveWeights();
    }
  }

  /* ── Weight adjustment — simplified for V2 ────────────── */
  _updateWeights(trade, won) {
    // V2: We don't tune individual indicator weights anymore since the scoring
    // is hardcoded with proper financial logic. Instead, track win rate stats.
    this.log.info(`📊 Trade ${won ? "WON" : "LOST"} | Running: ${this.journal.stats.wins}W/${this.journal.stats.losses}L`);
  }

  /* ── Learned filters from trade history ──────────────── */
  _getLearnedMinGap() {
    // Look at recent trades to find the minimum gap% that produces wins
    const recent = this.journal.trades.filter(t => t.outcome).slice(-50);
    if (recent.length < 10) return 0; // not enough data yet, don't filter

    const winGaps = recent.filter(t => t.outcome === "WIN").map(t => Math.abs(parseFloat(t.diffPct) || 0));
    const lossGaps = recent.filter(t => t.outcome === "LOSS").map(t => Math.abs(parseFloat(t.diffPct) || 0));

    if (winGaps.length === 0) return 0;

    // If losses tend to happen at very small gaps, set a minimum
    const avgWinGap = winGaps.reduce((a, b) => a + b, 0) / winGaps.length;
    const avgLossGap = lossGaps.length > 0 ? lossGaps.reduce((a, b) => a + b, 0) / lossGaps.length : 999;

    // If average loss gap is smaller than average win gap, use the midpoint as a filter
    if (avgLossGap < avgWinGap && lossGaps.length >= 3) {
      const minGap = (avgLossGap + avgWinGap) / 2;
      this.log.debug(`Learned min gap: ${minGap.toFixed(4)}% (avgWin: ${avgWinGap.toFixed(4)}, avgLoss: ${avgLossGap.toFixed(4)})`);
      return minGap;
    }
    return 0;
  }

  /* ── Optional LLM consultation ───────────────────────── */
  async consultLLM(analysis, event) {
    if (!this.bridge || !this.bridge.connected) return null;
    try {
      const prompt = `You are a BTC short-term trading analyst. A prediction market asks: "${event.title}". ` +
        `Threshold: ${event.markets[0]?.marketThreshold || "unknown"}. Current BTC price: $${analysis.latest.price}. ` +
        `RSI: ${analysis.latest.rsi?.toFixed(1)}, MACD histogram: ${analysis.latest.macd?.histogram?.toFixed(2)}, ` +
        `EMA9: ${analysis.latest.ema9?.toFixed(0)}, EMA21: ${analysis.latest.ema21?.toFixed(0)}. ` +
        `Market regime: ${analysis.regime?.regime || "unknown"}, Volatility: ${analysis.regime?.volatility?.toFixed(3) || "?"}, ` +
        `TA signal: ${analysis.signal} (confidence ${(analysis.confidence * 100).toFixed(0)}%). ` +
        `Respond ONLY with JSON: {"direction":"UP"|"DOWN"|"HOLD","confidence":0-100,"reason":"one sentence"}`;
      const reply = await this.bridge.query("btc-analyst", prompt);
      return JSON.parse(reply);
    } catch {
      return null;
    }
  }

  /* ── Position sizing (NGN) ───────────────────────────── */
  calculateSize() {
    return this.config.maxPositionSize; // flat ₦500 per trade
  }

  /* ── Main trading cycle ──────────────────────────────── */
  async runCycle() {
    // 1. Find current Bayse BTC 15min event
    const event = await this.bayse.getCurrentBTC15mEvent();
    if (!event) {
      this.log.warn("No open BTC 15min event found.");
      return;
    }

    // Skip if we already placed a bet or analyzed this event
    if (this.tradedEventIds.has(event.id) || this.analyzedEventIds.has(event.id)) {
      return;
    }

    // Check timing — trade when 7-11 minutes remain (earlier = cheaper shares)
    const now = Date.now();
    const closeTime = new Date(event.closingDate).getTime();
    const minsLeft = (closeTime - now) / 60000;

    if (minsLeft > 11 || minsLeft < 4) {
      if (minsLeft > 11) {
        this.log.debug(`Waiting… ${minsLeft.toFixed(1)} min left until close (need 7-11 min window)`);
      } else {
        this.log.debug(`Too late — only ${minsLeft.toFixed(1)} min left, skipping`);
      }
      return;
    }

    this.log.info(`─── BTC 15min cycle start (${minsLeft.toFixed(1)} min to close) ───`);

    const market = event.markets[0];
    const threshold = parseFloat(market.marketThreshold);
    const upOutcomeId = market.outcome1Id;
    const downOutcomeId = market.outcome2Id;

    this.log.info(`Event: ${event.title} | Threshold: ${threshold} | Closes: ${event.closingDate}`);
    this.log.info(`Market prices: Up=${market.outcome1Price} Down=${market.outcome2Price}`);

    // 2. Fetch candles (cached per event) + market data
    let candles;
    if (this.cachedCandles && this.cachedCandlesEventId === event.id) {
      candles = this.cachedCandles;
      this.log.debug("Using cached candles");
    } else {
      candles = await this.fetchCandles(100);
      this.cachedCandles = candles;
      this.cachedCandlesEventId = event.id;
    }

    const marketData = await this.fetchMarketData();
    const currentPrice = marketData.price;
    const regimeInfo = this.detectRegime(candles, marketData.change24h);

    this.log.info(`Regime: ${regimeInfo.regime} | Vol: ${regimeInfo.volatility.toFixed(3)} | Trend: ${regimeInfo.trend.toFixed(4)} | 24h: ${marketData.change24h?.toFixed(2)}%`);

    // 3. V2 Microstructure analysis
    const analysis = this.analyse(candles, threshold, currentPrice, market, regimeInfo);

    this.log.info(`TA → ${analysis.signal} | Confidence: ${(analysis.confidence * 100).toFixed(0)}% | Bull: ${analysis.bullScore.toFixed(1)} Bear: ${analysis.bearScore.toFixed(1)}`);
    this.log.info(`Price: $${currentPrice} vs Threshold: $${threshold} (diff: ${analysis.latest.diffPct}%)`);
    this.log.info(`Gap: ${analysis.latest.gapStrength?.toFixed(2)}x typical move | Momentum: ${analysis.signals.momentum} | Market: ${analysis.signals.market}`);
    this.log.info(`Accel: ${analysis.signals.acceleration} | Reversion: ${analysis.signals.reversion} | Agrees w/ market: ${analysis.signals.agreesWithMarket}`);

    // 4. Optional LLM second opinion
    const llm = await this.consultLLM(analysis, event);
    if (llm) {
      this.log.info(`LLM → ${llm.direction} (${llm.confidence}%) — ${llm.reason}`);
    }

    // 5. Determine final direction
    let direction = analysis.signal;
    if (llm && llm.direction !== "HOLD") {
      if (llm.direction === analysis.signal) {
        direction = analysis.signal;
      } else if (llm.confidence > 75) {
        direction = llm.direction;
        this.log.info(`LLM override: ${direction}`);
      }
    }

    // 6a. Minimum confidence — only skip true coin-flips where all signals cancel
    if (analysis.confidence < 0.05) {
      this.log.info(`⚠️ Low confidence (${(analysis.confidence * 100).toFixed(0)}% < 5%) — true coin flip, sitting out.`);
      direction = "HOLD";
    }

    // 6b. Market disagreement — log it but DON'T hard-veto (soft factor already in scoring)
    if (direction !== "HOLD" && !analysis.agreesWithMarket) {
      this.log.info(`⚠️ Our signal (${direction}) disagrees with market (${analysis.signals.market}) — proceeding with caution.`);
      // No longer a hard veto — market agreement is already weighted in the scoring engine
    }

    // 6c. Spike guard — only block if confidence is also low
    if (direction !== "HOLD" && analysis.latest.spikeDetected && analysis.confidence < 0.25) {
      this.log.info(`⚠️ Spike detected + low confidence — sitting out.`);
      direction = "HOLD";
    }

    if (direction === "HOLD") {
      this.log.info("HOLD — skipping trade.");
      this.analyzedEventIds.add(event.id);
      await this.notify(this.formatReport(analysis, event, null, llm));
      return;
    }

    // 7. Share price filter — skip if > 0.78 (need some edge, but don't be too picky)
    const outcomeId = direction === "UP" ? upOutcomeId : downOutcomeId;
    const outcomeName = direction === "UP" ? "Up" : "Down";
    const sharePrice = direction === "UP"
      ? parseFloat(market.outcome1Price)
      : parseFloat(market.outcome2Price);

    if (sharePrice > 0.78) {
      this.log.info(`Share price ${sharePrice.toFixed(2)} > 0.78 — poor value, skipping.`);
      this.analyzedEventIds.add(event.id);
      await this.notify(`⚠️ Skipped: ${this._esc(outcomeName)} shares at ${(sharePrice * 100).toFixed(0)}c — too expensive (max 78c)\nEvent: ${this._esc(event.title)}`);
      return;
    }

    // 8. Gap strength — log for visibility but don't filter (already factored into scoring as S2)
    if (analysis.latest.gapStrength < 0.1) {
      this.log.info(`Gap strength ${analysis.latest.gapStrength.toFixed(2)}x — tight but proceeding (scored in S2).`);
    }

    // 9. Place order
    const amount = this.calculateSize();
    this.log.info(`Placing: BUY ${outcomeName} | ₦${amount.toFixed(2)} @ ${(sharePrice * 100).toFixed(0)}c on market ${market.id}`);

    let orderResult = null;
    try {
      orderResult = await this.bayse.placeOrder(event.id, market.id, outcomeId, amount);
      this.log.info(`Order placed: ${JSON.stringify(orderResult)}`);
      this.tradedEventIds.add(event.id);

      // Record in persistent journal (with indicator signals for learning)
      const tradeRecord = {
        time: new Date().toISOString(),
        direction, amount, outcomeId, outcomeName,
        eventId: event.id, marketId: market.id,
        threshold, price: currentPrice,
        diffPct: analysis.latest.diffPct,
        sharePrice, minsBeforeClose: minsLeft.toFixed(1),
        regime: regimeInfo.regime,
        volatility: regimeInfo.volatility,
        signals: analysis.signals,
        bullScore: analysis.bullScore,
        bearScore: analysis.bearScore,
        confidence: analysis.confidence,
        weights: { ...this.weights },
        outcome: null, // filled later by outcome checker
        payout: null,
      };
      this.journal.trades.push(tradeRecord);
      this.tradeHistory.push(tradeRecord);
      this._saveJournal();
    } catch (err) {
      this.log.error(`Order failed: ${err.response?.data ? JSON.stringify(err.response.data) : err.message}`);
      orderResult = { error: err.response?.data || err.message };
      this.analyzedEventIds.add(event.id);
    }

    // 10. Send trade report
    await this.notify(this.formatReport(analysis, event, orderResult, llm));
  }

  /* ── Escape Telegram Markdown special chars ──────────── */
  _esc(str) {
    return String(str).replace(/([_*`\[\]])/g, "\\$1");
  }

  /* ── Report formatting ───────────────────────────────── */
  formatReport(analysis, event, orderResult, llm) {
    const e = (v) => this._esc(v);
    const a = analysis.latest;
    const market = event.markets[0];
    const stats = this.journal.stats;
    const totalTrades = stats.wins + stats.losses;
    const winRate = totalTrades > 0 ? ((stats.wins / totalTrades) * 100).toFixed(1) : "N/A";

    let msg = `📊 *BTC 15min Trade Report*\n`;
    msg += `Event: ${e(event.title)}\n`;
    msg += `Threshold: $${e(market.marketThreshold)} | Closes: ${e(new Date(event.closingDate).toLocaleTimeString())}\n`;
    msg += `Regime: ${e(analysis.regime?.regime || "?")} | Vol: ${e(analysis.regime?.volatility?.toFixed(3) || "?")}\n\n`;
    msg += `Price: $${a.price.toFixed(2)} (${a.diff > 0 ? "+" : ""}${a.diffPct}% vs threshold)\n`;
    msg += `Gap: ${e(a.gapStrength?.toFixed(2) || "?")}x typical move\n`;
    msg += `Momentum: ${e(analysis.signals.momentum || "?")} | Accel: ${e(analysis.signals.acceleration || "?")}\n`;
    msg += `Market: Up=${e(market.outcome1Price)} Down=${e(market.outcome2Price)} | Agrees: ${e(analysis.signals.agreesWithMarket || "?")}\n`;
    msg += `Signal: ${e(analysis.signal)} (${(analysis.confidence * 100).toFixed(0)}% conf)\n`;
    if (llm) msg += `LLM: ${e(llm.direction)} (${llm.confidence}%) — ${e(llm.reason)}\n`;
    msg += `\n`;
    if (orderResult && !orderResult.error) {
      msg += `✅ Order placed: BUY ${e(analysis.signal)} | ₦${this.calculateSize().toFixed(2)}\n`;
    } else if (orderResult?.error) {
      msg += `❌ Order failed: ${e(JSON.stringify(orderResult.error))}\n`;
    } else {
      msg += `⏸️ HOLD — no trade placed\n`;
    }
    msg += `📈 Record: ${stats.wins}W/${stats.losses}L (${winRate}%) | PnL: ₦${stats.totalPnl.toFixed(0)}`;
    return msg;
  }

  /* ── Broadcast to all notifiers ──────────────────────── */
  async notify(message) {
    for (const n of this.notifiers) {
      try { await n.broadcast(message); } catch (e) { this.log.error(`Notify error: ${e.message}`); }
    }
  }

  getHistory() {
    return this.tradeHistory;
  }

  getStats() {
    return {
      ...this.journal.stats,
      totalTrades: this.journal.trades.length,
      weights: { ...this.weights },
      recentTrades: this.journal.trades.slice(-10),
    };
  }

  destroy() {
    if (this._outcomeInterval) clearInterval(this._outcomeInterval);
  }
}

module.exports = { BTCTraderAgent };
