/**
 * Token Image Generator + Pinata IPFS Uploader
 * Generates colorful token images with sharp and pins them to Pinata.
 * Returns IPFS URLs for use in bankr token launches.
 */
require("dotenv").config();
const sharp = require("sharp");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PINATA_JWT = process.env.PINATA_JWT;
const CACHE_FILE = path.join(__dirname, "..", "..", "data", "image-cache.json");

// Color palettes for different token categories
const PALETTES = {
  meme: [
    { bg: "#1a1a2e", fg: "#e94560", accent: "#0f3460" },
    { bg: "#0d1117", fg: "#58a6ff", accent: "#238636" },
    { bg: "#1e0533", fg: "#ff6ec7", accent: "#7b2ff7" },
    { bg: "#0a192f", fg: "#64ffda", accent: "#233554" },
    { bg: "#2d1b69", fg: "#f5c542", accent: "#ff6b6b" },
    { bg: "#0f0c29", fg: "#e44d26", accent: "#302b63" },
    { bg: "#141e30", fg: "#00d2ff", accent: "#243b55" },
    { bg: "#1a0023", fg: "#ff0099", accent: "#3d0066" },
  ],
  ai: [
    { bg: "#0a0e27", fg: "#00f5d4", accent: "#7209b7" },
    { bg: "#0d1117", fg: "#a855f7", accent: "#1e293b" },
    { bg: "#020617", fg: "#38bdf8", accent: "#0f172a" },
    { bg: "#0c0a1d", fg: "#06d6a0", accent: "#240046" },
  ],
  github: [
    { bg: "#0d1117", fg: "#f0f6fc", accent: "#238636" },
    { bg: "#161b22", fg: "#58a6ff", accent: "#1f6feb" },
    { bg: "#0d1117", fg: "#e6edf3", accent: "#da3633" },
  ],
  crypto: [
    { bg: "#0a0e27", fg: "#f7931a", accent: "#1a1a40" },
    { bg: "#0b0e11", fg: "#f0b90b", accent: "#1e2329" },
    { bg: "#0d1421", fg: "#627eea", accent: "#1a2744" },
  ],
};

function getPalette(category) {
  const palettes = PALETTES[category] || PALETTES.meme;
  return palettes[Math.floor(Math.random() * palettes.length)];
}

function getEmoji(name, symbol) {
  const n = (name + " " + symbol).toLowerCase();
  if (/frog|pepe|kek/.test(n)) return "🐸";
  if (/ape|monkey|bonk/.test(n)) return "🦍";
  if (/dog|inu|shib|doge/.test(n)) return "🐕";
  if (/cat|kitty|meow/.test(n)) return "🐱";
  if (/moon|lunar/.test(n)) return "🌙";
  if (/diamond/.test(n)) return "💎";
  if (/fire|burn/.test(n)) return "🔥";
  if (/robot|bot|auto/.test(n)) return "🤖";
  if (/brain|neural|ai|gpt|deep/.test(n)) return "🧠";
  if (/rocket|send|launch/.test(n)) return "🚀";
  if (/punk|degen/.test(n)) return "💀";
  if (/skull|doom/.test(n)) return "💀";
  if (/star|nova/.test(n)) return "⭐";
  if (/purple|pill/.test(n)) return "🟣";
  if (/anime/.test(n)) return "⛩️";
  if (/paper/.test(n)) return "📄";
  if (/grass/.test(n)) return "🌿";
  if (/chad|giga/.test(n)) return "👑";
  if (/matrix/.test(n)) return "🟩";
  if (/skynet|uprising/.test(n)) return "⚡";
  if (/docker|k8s|kube/.test(n)) return "🐳";
  if (/rust/.test(n)) return "🦀";
  if (/vite|bun|next/.test(n)) return "⚡";
  if (/foundry|eth/.test(n)) return "⟠";
  if (/flux|flow/.test(n)) return "🌊";
  if (/tariff|war/.test(n)) return "⚔️";
  if (/culture|based/.test(n)) return "🔵";
  if (/cope|seethe/.test(n)) return "😤";
  if (/pump/.test(n)) return "📈";
  if (/wojak/.test(n)) return "😢";
  if (/whisper|ollama|llama/.test(n)) return "🦙";
  if (/comfy/.test(n)) return "🎨";
  return ["🔥", "💎", "🚀", "⚡", "🌊", "💰", "🎯", "🌟"][Math.floor(Math.random() * 8)];
}

