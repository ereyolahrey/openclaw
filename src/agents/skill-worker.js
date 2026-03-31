/**
 * Skill-Based Work Agent
 *
 * Finds and completes work on platforms that pay for skills:
 * - GitHub Issues: Monitors repos with bounty labels, "help wanted", "good first issue"
 * - Freelance task platforms: Replit Bounties, coding challenges
 * - Writing/content tasks: Technical writing, documentation
 * - Data tasks: Data cleaning, labeling, analysis
 *
 * Capabilities this agent can offer:
 * - Full-stack development (Node.js, Python, React, etc.)
 * - Smart contract development (Solidity, Vyper)
 * - Data analysis and visualization
 * - Technical writing and documentation
 * - API integration and automation
 * - DevOps and deployment
 * - Bug fixing and code review
 */
require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const https = require("https");
const { Logger } = require("../utils/logger");

const httpClient = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  timeout: 30000,
});

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const TASKS_FILE = path.join(DATA_DIR, "skill-tasks.json");
const COMPLETED_FILE = path.join(DATA_DIR, "skill-completed.json");

// GitHub repositories known for bounties
const BOUNTY_REPOS = [
  // Web3/Crypto (high-paying bounties)
  "ethereum/solidity",
  "OpenZeppelin/openzeppelin-contracts",
  "aave/aave-v3-core",
  "Uniswap/v3-core",
  "compound-finance/compound-protocol",
  // Developer tools
  "vercel/next.js",
  "denoland/deno",
  "nodejs/node",
  "facebook/react",
  // AI/ML
  "huggingface/transformers",
  "langchain-ai/langchainjs",
  "microsoft/TypeScript",
];

// GitHub search queries for bounty/paid issues
const GITHUB_SEARCH_QUERIES = [
  'label:"bounty" state:open',
  'label:"help wanted" label:"good first issue" state:open',
  'label:"$" state:open',
  'label:"paid" state:open',
  'label:"reward" state:open',
  '"bounty" in:title state:open',
];

// Skills we can fulfill
const SKILLS = [
  "javascript", "typescript", "nodejs", "python", "react",
  "solidity", "smart-contracts", "api", "devops", "docker",
  "testing", "documentation", "data-analysis", "automation",
  "bug-fix", "code-review", "ci-cd", "database", "mongodb",
  "postgresql", "redis", "websockets", "graphql", "rest-api",
];

class SkillWorker {
  constructor({ notifiers = [], config = {} }) {
    this.notifiers = notifiers;
    this.config = {
      githubToken: config.githubToken || process.env.GITHUB_TOKEN || null,
      maxTasksPerDay: config.maxTasksPerDay || 5,
      minBountyUSD: config.minBountyUSD || 10,
      ...config,
    };
    this.log = new Logger("skill-worker");
    this.tasks = [];
    this.completed = [];
    this.seenIssueIds = new Set();
    this.dailyTaskCount = 0;
    this.lastResetDate = new Date().toDateString();
  }

  // --- Initialization ---
  async init() {
    this.log.info("Initializing skill worker agent...");
    this.loadTasks();
    this.loadCompleted();

    if (this.config.githubToken) {
      this.log.info("GitHub token configured — full issue scanning enabled");
    } else {
      this.log.info(
        "No GITHUB_TOKEN set. Using unauthenticated API (60 req/hr limit). " +
        "Set GITHUB_TOKEN in .env for 5000 req/hr."
      );
    }

    return true;
  }

