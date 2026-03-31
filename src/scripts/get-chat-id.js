require("dotenv").config();
const axios = require("axios");

const token = process.env.TELEGRAM_BOT_TOKEN;
const url = `https://api.telegram.org/bot${token}/getUpdates`;

async function poll() {
  console.log("Waiting for a Telegram message... Send 'hi' to your bot now.");
  for (let i = 0; i < 30; i++) {
    const res = await axios.get(url, { params: { timeout: 2, offset: -1 } });
    if (res.data.result.length > 0) {
      const msg = res.data.result[0].message;
      if (msg) {
        console.log("Chat ID:", msg.chat.id);
        console.log("From:", msg.from.first_name, msg.from.last_name || "");
        console.log("Username:", msg.from.username || "none");
        return msg.chat.id;
      }
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log("No message received in 60s. Make sure you sent a message to the bot.");
}

poll().catch(e => console.error(e.message));
