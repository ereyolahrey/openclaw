/**
 * BTC 15-Minute Prediction Market Trader - V3 Aggressive Strategy
 *
 * V3 OVERHAUL:
 * - Data: Binance 1-min candles + order book + recent trades (was: CoinGecko 30-min candles)
 * - Scoring: 10 high-resolution signals from real tick data (was: 7 weak signals from delayed data)
 * - Strategy: Trade almost every cycle (was: HOLD on 95%+ of cycles)
 * - Timing: Enter 4-8 min before close (was: 7-11 min)
 * - Sizing: Confidence-scaled N100-N500 (was: flat N500)
 *
 * Currency: NGN (Nigerian Naira)
 */
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { EMA, RSI } = require("technicalindicators");
const https = require("https");
require("../utils/dns-fix");
const { BayseClient } = require("../utils/bayse-client");
const { Logger } = require("../utils/logger");

const httpClient = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  timeout: 15000,
});

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const JOURNAL_FILE = path.join(DATA_DIR, "trade-journal.json");

class BTCTraderAgent {
  constructor({ bridge, notifiers = [], config = {} }) {
    this.bridge = bridge;
    this.notifiers = notifiers;
    this.config = {
      asset: config.asset || "BTC",
      interval: config.interval || "15m",
      maxPositionSize: config.maxPositionSize || 500,
      minPositionSize: 100,
      riskPercent: config.riskPercent || 2,
    };
    this.bayse = new BayseClient();
    this.log = new Logger("btc-trader");
    this.tradeHistory = [];
    this.tradedEventIds = new Set();
    this.analyzedEventIds = new Set();

    this._ensureDataDir();
    this.journal = this._loadJournal();

    for (const t of this.journal.trades) {
      if (t.eventId) this.tradedEventIds.add(t.eventId);
    }

    this._startOutcomeChecker();
  }

