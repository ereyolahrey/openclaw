/**
 * Ecommerce Income Agent
 *
 * Generates digital products and manages an online store via Gumroad API.
 * Creates AI-powered digital products:
 * - Trading strategy guides (based on our actual Bayse/Polymarket data)
 * - Crypto market analysis reports (daily/weekly)
 * - Code templates & developer tools
 * - Data analysis templates
 *
 * Also monitors for dropshipping/print-on-demand opportunities.
 * Revenue: Direct digital product sales via Gumroad
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
const PRODUCTS_FILE = path.join(DATA_DIR, "ecommerce-products.json");
const REVENUE_FILE = path.join(DATA_DIR, "ecommerce-revenue.json");

// Gumroad API
const GUMROAD_API = "https://api.gumroad.com/v2";

// Product templates — AI generates content for these categories
const PRODUCT_TEMPLATES = [
  {
    category: "trading-guide",
    name: "Crypto Prediction Market Trading Blueprint",
    description: "Data-backed strategies for trading 15-minute and hourly crypto prediction markets. Includes microstructure analysis, gap scoring, momentum detection, and risk management. Based on real trading data from Bayse Markets.",
    price: 499, // cents
    tags: ["crypto", "trading", "prediction-markets", "strategy"],
  },
  {
    category: "market-report",
    name: "Weekly Crypto Market Intelligence Report",
    description: "AI-generated weekly analysis of BTC, ETH, and FX markets. Includes price projections, volatility analysis, support/resistance levels, and prediction market sentiment data.",
    price: 299,
    tags: ["crypto", "analysis", "weekly-report", "market-data"],
  },
  {
    category: "bot-template",
    name: "Prediction Market Trading Bot Starter Kit",
    description: "Node.js template for building your own prediction market trading bot. Includes Bayse Markets integration, CoinGecko data feeds, technical analysis engine, and PM2 deployment configs.",
    price: 1999,
    tags: ["code", "nodejs", "trading-bot", "template"],
  },
  {
    category: "fx-guide",
    name: "FX Hourly Prediction Markets: Complete Strategy Guide",
    description: "Master GBP/USD, EUR/GBP, EUR/USD, and USD/NGN hourly prediction markets. Covers fundamental analysis, news-driven volatility, and automated entry/exit timing.",
    price: 399,
    tags: ["forex", "fx", "trading", "prediction-markets"],
  },
  {
    category: "token-guide",
    name: "Token Launch Playbook: Bankr + Clanker Edition",
    description: "Step-by-step guide to launching tokens on Base chain using Bankr CLI and Clanker SDK. Covers tokenomics, fee collection, marketing, and automation.",
    price: 799,
    tags: ["crypto", "token-launch", "base-chain", "defi"],
  },
  {
    category: "automation-kit",
    name: "Income Automation Toolkit: AI Agent Templates",
    description: "Collection of Node.js agent templates for automated income generation. Includes market traders, token launchers, content generators, and task workers. PM2-ready.",
    price: 2499,
    tags: ["automation", "ai-agents", "nodejs", "income"],
  },
  {
    category: "data-template",
    name: "Crypto Trading Journal & Analytics Dashboard",
    description: "Spreadsheet + code templates for tracking and analyzing your prediction market trades. Auto-calculates win rate, ROI, signal accuracy, and optimal timing windows.",
    price: 199,
    tags: ["spreadsheet", "analytics", "trading-journal", "data"],
  },
];

class EcommerceAgent {
  constructor({ notifiers = [], config = {} }) {
    this.notifiers = notifiers;
    this.config = {
      maxProductsPerDay: config.maxProductsPerDay || 2,
      gumroadToken: config.gumroadToken || process.env.GUMROAD_ACCESS_TOKEN || null,
      ...config,
    };
    this.log = new Logger("ecommerce");
    this.products = [];
    this.dailyProductCount = 0;
    this.lastResetDate = new Date().toDateString();
  }

  // --- Initialization ---
  async init() {
    this.log.info("Initializing ecommerce agent...");
    this.loadProducts();

    if (this.config.gumroadToken) {
      this.log.info("Gumroad API token configured — full store management enabled");
      await this.syncGumroadProducts();
    } else {
      this.log.info(
        "No GUMROAD_ACCESS_TOKEN set. Running in product generation mode. " +
        "Set GUMROAD_ACCESS_TOKEN in .env to enable auto-listing."
      );
    }

    return true;
  }

  // --- Gumroad API ---
  async syncGumroadProducts() {
    if (!this.config.gumroadToken) return;

    try {
      const resp = await httpClient.get(`${GUMROAD_API}/products`, {
        params: { access_token: this.config.gumroadToken },
      });

      const gumroadProducts = resp.data?.products || [];
      this.log.info(`Synced ${gumroadProducts.length} products from Gumroad`);

      // Track existing products to avoid duplicates
      for (const p of gumroadProducts) {
        const existing = this.products.find((lp) => lp.gumroadId === p.id);
        if (!existing) {
          this.products.push({
            gumroadId: p.id,
            name: p.name,
            price: p.price,
            sales: p.sales_count,
            revenue: p.sales_usd_cents,
            url: p.short_url,
            listed: true,
            createdAt: p.created_at,
          });
        }
      }
      this.saveProducts();
    } catch (err) {
      this.log.error(`Gumroad sync error: ${err.message}`);
    }
  }

  async createGumroadProduct(template) {
    if (!this.config.gumroadToken) {
      this.log.info(`[DRY RUN] Would create product: ${template.name}`);
      return { dryRun: true, name: template.name };
    }

    try {
      const resp = await httpClient.post(`${GUMROAD_API}/products`, null, {
        params: {
          access_token: this.config.gumroadToken,
          name: template.name,
          description: template.description,
          price: template.price,
          tags: template.tags.join(","),
        },
      });

      const product = resp.data?.product;
      if (product) {
        this.log.info(`Created Gumroad product: ${product.name} — ${product.short_url}`);
        this.products.push({
          gumroadId: product.id,
          name: product.name,
          price: product.price,
          sales: 0,
          revenue: 0,
          url: product.short_url,
          listed: true,
          createdAt: new Date().toISOString(),
          category: template.category,
        });
        this.saveProducts();
        return product;
      }
    } catch (err) {
      this.log.error(`Gumroad create error: ${err.message}`);
    }
    return null;
  }

  // --- Product Content Generation ---
  generateMarketReport() {
    const now = new Date();
    const weekNum = Math.ceil(
      (now - new Date(now.getFullYear(), 0, 1)) / (7 * 24 * 60 * 60 * 1000)
    );

    // Generate analysis content from our trading data
    let tradeData = [];
    const journalFiles = [
      path.join(DATA_DIR, "trade-journal.json"),
      path.join(DATA_DIR, "multi-asset-journal.json"),
      path.join(DATA_DIR, "polymarket-journal.json"),
    ];

    for (const jf of journalFiles) {
      try {
        if (fs.existsSync(jf)) {
          const data = JSON.parse(fs.readFileSync(jf, "utf8"));
          tradeData = tradeData.concat(data);
        }
      } catch (err) { /* skip */ }
    }

    const recentTrades = tradeData.filter((t) => {
      const age = Date.now() - new Date(t.timestamp).getTime();
      return age < 7 * 24 * 60 * 60 * 1000; // last 7 days
    });

    const report = {
      title: `Crypto Market Intelligence — Week ${weekNum}, ${now.getFullYear()}`,
      generated: now.toISOString(),
      summary: {
        totalTradesAnalyzed: recentTrades.length,
        platforms: [...new Set(recentTrades.map((t) => t.platform || "bayse"))],
      },
      content: `Weekly crypto prediction market analysis based on ${recentTrades.length} trades across multiple platforms.`,
    };

    return report;
  }

  // --- Revenue Tracking ---
  async checkRevenue() {
    if (!this.config.gumroadToken) return;

    try {
      const resp = await httpClient.get(`${GUMROAD_API}/products`, {
        params: { access_token: this.config.gumroadToken },
      });

      const products = resp.data?.products || [];
      let totalRevenue = 0;
      let totalSales = 0;

      for (const p of products) {
        totalRevenue += p.sales_usd_cents || 0;
        totalSales += p.sales_count || 0;
      }

      this.log.info(
        `Revenue check — Products: ${products.length} | ` +
        `Sales: ${totalSales} | Revenue: $${(totalRevenue / 100).toFixed(2)}`
      );

      // Record revenue snapshot
      this.recordRevenue(totalRevenue, totalSales, products.length);

      if (totalSales > 0) {
        await this.notify(
          `💰 Ecommerce Revenue Update\n` +
          `Products: ${products.length} | Sales: ${totalSales}\n` +
          `Total Revenue: $${(totalRevenue / 100).toFixed(2)}`
        );
      }
    } catch (err) {
      this.log.error(`Revenue check error: ${err.message}`);
    }
  }

  recordRevenue(totalCents, totalSales, productCount) {
    try {
      let history = [];
      if (fs.existsSync(REVENUE_FILE)) {
        history = JSON.parse(fs.readFileSync(REVENUE_FILE, "utf8"));
      }
      history.push({
        timestamp: new Date().toISOString(),
        revenueCents: totalCents,
        sales: totalSales,
        products: productCount,
      });
      // Keep last 365 entries
      if (history.length > 365) history = history.slice(-365);
      fs.writeFileSync(REVENUE_FILE, JSON.stringify(history, null, 2));
    } catch (err) {
      this.log.warn(`Revenue record error: ${err.message}`);
    }
  }

  // --- Main Cycle ---
  async runCycle() {
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.dailyProductCount = 0;
      this.lastResetDate = today;
    }

    this.log.info("=== Ecommerce cycle ===");

    // 1. Check for products not yet created
    const existingNames = new Set(this.products.map((p) => p.name));
    const pendingTemplates = PRODUCT_TEMPLATES.filter(
      (t) => !existingNames.has(t.name)
    );

    if (pendingTemplates.length > 0 && this.dailyProductCount < this.config.maxProductsPerDay) {
      const template = pendingTemplates[0];
      this.log.info(`Creating product: ${template.name}`);
      await this.createGumroadProduct(template);
      this.dailyProductCount++;
    }

    // 2. Generate weekly report if it's Monday
    const now = new Date();
    if (now.getDay() === 1 && now.getHours() === 8) {
      const report = this.generateMarketReport();
      this.log.info(`Generated weekly report: ${report.title}`);
    }

    // 3. Check revenue
    await this.checkRevenue();

    // 4. Log status
    this.log.info(
      `Products: ${this.products.length} | ` +
      `Templates remaining: ${pendingTemplates.length} | ` +
      `Daily created: ${this.dailyProductCount}`
    );
  }

  // --- Persistence ---
  loadProducts() {
    try {
      if (fs.existsSync(PRODUCTS_FILE)) {
        this.products = JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8"));
        this.log.info(`Loaded ${this.products.length} products from disk`);
      }
    } catch (err) {
      this.log.warn(`Products load error: ${err.message}`);
      this.products = [];
    }
  }

  saveProducts() {
    try {
      fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(this.products, null, 2));
    } catch (err) {
      this.log.warn(`Products save error: ${err.message}`);
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
  const agent = new EcommerceAgent({
    config: {
      maxProductsPerDay: parseInt(process.env.ECOMMERCE_MAX_PRODUCTS || "2"),
    },
  });

  await agent.init();

  // Run immediately
  await agent.runCycle();

  // Run every 2 hours
  cron.schedule("0 */2 * * *", async () => {
    try {
      await agent.runCycle();
    } catch (err) {
      console.error("Ecommerce cycle error:", err.message);
    }
  });

  console.log("Ecommerce agent running — product management every 2 hours");
}

main().catch(console.error);

module.exports = { EcommerceAgent };