/**
 * Generate a token image as a PNG buffer using sharp
 */
async function generateTokenImage(name, symbol, category = "meme") {
  const palette = getPalette(category);
  const emoji = getEmoji(name, symbol);
  const displaySymbol = symbol.length > 6 ? symbol.slice(0, 6) : symbol;

  // SVG template — bold gradient background + large emoji + symbol
  const svg = `
<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="70%">
      <stop offset="0%" style="stop-color:${palette.accent};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${palette.bg};stop-opacity:1" />
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="40%" r="40%">
      <stop offset="0%" style="stop-color:${palette.fg};stop-opacity:0.3" />
      <stop offset="100%" style="stop-color:${palette.fg};stop-opacity:0" />
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="0" stdDeviation="8" flood-color="${palette.fg}" flood-opacity="0.5"/>
    </filter>
  </defs>
  <!-- Background -->
  <rect width="512" height="512" rx="64" fill="url(#bg)"/>
  <!-- Glow circle -->
  <circle cx="256" cy="210" r="180" fill="url(#glow)"/>
  <!-- Border ring -->
  <circle cx="256" cy="256" r="220" fill="none" stroke="${palette.fg}" stroke-width="3" opacity="0.3"/>
  <!-- Emoji -->
  <text x="256" y="240" font-size="160" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
  <!-- Symbol -->
  <text x="256" y="400" font-size="${displaySymbol.length > 5 ? 56 : 72}" font-weight="900" font-family="Arial,Helvetica,sans-serif" text-anchor="middle" fill="${palette.fg}" filter="url(#shadow)">$${displaySymbol}</text>
  <!-- Small name -->
  <text x="256" y="460" font-size="22" font-weight="600" font-family="Arial,Helvetica,sans-serif" text-anchor="middle" fill="${palette.fg}" opacity="0.6">${name.length > 25 ? name.slice(0, 22) + "..." : name}</text>
</svg>`;

  const pngBuffer = await sharp(Buffer.from(svg)).png({ quality: 90 }).toBuffer();
  return pngBuffer;
}

/**
 * Upload a buffer to Pinata IPFS
 */