  // --- GitHub Issue Scanner ---
  async scanGitHubBounties() {
    const headers = {
      Accept: "application/vnd.github+json",
    };
    if (this.config.githubToken) {
      headers.Authorization = `Bearer ${this.config.githubToken}`;
    }

    const allIssues = [];

    // Search for bounty-labeled issues across GitHub
    for (const query of GITHUB_SEARCH_QUERIES) {
      try {
        const resp = await httpClient.get("https://api.github.com/search/issues", {
          headers,
          params: {
            q: query,
            sort: "created",
            order: "desc",
            per_page: 20,
          },
        });

        const items = resp.data?.items || [];
        for (const issue of items) {
          if (!this.seenIssueIds.has(issue.id)) {
            allIssues.push(this.parseGitHubIssue(issue));
            this.seenIssueIds.add(issue.id);
          }
        }

        // Rate limit respect — small delay between queries
        await new Promise((r) => setTimeout(r, 1000));
      } catch (err) {
        if (err.response?.status === 403) {
          this.log.warn("GitHub rate limit hit — will retry next cycle");
          break;
        }
        this.log.warn(`GitHub search error: ${err.message}`);
      }
    }

    // Also scan specific bounty repos
    for (const repo of BOUNTY_REPOS.slice(0, 5)) { // limit to avoid rate limits
      try {
        const resp = await httpClient.get(
          `https://api.github.com/repos/${repo}/issues`,
          {
            headers,
            params: {
              state: "open",
              labels: "help wanted",
              per_page: 10,
            },
          }
        );

        const items = resp.data || [];
        for (const issue of items) {
          if (!this.seenIssueIds.has(issue.id)) {
            allIssues.push(this.parseGitHubIssue(issue));
            this.seenIssueIds.add(issue.id);
          }
        }

        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        this.log.warn(`Repo scan error (${repo}): ${err.message}`);
      }
    }

    return allIssues;
  }

  parseGitHubIssue(issue) {
    const labels = (issue.labels || []).map((l) => l.name?.toLowerCase() || "");
    const hasBounty = labels.some((l) =>
      l.includes("bounty") || l.includes("reward") || l.includes("paid") || l.includes("$")
    );

    // Try to extract bounty amount from labels or body
    let bountyAmount = 0;
    const bountyMatch = (issue.body || "").match(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/);
    if (bountyMatch) {
      bountyAmount = parseFloat(bountyMatch[1].replace(/,/g, ""));
    }

    // Also check labels for amounts
    for (const label of labels) {
      const labelMatch = label.match(/\$?(\d+)/);
      if (labelMatch && (label.includes("bounty") || label.includes("$") || label.includes("reward"))) {
        bountyAmount = Math.max(bountyAmount, parseInt(labelMatch[1]));
      }
    }

    // Score the issue for our skill match
    const text = `${issue.title} ${issue.body || ""} ${labels.join(" ")}`.toLowerCase();
    let skillMatch = 0;
    const matchedSkills = [];

    for (const skill of SKILLS) {
      if (text.includes(skill)) {
        skillMatch++;
        matchedSkills.push(skill);
      }
    }

    return {
      id: issue.id,
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      repo: issue.repository_url?.replace("https://api.github.com/repos/", "") || "",
      labels,
      hasBounty,
      bountyAmount,
      skillMatch,
      matchedSkills,
      createdAt: issue.created_at,
      comments: issue.comments,
      body: (issue.body || "").slice(0, 500), // truncate for storage
    };
  }

  // --- Task Scoring ---
  scoreTask(task) {
    let score = 0;

    // Bounty value (most important)
    if (task.bountyAmount >= 500) score += 50;
    else if (task.bountyAmount >= 100) score += 30;
    else if (task.bountyAmount >= 50) score += 20;
    else if (task.bountyAmount > 0) score += 10;
    else if (task.hasBounty) score += 5;

    // Skill match (how many of our skills apply)
    score += task.skillMatch * 5;

    // Freshness (newer = better, less competition)
    const ageHours = (Date.now() - new Date(task.createdAt).getTime()) / 3600000;
    if (ageHours < 24) score += 15;
    else if (ageHours < 72) score += 10;
    else if (ageHours < 168) score += 5;

    // Low competition (fewer comments = less competition)
    if (task.comments === 0) score += 10;
    else if (task.comments < 3) score += 5;

    return score;
  }