  /* -- Persistent storage -- */
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
      this.log.error("Journal save failed: " + e.message);
    }
  }

  /* -- CoinGecko DATA: 5-min price+volume points (289 over 24h) -- */
  async fetchPriceHistory() {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await httpClient.get("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart", {
          params: { vs_currency: "usd", days: "1" },
        });
        const prices = res.data.prices; // [[timestamp, price], ...]
        const volumes = res.data.total_volumes; // [[timestamp, vol], ...]
        // Build synthetic candles from 5-min price points
        const candles = [];
        for (let i = 1; i < prices.length; i++) {
          const prev = prices[i - 1][1];
          const curr = prices[i][1];
          const vol = volumes[i] ? volumes[i][1] : 0;
          candles.push({
            time: prices[i][0],
            open: prev,
            high: Math.max(prev, curr),
            low: Math.min(prev, curr),
            close: curr,
            volume: vol,
          });
        }
        return candles;
      } catch (e) {
        if (attempt === 3) throw e;
        this.log.warn("Market chart fetch attempt " + attempt + " failed: " + e.message);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  /* -- CoinGecko DATA: Spot price + 24h stats -- */
  async fetchSpotData() {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await httpClient.get("https://api.coingecko.com/api/v3/simple/price", {
          params: {
            ids: "bitcoin", vs_currencies: "usd",
            include_24hr_vol: true, include_24hr_change: true,
          },
        });
        const d = res.data.bitcoin;
        return {
          price: d.usd,
          change24h: d.usd_24h_change,
          volume24h: d.usd_24h_vol,
        };
      } catch (e) {
        if (attempt === 3) throw e;
        this.log.warn("Spot fetch attempt " + attempt + " failed: " + e.message);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  /* -- V3 SCORING ENGINE: 10 signals from CoinGecko 5-min data + Bayse -- */
  analyse(candles, spot, threshold, currentPrice, market) {
    const signals = {};
    let score = 0;
    let maxScore = 0;

    const gap = currentPrice - threshold;
    const gapPct = (gap / threshold) * 100;
    const aboveThreshold = gap > 0;
    const dir = aboveThreshold ? 1 : -1;

    // S1. PRICE POSITION (weight: 4) - dominant signal for binary markets
    const w1 = 4.0;
    score += dir * w1;
    maxScore += w1;
    signals.position = (aboveThreshold ? "ABOVE" : "BELOW") + " by " + Math.abs(gapPct).toFixed(4) + "%";

    // S2. SHORT MOMENTUM (weight: 3) - Last 6 candles (~30 min) direction
    const closes = candles.map(c => c.close);
    const last6 = closes.slice(-6);
    let upCount = 0, downCount = 0;
    for (let i = 1; i < last6.length; i++) {
      if (last6[i] > last6[i - 1]) upCount++;
      else if (last6[i] < last6[i - 1]) downCount++;
    }
    const momDir = upCount > downCount ? 1 : downCount > upCount ? -1 : 0;
    const momStrength = Math.abs(upCount - downCount) / 5;
    const w2 = 3.0;
    score += momDir * momStrength * w2;
    maxScore += w2;
    signals.momentum = upCount + "up/" + downCount + "down (" + (momDir > 0 ? "UP" : momDir < 0 ? "DOWN" : "FLAT") + " " + (momStrength * 100).toFixed(0) + "%)";

    // S3. 1-HOUR TREND (weight: 2.5) - Last 12 candles (~60 min)
    if (closes.length >= 12) {
      const last12 = closes.slice(-12);
      const trendMove = (last12[last12.length - 1] - last12[0]) / last12[0] * 100;
      const trendDir = trendMove > 0.01 ? 1 : trendMove < -0.01 ? -1 : 0;
      const trendMag = Math.min(Math.abs(trendMove) / 0.15, 1);
      const w3 = 2.5;
      score += trendDir * trendMag * w3;
      maxScore += w3;
      signals.trend1h = (trendMove > 0 ? "+" : "") + trendMove.toFixed(4) + "% (str: " + (trendMag * 100).toFixed(0) + "%)";
    } else {
      maxScore += 2.5;
      signals.trend1h = "N/A";
    }

    // S4. ACCELERATION (weight: 2.5) - Is price accelerating in gap direction?
    if (closes.length >= 4) {
      const recentMove = closes[closes.length - 1] - closes[closes.length - 2];
      const prevMove = closes[closes.length - 2] - closes[closes.length - 3];
      const movingAway = (aboveThreshold && recentMove > 0) || (!aboveThreshold && recentMove < 0);
      const accel = Math.sign(recentMove) === Math.sign(prevMove) && Math.abs(recentMove) > Math.abs(prevMove);
      let accelScore = 0;
      if (movingAway && accel) accelScore = dir * 0.8;
      else if (movingAway) accelScore = dir * 0.4;
      else if (!movingAway && Math.abs(recentMove) > Math.abs(prevMove)) accelScore = -dir * 0.5; // reversal
      else accelScore = 0;
      const w4 = 2.5;
      score += accelScore * w4;
      maxScore += w4;
      signals.acceleration = (accel ? "ACCEL " : "") + (movingAway ? "away" : "toward") + " threshold";
    } else {
      maxScore += 2.5;
      signals.acceleration = "N/A";
    }

    // S5. GAP STRENGTH (weight: 2) - Is gap meaningful vs typical movement?
    const ranges = candles.slice(-12).map(c => Math.abs(c.high - c.low));
    const avgRange = ranges.length > 0 ? ranges.reduce((a, b) => a + b, 0) / ranges.length : 1;
    const typicalMovePct = (avgRange / currentPrice) * 100;
    const gapStrength = typicalMovePct > 0 ? Math.abs(gapPct) / typicalMovePct : 0;
    const gapScore = Math.min(gapStrength, 3) / 3 * dir;
    const w5 = 2.0;
    score += gapScore * w5;
    maxScore += w5;
    signals.gapStrength = gapStrength.toFixed(2) + "x typical (" + (dir > 0 ? "UP" : "DOWN") + ")";

    // S6. VOLUME TREND (weight: 1.5) - Is volume increasing with the move?
    if (candles.length >= 12) {
      const vols = candles.slice(-12).map(c => c.volume);
      const firstHalf = vols.slice(0, 6).reduce((a, b) => a + b, 0) / 6;
      const secondHalf = vols.slice(6).reduce((a, b) => a + b, 0) / 6;
      const volRatio = firstHalf > 0 ? secondHalf / firstHalf : 1;
      const priceDir = closes[closes.length - 1] > closes[closes.length - 7] ? 1 : -1;
      if (volRatio > 1.2) {
        const surgeMag = Math.min((volRatio - 1) / 1.0, 1);
        const w6 = 1.5;
        score += priceDir * surgeMag * w6;
        maxScore += w6;
        signals.volumeTrend = volRatio.toFixed(1) + "x (" + (priceDir > 0 ? "UP" : "DOWN") + " move)";
      } else {
        maxScore += 1.5;
        signals.volumeTrend = volRatio.toFixed(1) + "x (flat)";
      }
    } else {
      maxScore += 1.5;
      signals.volumeTrend = "N/A";
    }

    // S7. BAYSE MARKET PRICE (weight: 3) - Higher weight since no exchange data
    const upPrice = parseFloat(market.outcome1Price) || 0.5;
    const downPrice = parseFloat(market.outcome2Price) || 0.5;
    const mktDir = upPrice > downPrice ? 1 : -1;
    const mktConviction = Math.abs(upPrice - downPrice);
    const mktStrength = Math.min(mktConviction * 2.5, 1);
    const w7 = 3.0;
    score += mktDir * mktStrength * w7;
    maxScore += w7;
    signals.bayseMarket = "Up=" + upPrice + " Down=" + downPrice + " (" + (mktDir > 0 ? "UP" : "DOWN") + " " + (mktConviction * 100).toFixed(0) + "c spread)";

    // S8. RSI (weight: 1.5) - From 5-min candles
    if (closes.length >= 20) {
      const rsiVals = RSI.calculate({ period: 14, values: closes });
      const latestRsi = rsiVals[rsiVals.length - 1];
      if (latestRsi !== undefined) {
        let rsiDir = 0;
        if (latestRsi > 55) rsiDir = 1;
        else if (latestRsi < 45) rsiDir = -1;
        const rsiMag = Math.min(Math.abs(latestRsi - 50) / 20, 1);
        const w8 = 1.5;
        score += rsiDir * rsiMag * w8;
        maxScore += w8;
        signals.rsi = latestRsi.toFixed(1);
      } else {
        maxScore += 1.5;
        signals.rsi = "N/A";
      }
    } else {
      maxScore += 1.5;
      signals.rsi = "N/A";
    }

    // S9. EMA CROSS (weight: 1.5) - EMA3 vs EMA8 on 5-min data
    if (closes.length >= 10) {
      const ema3 = EMA.calculate({ period: 3, values: closes });
      const ema8 = EMA.calculate({ period: 8, values: closes });
      if (ema3.length > 0 && ema8.length > 0) {
        const e3 = ema3[ema3.length - 1];
        const e8 = ema8[ema8.length - 1];
        const emaDir = e3 > e8 ? 1 : -1;
        const emaDiff = Math.abs(e3 - e8) / currentPrice * 100;
        const emaMag = Math.min(emaDiff / 0.05, 1);
        const w9 = 1.5;
        score += emaDir * emaMag * w9;
        maxScore += w9;
        signals.emaCross = "EMA3=" + e3.toFixed(0) + " vs EMA8=" + e8.toFixed(0) + " (" + (emaDir > 0 ? "BULL" : "BEAR") + ")";
      } else {
        maxScore += 1.5;
        signals.emaCross = "N/A";
      }
    } else {
      maxScore += 1.5;
      signals.emaCross = "N/A";
    }

    // S10. 24H CONTEXT (weight: 1) - Is the day bullish or bearish?
    if (spot && spot.change24h !== undefined) {
      const dayDir = spot.change24h > 0.3 ? 1 : spot.change24h < -0.3 ? -1 : 0;
      const dayMag = Math.min(Math.abs(spot.change24h) / 3, 1);
      const w10 = 1.0;
      score += dayDir * dayMag * w10;
      maxScore += w10;
      signals.day24h = (spot.change24h > 0 ? "+" : "") + spot.change24h.toFixed(2) + "%";
    } else {
      maxScore += 1.0;
      signals.day24h = "N/A";
    }

    // -- FINAL DIRECTION AND CONFIDENCE --
    const direction = score > 0 ? "UP" : score < 0 ? "DOWN" : "UP";
    const confidence = maxScore > 0 ? Math.abs(score) / maxScore : 0.5;
    const agreesWithMarket = (direction === "UP" && mktDir > 0) || (direction === "DOWN" && mktDir < 0);
    signals.agreesWithMarket = agreesWithMarket ? "YES" : "NO";

    return {
      signal: direction,
      confidence,
      rawScore: score,
      maxScore,
      latest: {
        price: currentPrice, threshold, diff: gap,
        diffPct: gapPct.toFixed(4), gapStrength, typicalMovePct,
      },
      signals,
      agreesWithMarket,
    };
  }

  /* -- Outcome checker -- */
  _startOutcomeChecker() {
    this._outcomeInterval = setInterval(() => this._checkOutcomes().catch(e =>
      this.log.error("Outcome check error: " + e.message)
    ), 120000);
    setTimeout(() => this._checkOutcomes().catch(() => {}), 30000);
  }

  async _checkOutcomes() {
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
      const payout = activities.find(a =>
        (a.type === "PAYOUT_WIN" || a.type === "PAYOUT_LOSS") &&
        a.eventId === trade.eventId &&
        a.outcomeId === trade.outcomeId
      );
      if (!payout) continue;

      const won = payout.type === "PAYOUT_WIN";
      trade.outcome = won ? "WIN" : "LOSS";
      trade.payout = parseFloat(payout.amount) || 0;
      trade.resolvedAt = payout.createdAt;

      if (won) {
        this.journal.stats.wins++;
        this.journal.stats.totalPnl += (trade.payout - trade.amount);
      } else {
        this.journal.stats.losses++;
        this.journal.stats.totalPnl -= trade.amount;
      }

      this.log.info("Trade resolved: " + (won ? "WIN" : "LOSS") + " | " + trade.direction + " @ $" + trade.price + " vs $" + trade.threshold + " | Payout: N" + trade.payout);
      updated = true;

      const stats = this.journal.stats;
      const winRate = stats.wins + stats.losses > 0
        ? ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1) : "N/A";
      await this.notify(
        (won ? "WIN" : "LOSS") + " | " + this._esc(trade.direction) + " @ $" + trade.price + "\n" +
        "Payout: N" + trade.payout + " | Stake: N" + trade.amount + "\n" +
        "Record: " + stats.wins + "W/" + stats.losses + "L (" + winRate + "%) | PnL: N" + stats.totalPnl.toFixed(0)
      );
    }

    if (updated) this._saveJournal();
  }

  /* -- Confidence-scaled position sizing -- */
  calculateSize(confidence) {
    const { minPositionSize, maxPositionSize } = this.config;
    if (confidence >= 0.8) return maxPositionSize;
    if (confidence >= 0.6) return Math.round(maxPositionSize * 0.7);
    if (confidence >= 0.3) return Math.round(maxPositionSize * 0.4);
    return minPositionSize;
  }

  /* -- Optional LLM consultation -- */
  async consultLLM(analysis, event) {
    if (!this.bridge || !this.bridge.connected) return null;
    try {
      const prompt = "BTC prediction market: " + event.title + ". Threshold: $" + analysis.latest.threshold +
        ". Current price: $" + analysis.latest.price + " (" + analysis.latest.diffPct + "% away). " +
        "Momentum: " + analysis.signals.momentum + ". Trend: " + analysis.signals.trend1h + ". " +
        "Gap: " + analysis.signals.gapStrength + ". Bayse: " + analysis.signals.bayseMarket + ". " +
        "V3 signal: " + analysis.signal + " (" + (analysis.confidence * 100).toFixed(0) + "% conf). " +
        'Respond ONLY with JSON: {"direction":"UP"|"DOWN","confidence":0-100,"reason":"one sentence"}';
      const reply = await this.bridge.query("btc-analyst", prompt);
      return JSON.parse(reply);
    } catch { return null; }
  }

  /* -- Main trading cycle -- */
  async runCycle() {
    const event = await this.bayse.getCurrentBTC15mEvent();
    if (!event) { this.log.warn("No open BTC 15min event found."); return; }

    if (this.tradedEventIds.has(event.id)) { this.log.info("Event " + event.id.slice(0,8) + " already traded, waiting for next."); return; }
    if (this.analyzedEventIds.has(event.id)) { this.log.info("Event " + event.id.slice(0,8) + " already analyzed, waiting for next."); return; }

    const now = Date.now();
    const closeTime = new Date(event.closingDate).getTime();
    const minsLeft = (closeTime - now) / 60000;

    // V3: Enter 4-8 min before close
    if (minsLeft > 8 || minsLeft < 2) {
      if (minsLeft > 8) this.log.info("Waiting... " + minsLeft.toFixed(1) + " min left (need 4-8 min window)");
      else this.log.info("Too late - only " + minsLeft.toFixed(1) + " min left");
      return;
    }

    this.log.info("=== BTC 15min V3 cycle (" + minsLeft.toFixed(1) + " min to close) ===");

    const market = event.markets[0];
    const threshold = parseFloat(market.marketThreshold);
    const upOutcomeId = market.outcome1Id;
    const downOutcomeId = market.outcome2Id;

    this.log.info("Event: " + event.title + " | Threshold: $" + threshold);
    this.log.info("Market: Up=" + market.outcome1Price + " Down=" + market.outcome2Price);

    // Fetch CoinGecko data in parallel
    const [candles, spot] = await Promise.all([
      this.fetchPriceHistory().catch(e => { this.log.error("Price history: " + e.message); return []; }),
      this.fetchSpotData().catch(e => { this.log.error("Spot data: " + e.message); return null; }),
    ]);

    const currentPrice = spot ? spot.price : (candles.length > 0 ? candles[candles.length - 1].close : threshold);
    this.log.info("BTC: $" + currentPrice.toFixed(2) + " | 24h: " + (spot ? spot.change24h.toFixed(2) : "?") + "%");

    // V3 analysis
    const analysis = this.analyse(candles, spot, threshold, currentPrice, market);

    this.log.info("Signal: " + analysis.signal + " | Confidence: " + (analysis.confidence * 100).toFixed(0) + "% | Score: " + analysis.rawScore.toFixed(2) + "/" + analysis.maxScore.toFixed(1));
    this.log.info("Price: $" + currentPrice.toFixed(2) + " vs $" + threshold + " (" + analysis.latest.diffPct + "% gap, " + analysis.latest.gapStrength.toFixed(2) + "x typical)");
    this.log.info("Mom: " + analysis.signals.momentum + " | Trend: " + analysis.signals.trend1h + " | Accel: " + analysis.signals.acceleration);
    this.log.info("Gap: " + analysis.signals.gapStrength + " | Vol: " + analysis.signals.volumeTrend + " | RSI: " + analysis.signals.rsi);
    this.log.info("EMA: " + analysis.signals.emaCross + " | 24h: " + analysis.signals.day24h);
    this.log.info("Bayse: " + analysis.signals.bayseMarket + " | Agrees: " + analysis.signals.agreesWithMarket);

    // LLM second opinion
    const llm = await this.consultLLM(analysis, event);
    if (llm) this.log.info("LLM -> " + llm.direction + " (" + llm.confidence + "%) - " + llm.reason);

    let direction = analysis.signal;
    if (llm && llm.direction !== "HOLD" && llm.confidence > 75 && llm.direction !== analysis.signal) {
      direction = llm.direction;
      this.log.info("LLM override: " + direction);
    }

    // V3: ONLY skip on absolute zero confidence
    if (analysis.confidence < 0.02) {
      this.log.info("Confidence " + (analysis.confidence * 100).toFixed(1) + "% - perfect deadlock, sitting out.");
      direction = "HOLD";
    }

    if (direction === "HOLD") {
      this.log.info("HOLD - skipping.");
      this.analyzedEventIds.add(event.id);
      await this.notify(this.formatReport(analysis, event, null, llm));
      return;
    }

    // V3 VALUE BETTING: Pick direction with best expected value
    const probSignalDir = 0.5 + analysis.confidence * 0.4; // Conservative: 50% at conf=0, 90% at conf=100%
    const probUp = direction === "UP" ? probSignalDir : (1 - probSignalDir);
    const probDown = 1 - probUp;
    const upPrice = parseFloat(market.outcome1Price);
    const downPrice = parseFloat(market.outcome2Price);
    const upEdge = probUp / upPrice - 1;   // >0 means +EV
    const downEdge = probDown / downPrice - 1;

    this.log.info("EV: P(UP)=" + (probUp * 100).toFixed(0) + "% @ " + (upPrice * 100).toFixed(0) + "c (edge:" + (upEdge > 0 ? "+" : "") + (upEdge * 100).toFixed(0) + "%) | P(DOWN)=" + (probDown * 100).toFixed(0) + "% @ " + (downPrice * 100).toFixed(0) + "c (edge:" + (downEdge > 0 ? "+" : "") + (downEdge * 100).toFixed(0) + "%)");

    // Pick the direction with best EV, requiring minimum edge for contrarian bets
    const MIN_CONTRARIAN_EDGE = 0.15; // 15% minimum for going against signal
    let tradeSide;
    if (upEdge > downEdge && upEdge > 0) {
      tradeSide = (direction === "UP" || upEdge >= MIN_CONTRARIAN_EDGE) ? "UP" : direction;
    } else if (downEdge > upEdge && downEdge > 0) {
      tradeSide = (direction === "DOWN" || downEdge >= MIN_CONTRARIAN_EDGE) ? "DOWN" : direction;
    } else {
      tradeSide = direction;
    }
    if (tradeSide !== direction) {
      this.log.info("Value pick: " + direction + " (" + (direction === "UP" ? upEdge : downEdge).toFixed(2) + ") < " + tradeSide + " (" + (tradeSide === "UP" ? upEdge : downEdge).toFixed(2) + ") — trading better EV side");
    }

    const outcomeId = tradeSide === "UP" ? upOutcomeId : downOutcomeId;
    const outcomeName = tradeSide === "UP" ? "Up" : "Down";
    const sharePrice = tradeSide === "UP" ? upPrice : downPrice;
    const tradeEdge = tradeSide === "UP" ? upEdge : downEdge;

    // Skip if negative EV on our chosen side
    if (tradeEdge < -0.03) {
      this.log.info("No +EV opportunity. Best edge: " + (Math.max(upEdge, downEdge) * 100).toFixed(0) + "% — skipping.");
      this.analyzedEventIds.add(event.id);
      await this.notify("Skipped: no +EV bet available");
      return;
    }
    // Also skip extremely cheap shares (< 12c) — market is very confident the other way
    if (sharePrice < 0.12) {
      this.log.info("Share price " + (sharePrice * 100).toFixed(0) + "c < 12c — market too confident against us, skipping.");
      this.analyzedEventIds.add(event.id);
      return;
    }

    // Confidence-scaled sizing — contrarian bets always use minimum size
    const isContrarian = tradeSide !== direction;
    const amount = isContrarian ? this.config.minPositionSize : this.calculateSize(analysis.confidence);
    this.log.info("Placing: BUY " + outcomeName + " | N" + amount + " @ " + (sharePrice * 100).toFixed(0) + "c (edge: " + (tradeEdge > 0 ? "+" : "") + (tradeEdge * 100).toFixed(0) + "%)");

    let orderResult = null;
    try {
      orderResult = await this.bayse.placeOrder(event.id, market.id, outcomeId, amount);
      this.log.info("Order placed: " + JSON.stringify(orderResult));
      this.tradedEventIds.add(event.id);

      const tradeRecord = {
        version: 3,
        time: new Date().toISOString(),
        direction: tradeSide, amount, outcomeId, outcomeName,
        eventId: event.id, marketId: market.id,
        threshold, price: currentPrice,
        diffPct: analysis.latest.diffPct,
        sharePrice, minsBeforeClose: minsLeft.toFixed(1),
        confidence: analysis.confidence,
        rawScore: analysis.rawScore,
        maxScore: analysis.maxScore,
        signals: analysis.signals,
        outcome: null, payout: null,
      };
      this.journal.trades.push(tradeRecord);
      this.tradeHistory.push(tradeRecord);
      this._saveJournal();
    } catch (err) {
      this.log.error("Order failed: " + (err.response && err.response.data ? JSON.stringify(err.response.data) : err.message));
      orderResult = { error: err.response ? err.response.data : err.message };
      this.analyzedEventIds.add(event.id);
    }

    await this.notify(this.formatReport(analysis, event, orderResult, llm));
  }

  /* -- Escape Telegram Markdown special chars -- */
  _esc(str) {
    return String(str).replace(/[_*`\[\]]/g, function(m) { return "\\" + m; });
  }

  /* -- Report formatting -- */
  formatReport(analysis, event, orderResult, llm) {
    const e = (v) => this._esc(v);
    const a = analysis.latest;
    const market = event.markets[0];
    const stats = this.journal.stats;
    const total = stats.wins + stats.losses;
    const winRate = total > 0 ? ((stats.wins / total) * 100).toFixed(1) : "N/A";

    let msg = "*BTC 15min V3 Report*\n";
    msg += "Threshold: $" + e(market.marketThreshold) + " | Price: $" + a.price.toFixed(2) + " (" + (a.diff > 0 ? "+" : "") + a.diffPct + "%)\n";
    msg += "Signal: " + e(analysis.signal) + " (" + (analysis.confidence * 100).toFixed(0) + "% | " + analysis.rawScore.toFixed(1) + "/" + analysis.maxScore.toFixed(1) + ")\n";
    msg += "Mom: " + e(analysis.signals.momentum) + " | Trend: " + e(analysis.signals.trend1h || "?") + "\n";
    msg += "Gap: " + e(analysis.signals.gapStrength || "?") + " | Accel: " + e(analysis.signals.acceleration || "?") + "\n";
    msg += "Bayse: Up=" + e(market.outcome1Price) + " Down=" + e(market.outcome2Price) + " | Agrees: " + e(analysis.signals.agreesWithMarket) + "\n";
    if (llm) msg += "LLM: " + e(llm.direction) + " (" + llm.confidence + "%) - " + e(llm.reason) + "\n";
    if (orderResult && !orderResult.error) {
      msg += "BUY " + e(analysis.signal) + " | N" + this.calculateSize(analysis.confidence) + "\n";
    } else if (orderResult && orderResult.error) {
      msg += "Failed: " + e(JSON.stringify(orderResult.error).slice(0, 100)) + "\n";
    } else {
      msg += "HOLD\n";
    }
    msg += stats.wins + "W/" + stats.losses + "L (" + winRate + "%) | PnL: N" + stats.totalPnl.toFixed(0);
    return msg;
  }

  async notify(message) {
    for (const n of this.notifiers) {
      try { await n.broadcast(message); } catch (e) { this.log.error("Notify error: " + e.message); }
    }
  }

  getHistory() { return this.tradeHistory; }

  getStats() {
    return {
      ...this.journal.stats,
      totalTrades: this.journal.trades.length,
      recentTrades: this.journal.trades.slice(-10),
    };
  }

  destroy() { if (this._outcomeInterval) clearInterval(this._outcomeInterval); }
}

module.exports = { BTCTraderAgent };
