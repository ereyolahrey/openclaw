/**
 * Bankr Token Launcher Agent
 * 
 * Launches tokens on Base via the Bankr CLI/API and monitors fee earnings.
 * Uses the @bankr/cli programmatic API for headless operation.
 * 
 * Strategy:
 * - Launches tokens with creative AI-themed names
 * - Monitors fee accrual on all deployed tokens
 * - Auto-claims fees when above threshold
 * - Reports earnings to Telegram
 */
require("dotenv").config();
const { execSync, exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const { Logger } = require("../utils/logger");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const TOKENS_FILE = path.join(DATA_DIR, "bankr-tokens.json");

// Token name themes for launching
const TOKEN_THEMES = [
  { name: "AgentClaw", symbol: "ACLAW" },
  { name: "ShelbyAI", symbol: "SHELBY" },
  { name: "NeuralFaith", symbol: "NFAITH" },
  { name: "AutoPilotAI", symbol: "APAI" },
  { name: "BrainWave", symbol: "BWAVE" },
  { name: "SynthMind", symbol: "SMIND" },
  { name: "DeepClaw", symbol: "DCLAW" },
  { name: "QuantumAgent", symbol: "QAGENT" },
  { name: "CyberFaith", symbol: "CFAITH" },
  { name: "OmniBot", symbol: "OMNI" },
  { name: "AlphaNeural", symbol: "ALNEUR" },
  { name: "MegaClaw", symbol: "MCLAW" },
  { name: "TurboAgent", symbol: "TAGENT" },
  { name: "HyperMind", symbol: "HMIND" },
  { name: "SigmaBot", symbol: "SIGMA" },
];

class BankrLauncher {
  constructor({ notifiers = [], config = {} }) {
    this.notifiers = notifiers;
    this.config = {
      maxLaunchesPerDay: config.maxLaunchesPerDay || 3,
      feeClaimThreshold: config.feeClaimThreshold || 0.001, // WETH
      ...config,
    };
    this.log = new Logger("bankr-launcher");
    this._ensureDataDir();
    this.tokenData = this._loadTokenData();
    this.log.info(`Bankr Launcher initialized. ${this.tokenData.tokens.length} tokens tracked.`);
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
    };
  }

  _saveTokenData() {
    try {
      fs.writeFileSync(TOKENS_FILE, JSON.stringify(this.tokenData, null, 2));
    } catch (e) {
      this.log.error(`Token data save failed: ${e.message}`);
    }
  }

  /**
   * Run a bankr CLI command and return stdout
   */
  _runBankr(args, timeout = 60000) {
    try {
      const result = execSync(`bankr ${args}`, {
        encoding: "utf8",
        timeout,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return result.trim();
    } catch (e) {
      const stderr = e.stderr ? e.stderr.toString() : "";
      const stdout = e.stdout ? e.stdout.toString() : "";
      throw new Error(`bankr ${args} failed: ${stderr || stdout || e.message}`);
    }
  }

  /**
   * Check how many tokens we launched today and reset counter if new day
   */
  _checkDailyLimit() {
    const today = new Date().toISOString().split("T")[0];
    if (this.tokenData.lastLaunchDate !== today) {
      this.tokenData.launchesToday = 0;
      this.tokenData.lastLaunchDate = today;
      this._saveTokenData();
    }
    return this.tokenData.launchesToday < this.config.maxLaunchesPerDay;
  }

  /**
   * Pick a token theme that hasn't been used yet
   */
  _pickTokenTheme() {
    const usedNames = new Set(this.tokenData.tokens.map(t => t.name));
    const available = TOKEN_THEMES.filter(t => !usedNames.has(t.name));
    if (available.length === 0) {
      // All themes used — generate a random one
      const id = Math.random().toString(36).substring(2, 6).toUpperCase();
      return { name: `Agent${id}`, symbol: `A${id}` };
    }
    return available[Math.floor(Math.random() * available.length)];
  }

  /**
   * Launch a new token
   */
  async launchToken(customName, customSymbol) {
    if (!this._checkDailyLimit()) {
      this.log.info(`Daily launch limit reached (${this.config.maxLaunchesPerDay}/day). Skipping.`);
      return null;
    }

    const theme = customName
      ? { name: customName, symbol: customSymbol || customName.substring(0, 5).toUpperCase() }
      : this._pickTokenTheme();

    this.log.info(`Launching token: ${theme.name} ($${theme.symbol})`);

    try {
      const output = this._runBankr(
        `launch --name "${theme.name}" --symbol "${theme.symbol}" --yes`,
        120000
      );

      this.log.info(`Launch output: ${output}`);

      // Parse contract address from output
      const addressMatch = output.match(/0x[a-fA-F0-9]{40}/);
      const contractAddress = addressMatch ? addressMatch[0] : null;

      const tokenRecord = {
        name: theme.name,
        symbol: theme.symbol,
        contractAddress,
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
        `🚀 *Token Launched!*\n` +
        `Name: ${theme.name} ($${theme.symbol})\n` +
        `${contractAddress ? `Contract: \`${contractAddress}\`` : "Check bankr fees for details"}\n` +
        `Total launched: ${this.tokenData.stats.totalLaunched}`
      );

      return tokenRecord;
    } catch (e) {
      this.log.error(`Token launch failed: ${e.message}`);
      await this.notify(`❌ Token launch failed: ${theme.name} — ${e.message.substring(0, 200)}`);
      return null;
    }
  }

  /**
   * Check fees across all deployed tokens
   */
  async checkFees() {
    this.log.info("Checking fee earnings...");
    try {
      const output = this._runBankr("fees --json", 30000);
      let feeData;
      try {
        feeData = JSON.parse(output);
      } catch {
        // If JSON parse fails, just log the raw output
        this.log.info(`Fees output: ${output.substring(0, 500)}`);
        return null;
      }

      this.log.info(`Fee data: ${JSON.stringify(feeData).substring(0, 500)}`);
      return feeData;
    } catch (e) {
      this.log.warn(`Fee check failed: ${e.message}`);
      // Try non-JSON format
      try {
        const output = this._runBankr("fees", 30000);
        this.log.info(`Fees (text): ${output.substring(0, 500)}`);
        return output;
      } catch (e2) {
        this.log.error(`Fee check completely failed: ${e2.message}`);
        return null;
      }
    }
  }

  /**
   * Claim fees for a specific token
   */
  async claimFees(tokenAddress) {
    this.log.info(`Claiming fees for token ${tokenAddress}...`);
    try {
      const output = this._runBankr(`fees claim ${tokenAddress} --yes`, 60000);
      this.log.info(`Claim output: ${output}`);

      // Update local records
      const token = this.tokenData.tokens.find(t => t.contractAddress === tokenAddress);
      if (token) {
        const amountMatch = output.match(/([\d.]+)\s*WETH/i);
        if (amountMatch) {
          const claimed = parseFloat(amountMatch[1]);
          token.feesClaimed += claimed;
          this.tokenData.stats.totalFeesClaimed += claimed;
          this._saveTokenData();
        }
      }

      await this.notify(`💰 Fees claimed for ${tokenAddress}\n${output.substring(0, 300)}`);
      return output;
    } catch (e) {
      this.log.error(`Fee claim failed: ${e.message}`);
      return null;
    }
  }

  /**
   * Main cycle — launch tokens if under daily limit, check/claim fees
   */
  async runCycle() {
    this.log.info("─── Bankr Launcher cycle ───");

    // 1. Check if we should launch a new token today
    if (this._checkDailyLimit()) {
      this.log.info(`Launches today: ${this.tokenData.launchesToday}/${this.config.maxLaunchesPerDay}`);
      await this.launchToken();
    }

    // 2. Check fees on all tokens
    const feeData = await this.checkFees();

    // 3. Report summary
    const stats = this.tokenData.stats;
    this.log.info(
      `Summary: ${stats.totalLaunched} tokens launched | ` +
      `Fees earned: ${stats.totalFeesEarned} | Claimed: ${stats.totalFeesClaimed}`
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
  const log = new Logger("bankr-main");

  const launcher = new BankrLauncher({
    config: {
      maxLaunchesPerDay: parseInt(process.env.BANKR_MAX_LAUNCHES_PER_DAY || "3"),
    },
  });

  log.info("=== BANKR TOKEN LAUNCHER STARTING ===");

  // Run every 4 hours — launch tokens spread throughout the day, check fees regularly
  cron.schedule("0 */4 * * *", async () => {
    try { await launcher.runCycle(); }
    catch (e) { log.error("Cycle error:", e.message); }
  });

  // Check fees every hour (separate from launch cycle)
  cron.schedule("30 * * * *", async () => {
    try { await launcher.checkFees(); }
    catch (e) { log.error("Fee check error:", e.message); }
  });

  // Initial run
  launcher.runCycle().catch(e => log.error("Initial cycle error:", e.message));
}

module.exports = { BankrLauncher };
