/**
 * Polymarket Prediction Market Trader
 *
 * Trades on Polymarket's CLOB using the same microstructure-based analysis
 * from the Bayse traders. Focuses on crypto price strike markets (BTC/ETH)
 * where we can reuse CoinGecko price data for directional conviction.
 *
 * Chain: Polygon (137)
 * Currency: USDC
 * API: Gamma API for market discovery, CLOB for order execution
 */
require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const https = require("https");
const { Logger } = require("../utils/logger");

const httpClient = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  timeout: 30000,
});

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const JOURNAL_FILE = path.join(DATA_DIR, "polymarket-journal.json");
const STATE_FILE = path.join(DATA_DIR, "polymarket-state.json");

// Gamma API for market discovery (read-only, no auth needed)
const GAMMA_API = "https://gamma-api.polymarket.com";
const CLOB_HOST = "https://clob.polymarket.com";
const CHAIN_ID = 137;

// Focus on crypto price strike markets — these align with our analysis engine
const CRYPTO_KEYWORDS = [
  "Bitcoin", "BTC", "Ethereum", "ETH",
  "above", "below", "price", "reach",
];

class PolymarketTrader {
  constructor({ notifiers = [], config = {} }) {
    this.notifiers = notifiers;
    this.config = {
      maxOrderSize: config.maxOrderSize || 5,      // USDC per trade
      maxDailyTrades: config.maxDailyTrades || 10,
      minEdge: config.minEdge || 0.08,              // minimum edge to trade (8%)
      ...config,
    };
    this.log = new Logger("polymarket");
    this.tradedTokenIds = new Set();
    this.dailyTradeCount = 0;
    this.lastResetDate = new Date().toDateString();
    this.clobClient = null;
    this.priceCache = {};
  }

  // --- Initialization ---
  async init() {
    this.log.info("Initializing Polymarket trader...");

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      this.log.error("PRIVATE_KEY not set in .env — cannot trade on Polymarket");
      return false;
    }

