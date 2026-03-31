const { Telegraf } = require("telegraf");
const { Logger } = require("../utils/logger");

class TelegramAdapter {
  constructor({ token, allowedChatIds, bridge }) {
    this.logger = new Logger("telegram");
    this.allowed = allowedChatIds.map(String);
    this.bridge = bridge;
    this.subs = new Set(this.allowed);
    this.bot = token ? new Telegraf(token) : null;

    if (this.bot) {
      this.bot.command("start", (c) => this.onStart(c));
      this.bot.command("status", (c) => this.onStatus(c));
      this.bot.command("subscribe", (c) => { this.subs.add(String(c.chat.id)); c.reply("Subscribed to BTC 15min alerts"); });
      this.bot.command("unsubscribe", (c) => { this.subs.delete(String(c.chat.id)); c.reply("Unsubscribed"); });
      this.bot.command("history", (c) => this.onHistory(c));
      this.bot.on("text", (c) => this.onText(c));
    }
  }

  ok(ctx) { return !this.allowed.length || this.allowed.includes(String(ctx.chat.id)); }

  async start() {
    if (!this.bot) { this.logger.warn("No Telegram token — skipping."); return; }
    this.bot.launch();
    this.logger.info("Telegram bot live.");
    process.once("SIGINT", () => this.bot.stop("SIGINT"));
    process.once("SIGTERM", () => this.bot.stop("SIGTERM"));
  }

  async onStart(ctx) {
    if (!this.ok(ctx)) return;
    ctx.reply("OpenClaw BTC Trader\n\n/status - Market status\n/subscribe - Get 15min alerts\n/unsubscribe - Stop alerts\n/history - Recent trades\n\nOr just ask anything about the market.", { parse_mode: "Markdown" });
  }

  async onStatus(ctx) {
    if (!this.ok(ctx)) return;
    try {
      const r = await this.bridge.query("btc-trader", "Give a brief BTC market status right now.");
      ctx.reply(r, { parse_mode: "Markdown" });
    } catch (e) { ctx.reply("Error: " + e.message); }
  }

  async onHistory(ctx) {
    if (!this.ok(ctx)) return;
    try {
      const r = await this.bridge.query("btc-trader", "Show the last 5 trades with results.");
      ctx.reply(r, { parse_mode: "Markdown" });
    } catch (e) { ctx.reply("Error: " + e.message); }
  }

  async onText(ctx) {
    if (!this.ok(ctx)) return;
    try {
      const r = await this.bridge.query("messenger", ctx.message.text);
      ctx.reply(r, { parse_mode: "Markdown" });
    } catch (e) { ctx.reply("Error: " + e.message); }
  }

  async broadcast(msg) {
    if (!this.bot) return;
    for (const id of this.subs) {
      try {
        await this.bot.telegram.sendMessage(id, msg, { parse_mode: "Markdown" });
      } catch (e) {
        // If Markdown parsing fails, retry as plain text
        if (e.message && e.message.includes("can't parse entities")) {
          try { await this.bot.telegram.sendMessage(id, msg); }
          catch (e2) { this.logger.warn(`Send fail [${id}]:`, e2.message); }
        } else {
          this.logger.warn(`Send fail [${id}]:`, e.message);
        }
      }
    }
  }
}
module.exports = { TelegramAdapter };