function uploadToPinata(buffer, filename) {
  return new Promise((resolve, reject) => {
    if (!PINATA_JWT) return reject(new Error("PINATA_JWT not set"));

    // Multipart form-data boundary
    const boundary = "----PinataFormBoundary" + Math.random().toString(36).slice(2);

    const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;

    const headerBuf = Buffer.from(header, "utf8");
    const footerBuf = Buffer.from(footer, "utf8");
    const body = Buffer.concat([headerBuf, buffer, footerBuf]);

    const options = {
      hostname: "api.pinata.cloud",
      path: "/pinning/pinFileToIPFS",
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
        Authorization: `Bearer ${PINATA_JWT}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.IpfsHash) {
            resolve({
              hash: json.IpfsHash,
              url: `https://gateway.pinata.cloud/ipfs/${json.IpfsHash}`,
            });
          } else {
            reject(new Error(`Pinata error: ${data.substring(0, 300)}`));
          }
        } catch (e) {
          reject(new Error(`Pinata parse error: ${data.substring(0, 300)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Generate and upload a token image, with caching
 */
async function getTokenImageUrl(name, symbol, category = "meme") {
  // Load cache
  let cache = {};
  try {
    if (fs.existsSync(CACHE_FILE)) cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {}

  const key = symbol.toUpperCase();
  if (cache[key]) return cache[key];

  const buffer = await generateTokenImage(name, symbol, category);
  const filename = `${symbol.toLowerCase()}-token.png`;
  const result = await uploadToPinata(buffer, filename);

  cache[key] = result.url;
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));

  return result.url;
}

// CLI: generate + upload a batch of images
if (require.main === module) {
  (async () => {
    const tokens = [
      // Meme tokens
      { name: "PepeWif", symbol: "PEWI", cat: "meme" },
      { name: "BonkInu", symbol: "BONKINU", cat: "meme" },
      { name: "WojakZone", symbol: "WOJAK", cat: "meme" },
      { name: "Main Character", symbol: "MC", cat: "meme" },
      { name: "Pessimistic Minion", symbol: "PESSIMISM", cat: "meme" },
      { name: "AI Doomer", symbol: "AIDOOMER", cat: "meme" },
      { name: "Based Frog", symbol: "BFROG", cat: "meme" },
      { name: "Degen Ape", symbol: "DAPE", cat: "meme" },
      { name: "Touch Grass", symbol: "GRASS", cat: "meme" },
      { name: "Full Send", symbol: "SEND", cat: "meme" },
      { name: "To The Moon", symbol: "MOON", cat: "meme" },
      { name: "Diamond Hands", symbol: "DIAMOND", cat: "meme" },
      { name: "Paper Hands", symbol: "PAPER", cat: "meme" },
      { name: "Rug Survivor", symbol: "RUGSURV", cat: "meme" },
      { name: "Anime Bitcoin", symbol: "ANIME", cat: "meme" },
      { name: "Tariff Wars", symbol: "TARIFF", cat: "meme" },
      { name: "Based Summer", symbol: "SUMMER", cat: "meme" },
      { name: "Onchain Culture", symbol: "CULTURE", cat: "meme" },
      { name: "The Merge", symbol: "MERGE", cat: "meme" },
      { name: "Purple Pill", symbol: "PURPLE", cat: "meme" },
      { name: "AI Doomer", symbol: "DOOMER", cat: "ai" },
      { name: "GPT Rug", symbol: "GPTRUG", cat: "meme" },
      { name: "Sentient Meme", symbol: "SENTIENT", cat: "ai" },
      { name: "Robot Uprising", symbol: "UPRISING", cat: "ai" },
      { name: "Based AI", symbol: "BASEDAI", cat: "ai" },
      // GitHub tokens
      { name: "Whisper AI", symbol: "WHISPER", cat: "ai" },
      { name: "LangChain", symbol: "LANGCHAIN", cat: "ai" },
      { name: "Llama AI", symbol: "LLAMA", cat: "ai" },
      { name: "ComfyUI", symbol: "COMFY", cat: "ai" },
      { name: "DeepSeek", symbol: "DSEEK", cat: "ai" },
      { name: "Ollama", symbol: "OLLAMA", cat: "ai" },
      { name: "Docker", symbol: "DOCKER", cat: "github" },
      { name: "Next.js", symbol: "NEXTJS", cat: "github" },
      { name: "Supabase", symbol: "SUPA", cat: "github" },
      { name: "Bun", symbol: "BUN", cat: "github" },
      { name: "Vite", symbol: "VITE", cat: "github" },
      { name: "Foundry", symbol: "FOUNDRY", cat: "crypto" },
      { name: "Uniswap V4", symbol: "UNIV4", cat: "crypto" },
      { name: "Reth", symbol: "RETH", cat: "crypto" },
    ];

    console.log(`Generating and uploading ${tokens.length} token images to Pinata...`);
    let success = 0;
    for (const t of tokens) {
      try {
        const url = await getTokenImageUrl(t.name, t.symbol, t.cat);
        console.log(`  ✓ ${t.symbol}: ${url}`);
        success++;
        // Small delay to not hammer Pinata
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        console.error(`  ✗ ${t.symbol}: ${e.message}`);
      }
    }
    console.log(`\nDone! ${success}/${tokens.length} images uploaded. Cache saved to ${CACHE_FILE}`);
  })();
}

module.exports = { generateTokenImage, uploadToPinata, getTokenImageUrl };
