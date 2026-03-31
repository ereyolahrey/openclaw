const axios = require("axios");
const { Logger } = require("../utils/logger");

class OpenClawBridge {
  constructor({ gatewayUrl, token }) {
    this.logger = new Logger("openclaw-bridge");
    this.client = axios.create({
      baseURL: gatewayUrl,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      timeout: 60000,
    });
  }

  async connect() {
    try {
      const res = await this.client.get("/health");
      this.logger.info("Gateway connected:", res.status);
      return true;
    } catch (err) {
      this.logger.warn("Gateway not reachable:", err.message);
      return false;
    }
  }

  async query(agentId, prompt) {
    try {
      const res = await this.client.post("/v1/agents/query", { agent: agentId, prompt, stream: false });
      return res.data?.response || res.data?.text || JSON.stringify(res.data);
    } catch (err) {
      this.logger.error(`Query failed [${agentId}]:`, err.message);
      throw new Error(`Agent query failed: ${err.message}`);
    }
  }
}
module.exports = { OpenClawBridge };
