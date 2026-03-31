/**
 * Clanker Token Launcher Agent
 *
 * Deploys tokens on Base via the Clanker SDK v4.
 * Earns creator rewards from trading fees on deployed tokens.
 *
 * Requires: clanker-sdk, viem, and a funded Base wallet (for gas)
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Logger } = require("../utils/logger");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const CLANKER_TOKENS_FILE = path.join(DATA_DIR, "clanker-tokens.json");

const TOKEN_THEMES = [
  { name: "ClawForge", symbol: "CFORGE" },
  { name: "NexusAI", symbol: "NEXAI" },
  { name: "PulseBot", symbol: "PULSE" },
  { name: "VortexMind", symbol: "VRTX" },
  { name: "AlphaForge", symbol: "AFRGE" },
  { name: "QuantBot", symbol: "QBOT" },
  { name: "NeonAgent", symbol: "NEON" },
  { name: "SparkMind", symbol: "SPARK" },
  { name: "ZenithAI", symbol: "ZNTH" },
  { name: "CosmicAgent", symbol: "COSMO" },
  { name: "BlitzBot", symbol: "BLITZ" },
  { name: "NovaClaw", symbol: "NOVA" },
  { name: "ThetaForge", symbol: "THETA" },
  { name: "HorizonAI", symbol: "HRZN" },
  { name: "EchoMind", symbol: "ECHO" },
];

class ClankerLauncher {
  constructor({ notifiers = [], config = {} }) {
    this.notifiers = notifiers;
    this.config = {
      maxLaunchesPerDay: config.maxLaunchesPerDay || 2,
      chainId: config.chainId || 8453, // Base
      rpcUrl: config.rpcUrl || "https://mainnet.base.org",
      ...config,
    };
    this.log = new Logger("clanker-launcher");
    this._ensureDataDir();
    this.tokenData = this._loadTokenData();
    this.log.info(`Clanker Launcher initialized. ${this.tokenData.tokens.length} tokens tracked.`);
  }

  _ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  _loadTokenData() {
    try {
      if (fs.existsSync(CLANKER_TOKENS_FILE)) return JSON.parse(fs.readFileSync(CLANKER_TOKENS_FILE, "utf8"));
    } catch {}
    return {
      tokens: [],
      stats: { totalLaunched: 0, totalFeesEarned: 0 },
      lastLaunchDate: null,
      launchesToday: 0,
    };
  }

  _saveTokenData() {
    try {
      fs.writeFileSync(CLANKER_TOKENS_FILE, JSON.stringify(this.tokenData, null, 2));
    } catch (e) {
      this.log.error(`Token data save failed: ${e.message}`);
    }
  }

  _checkDailyLimit() {
    const today = new Date().toISOString().split("T")[0];
    if (this.tokenData.lastLaunchDate !== today) {
      this.tokenData.launchesToday = 0;
      this.tokenData.lastLaunchDate = today;
      this._saveTokenData();
    }
    return this.tokenData.launchesToday < this.config.maxLaunchesPerDay;
  }

  _pickTokenTheme() {
    const usedNames = new Set(this.tokenData.tokens.map(t => t.name));
    const available = TOKEN_THEMES.filter(t => !usedNames.has(t.name));
    if (available.length === 0) {
      const id = Math.random().toString(36).substring(2, 6).toUpperCase();
      return { name: `Clanker${id}`, symbol: `CK${id}` };
    }
    return available[Math.floor(Math.random() * available.length)];
  }

  /**
   * Deploy a token on Base via clanker-sdk v4
   */
  async launchToken(customName, customSymbol) {
    if (!this._checkDailyLimit()) {
      this.log.info(`Daily launch limit reached (${this.config.maxLaunchesPerDay}/day). Skipping.`);
      return null;
    }

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      this.log.error("PRIVATE_KEY not set — cannot deploy token.");
      return null;
    }

    const theme = customName
      ? { name: customName, symbol: customSymbol || customName.substring(0, 5).toUpperCase() }
      : this._pickTokenTheme();

    this.log.info(`Deploying token via Clanker: ${theme.name} ($${theme.symbol}) on Base...`);

    try {
      // Dynamic imports for ESM clanker-sdk
      const { Clanker } = await import("clanker-sdk/v4");
      const { createWalletClient, createPublicClient, http } = await import("viem");
      const { privateKeyToAccount } = await import("viem/accounts");
      const { base } = await import("viem/chains");

      const account = privateKeyToAccount(privateKey);
      const publicClient = createPublicClient({ chain: base, transport: http(this.config.rpcUrl) });
      const wallet = createWalletClient({ account, chain: base, transport: http(this.config.rpcUrl) });

      const clanker = new Clanker({ publicClient, wallet });

      const { txHash, waitForTransaction, error } = await clanker.deploy({
        name: theme.name,
        symbol: theme.symbol,
        tokenAdmin: account.address,
        metadata: {
          description: `${theme.name} — AI-powered token deployed by OpenClaw Agent`,
        },
        context: {
          interface: "OpenClaw Agent",
        },
        rewards: {
          recipients: [
            {
              recipient: account.address,
              admin: account.address,
              bps: 10000, // 100% of rewards to us
              token: "Paired", // Take fees in WETH
            },
          ],
        },
      });

      if (error) {
        throw new Error(`Deploy error: ${error.message || error}`);
      }

      this.log.info(`Transaction sent: ${txHash}`);
      this.log.info("Waiting for deployment confirmation...");

      const result = await waitForTransaction();
      const tokenAddress = result.address;

      this.log.info(`Token deployed at: ${tokenAddress}`);

      const tokenRecord = {
        name: theme.name,
        symbol: theme.symbol,
        contractAddress: tokenAddress,
        txHash,
        chain: "base",
        chainId: 8453,
        launchedAt: new Date().toISOString(),
        deployer: account.address,
        feesEarned: 0,
      };

      this.tokenData.tokens.push(tokenRecord);
      this.tokenData.stats.totalLaunched++;
      this.tokenData.launchesToday++;
      this._saveTokenData();

      await this.notify(
        `🎯 *Clanker Token Deployed!*\n` +
        `Name: ${theme.name} ($${theme.symbol})\n` +
        `Contract: \`${tokenAddress}\`\n` +
        `Chain: Base\n` +
        `TX: ${txHash}\n` +
        `View: https://clanker.world/clanker/${tokenAddress}\n` +
        `Total launched: ${this.tokenData.stats.totalLaunched}`
      );

      return tokenRecord;
    } catch (e) {
      this.log.error(`Clanker deploy failed: ${e.message}`);
      await this.notify(`❌ Clanker deploy failed: ${theme.name} — ${e.message.substring(0, 200)}`);
      return null;
    }
  }

  /**
   * Main cycle — launch if under limit
   */
  async runCycle() {
    this.log.info("─── Clanker Launcher cycle ───");

    if (this._checkDailyLimit()) {
      this.log.info(`Launches today: ${this.tokenData.launchesToday}/${this.config.maxLaunchesPerDay}`);
      await this.launchToken();
    } else {
      this.log.info("Daily launch limit reached. Waiting for next day.");
    }

    this.log.info(
      `Summary: ${this.tokenData.stats.totalLaunched} launched | ` +
      `Fees earned: ${this.tokenData.stats.totalFeesEarned}`
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
    };
  }
}

// ── Standalone runner ──
if (require.main === module) {
  const cron = require("node-cron");
  const log = new Logger("clanker-main");

  const launcher = new ClankerLauncher({
    config: {
      maxLaunchesPerDay: parseInt(process.env.CLANKER_MAX_LAUNCHES_PER_DAY || "2"),
    },
  });

  log.info("=== CLANKER TOKEN LAUNCHER STARTING ===");

  // Run every 6 hours — launch tokens spread throughout the day
  cron.schedule("0 */6 * * *", async () => {
    try { await launcher.runCycle(); }
    catch (e) { log.error("Cycle error:", e.message); }
  });

  // Initial run
  launcher.runCycle().catch(e => log.error("Initial cycle error:", e.message));
}

module.exports = { ClankerLauncher };
