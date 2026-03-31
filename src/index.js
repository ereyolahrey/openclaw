require("./utils/dns-fix"); // Use Google/Cloudflare DNS — ISP DNS is unreliable
require("dotenv").config();
const cron = require("node-cron");
const path = require("path");
const { TelegramAdapter } = require("./adapters/telegram");
const { BTCTraderAgent } = require("./agents/btc-trader");
const { OpenClawBridge } = require("./bridge/openclaw");
const { Logger } = require("./utils/logger");

const log = new Logger("main");

async function main() {
  log.info("=== OPENCLAW AGENTS STARTING ===");

  const bridge = new OpenClawBridge({
    gatewayUrl: process.env.OPENCLAW_GATEWAY_URL,
    token: process.env.OPENCLAW_GATEWAY_TOKEN,
  });
  const gw = await bridge.connect();
  if (!gw) log.warn("Gateway offline — LLM queries will fail. Using pure TA.");

  const telegram = new TelegramAdapter({
    token: process.env.TELEGRAM_BOT_TOKEN,
    allowedChatIds: (process.env.TELEGRAM_ALLOWED_CHAT_IDS || "").split(",").filter(Boolean),
    bridge,
  });

  const trader = new BTCTraderAgent({
    bridge,
    notifiers: [telegram],
    config: {
      asset: "BTC",
      interval: "15m",
      maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE || "500"),
      riskPercent: parseFloat(process.env.RISK_PERCENT || "2"),
    },
  });

  await telegram.start();
  log.info("Telegram adapter initialized.");

  // Poll every minute — the trader itself waits for the 4-5 min window before close
  cron.schedule("* * * * *", async () => {
    try { await trader.runCycle(); }
    catch (e) { log.error("Cycle error:", e.message); try { await trader.notify(`Error: ${e.message}`); } catch {} }
  });

  log.info("Running initial BTC cycle...");
  try { await trader.runCycle(); } catch (e) { log.error("Initial cycle error:", e.message); }

  log.info("=== BOT LIVE — RUNNING 24/7 ===");
  log.info(`  BTC Trader: polls every minute, trades at 4-5 min before close`);
  log.info(`  Telegram: active`);
}

process.on("uncaughtException", (e) => { console.error("[UNCAUGHT]", e.message); });
process.on("unhandledRejection", (e) => { console.error("[UNHANDLED]", e); });

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
