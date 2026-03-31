/**
 * DNS Fix — Use public DNS resolvers to avoid ISP DNS failures.
 * Sets Node.js dns module to use Google (8.8.8.8) and Cloudflare (1.1.1.1).
 */
const dns = require("dns");

dns.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);

module.exports = {};