  // --- Task Selection ---
  selectBestTasks(tasks) {
    return tasks
      .map((t) => ({ ...t, score: this.scoreTask(t) }))
      .filter((t) => t.score >= 10) // minimum viability threshold
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.maxTasksPerDay);
  }

  // --- Main Cycle ---
  async runCycle() {
    const today = new Date().toDateString();
    if (today !== this.lastResetDate) {
      this.dailyTaskCount = 0;
      this.lastResetDate = today;
    }

    this.log.info("=== Skill worker scan cycle ===");

    // 1. Scan for bounties and tasks
    const githubIssues = await this.scanGitHubBounties();
    this.log.info(`Scanned ${githubIssues.length} new GitHub issues`);

    // 2. Add to task pool
    for (const issue of githubIssues) {
      const exists = this.tasks.find((t) => t.id === issue.id);
      if (!exists) {
        this.tasks.push(issue);
      }
    }

    // 3. Score and select best tasks
    const bestTasks = this.selectBestTasks(this.tasks);
    const bountyTasks = bestTasks.filter((t) => t.hasBounty || t.bountyAmount > 0);

    this.log.info(
      `Task pool: ${this.tasks.length} total | ` +
      `${bountyTasks.length} with bounties | ` +
      `Top score: ${bestTasks[0]?.score || 0}`
    );

    // 4. Report high-value opportunities
    for (const task of bestTasks.slice(0, 3)) {
      this.log.info(
        `OPPORTUNITY: [${task.score}pts] ${task.title}\n` +
        `  Repo: ${task.repo} | Bounty: $${task.bountyAmount || "unknown"}\n` +
        `  Skills: ${task.matchedSkills.join(", ") || "general"}\n` +
        `  URL: ${task.url}`
      );
    }

    // 5. Notify on high-value bounties
    const highValue = bestTasks.filter((t) => t.bountyAmount >= 50 || t.score >= 30);
    if (highValue.length > 0) {
      const summary = highValue
        .slice(0, 5)
        .map(
          (t) =>
            `• [${t.score}pts] $${t.bountyAmount || "?"} — ${t.title}\n  ${t.url}`
        )
        .join("\n\n");

      await this.notify(
        `🔧 High-Value Skill Opportunities Found!\n\n${summary}`
      );
    }

    // 6. Prune old tasks (older than 30 days)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    this.tasks = this.tasks.filter(
      (t) => new Date(t.createdAt).getTime() > thirtyDaysAgo
    );

    this.saveTasks();

    // 7. Status report
    const totalBountyValue = this.tasks.reduce(
      (sum, t) => sum + (t.bountyAmount || 0), 0
    );
    this.log.info(
      `Pipeline value: $${totalBountyValue} across ${this.tasks.length} tasks | ` +
      `Completed: ${this.completed.length}`
    );
  }

  // --- Persistence ---
  loadTasks() {
    try {
      if (fs.existsSync(TASKS_FILE)) {
        this.tasks = JSON.parse(fs.readFileSync(TASKS_FILE, "utf8"));
        this.tasks.forEach((t) => this.seenIssueIds.add(t.id));
        this.log.info(`Loaded ${this.tasks.length} tasks from disk`);
      }
    } catch (err) {
      this.log.warn(`Tasks load error: ${err.message}`);
    }
  }

  saveTasks() {
    try {
      fs.writeFileSync(TASKS_FILE, JSON.stringify(this.tasks, null, 2));
    } catch (err) {
      this.log.warn(`Tasks save error: ${err.message}`);
    }
  }

  loadCompleted() {
    try {
      if (fs.existsSync(COMPLETED_FILE)) {
        this.completed = JSON.parse(fs.readFileSync(COMPLETED_FILE, "utf8"));
        this.log.info(`Loaded ${this.completed.length} completed tasks`);
      }
    } catch (err) {
      this.log.warn(`Completed load error: ${err.message}`);
    }
  }

  recordCompletion(task, result) {
    this.completed.push({
      ...task,
      completedAt: new Date().toISOString(),
      result: result ? String(result).slice(0, 500) : null,
    });
    try {
      fs.writeFileSync(COMPLETED_FILE, JSON.stringify(this.completed, null, 2));
    } catch (err) {
      this.log.warn(`Completed save error: ${err.message}`);
    }
  }

  // --- Notifications ---
  async notify(message) {
    for (const notifier of this.notifiers) {
      try {
        await notifier.send(message);
      } catch (err) {
        this.log.warn(`Notification error: ${err.message}`);
      }
    }
  }
}

// --- Standalone Runner ---
async function main() {
  const worker = new SkillWorker({
    config: {
      maxTasksPerDay: parseInt(process.env.SKILL_MAX_TASKS || "5"),
      minBountyUSD: parseInt(process.env.SKILL_MIN_BOUNTY || "10"),
    },
  });

  await worker.init();

  // Run immediately
  await worker.runCycle();

  // Scan every 30 minutes
  cron.schedule("*/30 * * * *", async () => {
    try {
      await worker.runCycle();
    } catch (err) {
      console.error("Skill worker cycle error:", err.message);
    }
  });

  console.log("Skill worker running — scanning for bounties every 30 minutes");
}

main().catch(console.error);

module.exports = { SkillWorker };
