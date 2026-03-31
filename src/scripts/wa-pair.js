/**
 * WhatsApp pairing code test — standalone script
 * Uses Baileys v6 requestPairingCode API
 */
require("dotenv").config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const pino = require("pino");

const PHONE = "2347011628287"; // Nigerian country code + number

async function main() {
  const sessionPath = process.env.WHATSAPP_SESSION_PATH || "whatsapp-session";
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: "silent" }), // suppress noisy baileys logs
  });

  sock.ev.on("creds.update", saveCreds);

  // Request pairing code immediately if not registered
  if (!sock.authState.creds.registered) {
    // Request pairing code as soon as possible
    try {
      const code = await sock.requestPairingCode(PHONE);
      console.log("\n========================================");
      console.log("  PAIRING CODE:", code);
      console.log("========================================");
      console.log("\nOpen WhatsApp on your phone:");
      console.log("  Settings > Linked Devices > Link a Device");
      console.log("  Tap 'Link with phone number instead'");
      console.log("  Enter this code:", code);
      console.log("\nWaiting for you to enter the code...\n");
    } catch (err) {
      console.error("Failed to get pairing code:", err.message);
      process.exit(1);
    }
  }

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "open") {
      console.log("\n✅ WhatsApp connected successfully!");
      console.log("Session saved. You can now start the main bot.\n");
      // Wait a bit for creds to save then exit
      setTimeout(() => process.exit(0), 2000);
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log("Logged out. Run again to re-pair.");
        process.exit(1);
      }
      console.log("Disconnected (status:", code, ") — retrying...");
      // Retry with the saved session
      setTimeout(() => main(), 3000);
    }
  });
}

main().catch(console.error);
