/**
 * Bayse Markets API Client
 * 
 * Handles HMAC-SHA256 signed requests to relay.bayse.markets
 * Signing format: {timestamp}.{METHOD}.{path}.{sha256hex(body)}
 * Signature encoding: base64
 */
const axios = require("axios");
const crypto = require("crypto");
const { Logger } = require("./logger");

class BayseClient {
  constructor() {
    this.logger = new Logger("bayse-api");
    this.baseUrl = process.env.BAYSE_API_BASE_URL || "https://relay.bayse.markets";
    this.publicKey = process.env.BAYSE_PUBLIC_KEY;
    this.secretKey = process.env.BAYSE_SECRET_KEY;

    if (!this.publicKey || !this.secretKey) {
      this.logger.warn("Bayse API keys not configured — trading will be disabled.");
    }
  }

  sign(method, path, rawBody = "") {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const bodyHash = crypto.createHash("sha256").update(rawBody).digest("hex");
    const payload = `${timestamp}.${method.toUpperCase()}.${path}.${bodyHash}`;
    const signature = crypto.createHmac("sha256", this.secretKey).update(payload).digest("base64");
    return {
      "X-Public-Key": this.publicKey,
      "X-Timestamp": timestamp,
      "X-Signature": signature,
      "Content-Type": "application/json",
    };
  }

  async get(path, params = {}) {
    const headers = this.sign("GET", path, "");
    const res = await axios.get(`${this.baseUrl}${path}`, { headers, params, timeout: 30000 });
    return res.data;
  }

  async post(path, body) {
    const rawBody = JSON.stringify(body);
    const headers = this.sign("POST", path, rawBody);
    const res = await axios({
      method: "POST",
      url: `${this.baseUrl}${path}`,
      headers,
      data: rawBody,
      timeout: 30000,
    });
    return res.data;
  }

  /**
   * Get all open events, optionally filtered
   */
  async getEvents(params = {}) {
    const data = await this.get("/v1/pm/events", { limit: 200, ...params });
    return data.events || data.data || [];
  }

  /**
   * Find the current open BTC 15-minute prediction market
   */
  async getCurrentBTC15mEvent() {
    return this._findCurrentEvent("BTCUSDT", "FIFTEEN_MINUTES");
  }

  /**
   * Find the current open ETH 15-minute prediction market
   */
  async getCurrentETH15mEvent() {
    return this._findCurrentEvent("ETHUSD", "FIFTEEN_MINUTES");
  }

  /**
   * Find the current open BTC hourly prediction market
   */
  async getCurrentBTCHourlyEvent() {
    return this._findCurrentEvent("BTCUSDT", "HOURLY");
  }

  /**
   * Find the current open ETH hourly prediction market
   */
  async getCurrentETHHourlyEvent() {
    return this._findCurrentEvent("ETHUSD", "HOURLY");
  }

  /**
   * Find current open FX hourly events (GBPUSD, EURGBP, EURUSD, USDNGN)
   */
  async getCurrentFXHourlyEvents() {
    const fxPairs = ["GBPUSD", "EURGBP", "EURUSD", "USDNGN"];
    const events = await this.getEvents();
    const results = [];
    for (const pair of fxPairs) {
      const match = events
        .filter(e => e.assetSymbolPair === pair && e.countdownType === "HOURLY" && e.status === "open")
        .sort((a, b) => new Date(a.closingDate) - new Date(b.closingDate));
      if (match.length > 0) results.push(match[0]);
    }
    return results;
  }

  /**
   * Get ALL tradable countdown events (crypto + FX, both 15min and hourly)
   */
  async getAllTradableEvents() {
    const events = await this.getEvents();
    const tradablePairs = ["BTCUSDT", "ETHUSD", "GBPUSD", "EURGBP", "EURUSD", "USDNGN"];
    const tradableTypes = ["FIFTEEN_MINUTES", "HOURLY"];
    return events
      .filter(e =>
        tradablePairs.includes(e.assetSymbolPair) &&
        tradableTypes.includes(e.countdownType) &&
        e.status === "open"
      )
      .sort((a, b) => new Date(a.closingDate) - new Date(b.closingDate));
  }

  /**
   * Internal helper: find current open event for specific pair + countdown
   */
  async _findCurrentEvent(assetSymbolPair, countdownType) {
    const events = await this.getEvents();
    const filtered = events.filter(e =>
      e.assetSymbolPair === assetSymbolPair &&
      e.countdownType === countdownType &&
      e.status === "open"
    );
    if (filtered.length === 0) return null;
    filtered.sort((a, b) => new Date(a.closingDate) - new Date(b.closingDate));
    return filtered[0];
  }

  /**
   * Place a market order on a prediction market
   * @param {string} eventId 
   * @param {string} marketId 
   * @param {string} outcomeId - UUID of the Up or Down outcome
   * @param {number} amount - NGN amount to wager
   * @returns {object} order response
   */
  async placeOrder(eventId, marketId, outcomeId, amount) {
    const path = `/v1/pm/events/${eventId}/markets/${marketId}/orders`;
    const body = {
      outcomeId,
      side: "BUY",
      type: "MARKET",
      amount: parseFloat(amount.toFixed(2)),
      currency: "NGN",
      timeInForce: "FOK",
    };

    this.logger.info(`Placing order: ${JSON.stringify(body)} on ${path}`);
    return await this.post(path, body);
  }

  /**
   * Get user's portfolio
   */
  async getPortfolio() {
    return await this.get("/v1/pm/portfolio");
  }

  /**
   * Get user's order history
   */
  async getOrders(params = {}) {
    return await this.get("/v1/pm/orders", params);
  }

  /**
   * Get user's activities (wins, losses, payouts)
   */
  async getActivities(params = {}) {
    return await this.get("/v1/pm/activities", params);
  }

  /**
   * Login with email/password to get session token (for operations that need it)
   */
  async login() {
    const email = process.env.BAYSE_EMAIL;
    const password = process.env.BAYSE_PASSWORD;
    if (!email || !password) throw new Error("BAYSE_EMAIL and BAYSE_PASSWORD required for login");

    const res = await axios.post(`${this.baseUrl}/v1/user/login`, { email, password }, {
      headers: { "Content-Type": "application/json" },
      timeout: 15000,
    });
    return res.data;
  }
}

module.exports = { BayseClient };
