const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { Logger } = require("../utils/logger");

class WhatsAppAdapter {
  constructor({ sessionPath, bridge }) {
    this.sessionPath = sessionPath;
    this.bridge = bridge;
    this.logger = new Logger("whatsapp");
    this.client = null;
    this.subs = new Set();
    this.ready = false;
  }

  async start() {
    try {
      this.client = new Client({
        authStrategy: new LocalAuth({ dataPath: this.sessionPath }),
        puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] },
      });

      this.client.on("qr", (qr) => {
        this.logger.info("Scan this QR code with WhatsApp (Settings > Linked Devices > Link a Device):");
        qrcode.generate(qr, { small: true });
      });

      this.client.on("ready", () => {
        this.ready = true;
        this.logger.info("WhatsApp connected successfully!");
      });

      this.client.on("disconnected", (reason) => {
        this.ready = false;
        this.logger.warn(`WhatsApp disconnected: ${reason}`);
      });

      this.client.on("message", async (msg) => {
        if (msg.fromMe) return;
        const text = msg.body || "";
        if (!text) return;
        const chatId = msg.from;

        if (text.toLowerCase() === "/subscribe") {
          this.subs.add(chatId);
          return msg.reply("Subscribed to BTC 15min alerts");
        }
        if (text.toLowerCase() === "/unsubscribe") {
          this.subs.delete(chatId);
          return msg.reply("Unsubscribed");
        }
        if (text.toLowerCase() === "/status") {
          try {
            const r = await this.bridge.query("btc-trader", "Brief BTC market status now.");
            return msg.reply(r);
          } catch (e) { return msg.reply("Error: " + e.message); }
        }

        try {
          const r = await this.bridge.query("messenger", text);
          await msg.reply(r);
        } catch (e) {
          await msg.reply("Error: " + e.message);
        }
      });

      await this.client.initialize();
    } catch (err) {
      this.logger.error("WhatsApp init failed:", err.message);
      this.logger.info("WhatsApp unavailable. Bot continues without it.");
    }
  }

  async broadcast(msg) {
    if (!this.client || !this.ready) return;
    for (const chatId of this.subs) {
      try { await this.client.sendMessage(chatId, msg); }
      catch (e) { this.logger.warn(`WA send fail [${chatId}]:`, e.message); }
    }
  }
}
module.exports = { WhatsAppAdapter };