    try {
      // Dynamic import for ESM modules
      const polyModule = await import("@polymarket/clob-client");
      const ClobClient = polyModule.ClobClient || polyModule.default?.ClobClient;
      const { Wallet } = require("@ethersproject/wallet");

      const wallet = new Wallet(privateKey);
      const funderAddress = wallet.address;

      // Level 1 auth: create or derive API key (signature_type 0 = EOA)
      const tempClient = new ClobClient(CLOB_HOST, CHAIN_ID, wallet);
      let creds;
      try {
        creds = await tempClient.createOrDeriveApiKey();
      } catch (err) {
        this.log.warn(`Could not derive API key: ${err.message}`);
        this.log.info("Will operate in read-only mode (market scanning + analysis)");
        this.clobClient = new ClobClient(CLOB_HOST, CHAIN_ID); // read-only
        return true;
      }

      this.clobClient = new ClobClient(
        CLOB_HOST,
        CHAIN_ID,
        wallet,
        creds,
        0,              // signature_type: 0 = EOA
        funderAddress,
      );

      this.log.info(`Polymarket trader initialized — wallet: ${funderAddress}`);
      return true;
    } catch (err) {
      this.log.error(`Failed to init Polymarket client: ${err.message}`);
      // Fallback: read-only mode using REST APIs directly
      this.clobClient = null;
      return true; // still scan and analyze
    }
  }

  // --- Market Discovery via Gamma API ---
  async discoverCryptoMarkets() {
    try {
      // Query active crypto-related markets
      const resp = await httpClient.get(`${GAMMA_API}/markets`, {
        params: {
          active: true,
          closed: false,
          limit: 100,
        },
      });

      const markets = resp.data || [];
      const cryptoMarkets = markets.filter((m) => {
        const text = `${m.question || ""} ${m.description || ""}`.toLowerCase();
        return CRYPTO_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
      });

      this.log.info(`Found ${cryptoMarkets.length} crypto markets on Polymarket`);
      return cryptoMarkets;
    } catch (err) {
      this.log.error(`Gamma API error: ${err.message}`);
      return [];
    }
  }

  // --- Price Data ---
  async getCurrentPrice(asset) {
    const cacheKey = asset.toLowerCase();
    const cached = this.priceCache[cacheKey];
    if (cached && Date.now() - cached.fetchedAt < 60000) {
      return cached.price;
    }

    const geckoId = asset === "BTC" ? "bitcoin" : asset === "ETH" ? "ethereum" : null;
    if (!geckoId) return null;

    try {
      const resp = await httpClient.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${geckoId}&vs_currencies=usd`
      );
      const price = resp.data?.[geckoId]?.usd;
      if (price) {
        this.priceCache[cacheKey] = { price, fetchedAt: Date.now() };
      }
      return price || null;
    } catch (err) {
      this.log.warn(`CoinGecko error for ${asset}: ${err.message}`);
      return cached?.price || null;
    }
  }

  // --- Analysis Engine ---
  analyzeMarket(market, currentPrice) {
    if (!currentPrice || !market) return null;

    const question = (market.question || "").toLowerCase();
    const outcomes = market.outcomes || [];
    const outcomePrices = market.outcomePrices
      ? JSON.parse(market.outcomePrices)
      : [];

    // Parse threshold from question (e.g., "Will Bitcoin be above $65,000...")
    const priceMatch = question.match(
      /\$?([\d,]+(?:\.\d+)?)\s*(?:k|thousand)?/i
    );
    if (!priceMatch) return null;

    const threshold = parseFloat(priceMatch[1].replace(/,/g, ""));
    if (!threshold || threshold <= 0) return null;

    // Determine direction
    const isAbove = question.includes("above") || question.includes("over") ||
                    question.includes("reach") || question.includes("higher");
    const isBelow = question.includes("below") || question.includes("under") ||
                    question.includes("drop") || question.includes("lower");

    if (!isAbove && !isBelow) return null;

    // Calculate our probability based on price distance
    const gap = currentPrice - threshold;
    const gapPercent = (gap / threshold) * 100;

    let ourProb;
    if (isAbove) {
      // If price is already above threshold, high probability of "Yes"
      if (gapPercent > 3) ourProb = 0.85;
      else if (gapPercent > 1) ourProb = 0.70;
      else if (gapPercent > 0) ourProb = 0.58;
      else if (gapPercent > -1) ourProb = 0.42;
      else if (gapPercent > -3) ourProb = 0.30;
      else ourProb = 0.15;
    } else {
      // "Below" market — inverse
      if (gapPercent < -3) ourProb = 0.85;
      else if (gapPercent < -1) ourProb = 0.70;
      else if (gapPercent < 0) ourProb = 0.58;
      else if (gapPercent < 1) ourProb = 0.42;
      else if (gapPercent < 3) ourProb = 0.30;
      else ourProb = 0.15;
    }

    // Get market prices (Yes/No)
    const yesPrice = outcomePrices.length > 0 ? parseFloat(outcomePrices[0]) : null;
    const noPrice = outcomePrices.length > 1 ? parseFloat(outcomePrices[1]) : null;

    if (!yesPrice && !noPrice) return null;

    // Find edge: our probability vs market price
    let side = null;
    let edge = 0;
    let tokenIndex = 0;
    let price = 0;

    if (yesPrice && ourProb > yesPrice + this.config.minEdge) {
      side = "BUY";
      tokenIndex = 0; // Yes token
      edge = ourProb - yesPrice;
      price = yesPrice;
    } else if (noPrice && (1 - ourProb) > noPrice + this.config.minEdge) {
      side = "BUY";
      tokenIndex = 1; // No token
      edge = (1 - ourProb) - noPrice;
      price = noPrice;
    }

    if (!side) return null;

    return {
      marketId: market.id,
      conditionId: market.conditionId,
      question: market.question,
      threshold,
      currentPrice,
      gapPercent: gapPercent.toFixed(2),
      ourProbability: ourProb.toFixed(3),
      marketYesPrice: yesPrice,
      marketNoPrice: noPrice,
      side,
      tokenIndex,
      buyPrice: price,
      edge: edge.toFixed(3),
      tokens: market.clobTokenIds ? JSON.parse(market.clobTokenIds) : [],
      tickSize: market.minimumTickSize || "0.01",
      negRisk: market.negRisk || false,
    };
  }

  // --- Order Execution ---
  async executeTrade(signal) {
    if (!this.clobClient || !signal) return null;

    // Daily limit check
    if (this.dailyTradeCount >= this.config.maxDailyTrades) {
      this.log.info("Daily trade limit reached");
      return null;
    }

    const tokenId = signal.tokens?.[signal.tokenIndex];
    if (!tokenId) {
      this.log.warn(`No token ID for market: ${signal.question}`);
      return null;
    }

    // Skip if already traded this token
    if (this.tradedTokenIds.has(tokenId)) {
      return null;
    }

    try {
      const size = Math.min(
        this.config.maxOrderSize,
        this.config.maxOrderSize / signal.buyPrice
      );

      // Use GTC (Good Till Cancelled) limit order
      const polyModule = await import("@polymarket/clob-client");
      const OrderType = polyModule.OrderType || polyModule.default?.OrderType;
      const Side = polyModule.Side || polyModule.default?.Side;

      const orderResp = await this.clobClient.createAndPostOrder(
        {
          tokenID: tokenId,
          price: signal.buyPrice,
          side: Side.BUY,
          size: parseFloat(size.toFixed(2)),
        },
        {
          tickSize: signal.tickSize,
          negRisk: signal.negRisk,
        },
        OrderType.GTC,
      );

      this.tradedTokenIds.add(tokenId);
      this.dailyTradeCount++;

      this.log.info(
        `ORDER PLACED on Polymarket: ${signal.question} | ` +
        `Side: BUY ${signal.tokenIndex === 0 ? "YES" : "NO"} | ` +
        `Price: $${signal.buyPrice} | Edge: ${signal.edge} | ` +
        `Size: ${size.toFixed(2)} shares`
      );

      this.recordTrade(signal, orderResp);
      await this.notify(
        `🎯 Polymarket Trade: ${signal.question}\n` +
        `BUY ${signal.tokenIndex === 0 ? "YES" : "NO"} @ $${signal.buyPrice}\n` +
        `Edge: ${signal.edge} | Gap: ${signal.gapPercent}%`
      );

      return orderResp;
    } catch (err) {
      this.log.error(`Order failed: ${err.message}`);
      return null;
    }
  }

  // --- Main Trading Loop ---
  async runCycle() {
    // Reset daily counters
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.dailyTradeCount = 0;
      this.tradedTokenIds.clear();
      this.lastResetDate = today;
    }

    this.log.info("=== Polymarket scan cycle ===");

    // 1. Discover crypto markets
    const markets = await this.discoverCryptoMarkets();
    if (markets.length === 0) {
      this.log.info("No crypto markets found");
      return;
    }

    // 2. Get current prices
    const btcPrice = await this.getCurrentPrice("BTC");
    const ethPrice = await this.getCurrentPrice("ETH");
    this.log.info(`Prices — BTC: $${btcPrice || "N/A"}, ETH: $${ethPrice || "N/A"}`);

    // 3. Analyze each market
    const signals = [];
    for (const market of markets) {
      const question = (market.question || "").toLowerCase();
      const asset = question.includes("btc") || question.includes("bitcoin") ? "BTC" :
                    question.includes("eth") || question.includes("ethereum") ? "ETH" : null;
      const price = asset === "BTC" ? btcPrice : asset === "ETH" ? ethPrice : null;

      if (!price) continue;

      const signal = this.analyzeMarket(market, price);
      if (signal) {
        signals.push(signal);
        this.log.info(
          `SIGNAL: ${signal.question} | Edge: ${signal.edge} | ` +
          `${signal.tokenIndex === 0 ? "YES" : "NO"} @ $${signal.buyPrice}`
        );
      }
    }

    this.log.info(`Found ${signals.length} tradeable signals from ${markets.length} markets`);

    // 4. Execute trades, sorted by highest edge first
    signals.sort((a, b) => parseFloat(b.edge) - parseFloat(a.edge));

    for (const signal of signals.slice(0, 3)) { // max 3 trades per cycle
      await this.executeTrade(signal);
    }

    // 5. Check existing positions
    await this.checkPositions();
  }

  // --- Position Tracking ---
  async checkPositions() {
    if (!this.clobClient) return;

    try {
      const orders = await this.clobClient.getOrders({});
      if (orders && orders.length > 0) {
        this.log.info(`Open orders: ${orders.length}`);
      }
    } catch (err) {
      // Silently handle — may not have auth
    }
  }

  // --- Persistence ---
  recordTrade(signal, response) {
    try {
      let journal = [];
      if (fs.existsSync(JOURNAL_FILE)) {
        journal = JSON.parse(fs.readFileSync(JOURNAL_FILE, "utf8"));
      }
      journal.push({
        timestamp: new Date().toISOString(),
        platform: "polymarket",
        market: signal.question,
        side: signal.side,
        tokenIndex: signal.tokenIndex,
        price: signal.buyPrice,
        edge: signal.edge,
        currentAssetPrice: signal.currentPrice,
        threshold: signal.threshold,
        gapPercent: signal.gapPercent,
        response: response ? JSON.stringify(response).slice(0, 200) : null,
      });
      fs.writeFileSync(JOURNAL_FILE, JSON.stringify(journal, null, 2));
    } catch (err) {
      this.log.warn(`Journal write error: ${err.message}`);
    }
  }

  saveState() {
    try {
      const state = {
        dailyTradeCount: this.dailyTradeCount,
        lastResetDate: this.lastResetDate,
        tradedTokenIds: [...this.tradedTokenIds],
        savedAt: new Date().toISOString(),
      };
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
      this.log.warn(`State save error: ${err.message}`);
    }
  }

  loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
        this.dailyTradeCount = state.dailyTradeCount || 0;
        this.lastResetDate = state.lastResetDate || new Date().toDateString();
        (state.tradedTokenIds || []).forEach((id) => this.tradedTokenIds.add(id));
      }
    } catch (err) {
      this.log.warn(`State load error: ${err.message}`);
    }
  }

  // --- Notifications ---
  async notify(message) {
    for (const notifier of this.notifiers) {
      try {
        await notifier.send(message);
      } catch (err) {
        this.log.warn(`Notification error: ${err.message}`);
      }
    }
  }
}

// --- Standalone Runner ---
async function main() {
  const trader = new PolymarketTrader({
    config: {
      maxOrderSize: parseFloat(process.env.POLYMARKET_ORDER_SIZE || "5"),
      maxDailyTrades: parseInt(process.env.POLYMARKET_MAX_TRADES || "10"),
      minEdge: parseFloat(process.env.POLYMARKET_MIN_EDGE || "0.08"),
    },
  });

  trader.loadState();

  const initialized = await trader.init();
  if (!initialized) {
    console.error("Failed to initialize Polymarket trader");
    process.exit(1);
  }

  // Run immediately
  await trader.runCycle();

  // Then every 10 minutes
  cron.schedule("*/10 * * * *", async () => {
    try {
      await trader.runCycle();
      trader.saveState();
    } catch (err) {
      console.error("Polymarket cycle error:", err.message);
    }
  });

  console.log("Polymarket trader running — scanning every 10 minutes");
}

main().catch(console.error);

module.exports = { PolymarketTrader };
