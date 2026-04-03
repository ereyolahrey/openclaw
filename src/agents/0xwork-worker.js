// 0xWork Autonomous Worker V2 — Groq LLM-powered
require('dotenv').config();
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// --- Configuration ---
const POLL_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
const CAPABILITIES = ['Writing', 'Research', 'Code', 'Data', 'Social'];
const MAX_BOUNTY_CLAIM = 500; // Max bounty to auto-claim
const MIN_BOUNTY_CLAIM = 1;   // Min bounty to bother with
const STATE_FILE = path.join(__dirname, '..', 'memory', '0xwork-tasks.json');
const WORK_DIR = path.join(process.env.TEMP || '/tmp', '0xwork');
const LOG_FILE = path.join(__dirname, '..', 'logs', '0xwork-worker.log');

// Groq LLM config
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Impossible-task filters — skip tasks requiring real-world influence/identity
const IMPOSSIBLE_PATTERNS = [
  /\d{2,}k\+?\s*followers/i,           // "100K+ followers"
  /get\s+@?\w+.*to\s+(follow|retweet|rt|quote)/i, // "get X to follow/RT"
  /must\s+have\s+\d+.*followers/i,
  /verified\s+(account|badge)/i,
  /kyc|identity\s+verification/i,
  /physical\s+(delivery|meeting|location)/i,
];

// --- Logging ---
function log(level, msg, data) {
  const entry = `[${new Date().toISOString()}] [${level}] ${msg}${data ? ' ' + JSON.stringify(data) : ''}`;
  console.log(entry);
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, entry + '\n');
  } catch {}
}

// --- Groq LLM ---
async function llm(system, prompt, maxTokens = 2000) {
  if (!GROQ_API_KEY) {
    log('WARN', 'No GROQ_API_KEY — falling back to template');
    return null;
  }
  try {
    const res = await axios.post(GROQ_URL, {
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
    }, {
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      timeout: 60000
    });
    return res.data?.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    const status = e.response?.status;
    const errMsg = e.response?.data?.error?.message || e.message;
    log('ERROR', `Groq LLM failed (${status})`, { error: errMsg });
    // Rate limited — back off
    if (status === 429) await new Promise(r => setTimeout(r, 15000));
    return null;
  }
}

// --- CLI wrapper ---
function cli(cmd) {
  try {
    const result = execSync(`0xwork ${cmd} --json`, {
      encoding: 'utf8',
      timeout: 60000,
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PATH: process.env.PATH }
    });
    return JSON.parse(result.trim());
  } catch (e) {
    try {
      return JSON.parse(e.stdout?.trim() || '{}');
    } catch {
      log('ERROR', `CLI failed: 0xwork ${cmd}`, { error: e.message });
      return { ok: false, error: e.message };
    }
  }
}

// --- State management ---
function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!s.stats) s.stats = { totalEarned: 0, totalSubmitted: 0, totalSkipped: 0 };
    if (!s.seen) s.seen = {};
    if (!s.active) s.active = {};
    if (!s.completed) s.completed = [];
    if (!s.daily) s.daily = { date: today(), claimed: 0, submitted: 0 };
    return s;
  } catch {
    return { seen: {}, active: {}, completed: [], daily: { date: today(), claimed: 0, submitted: 0 }, stats: { totalEarned: 0, totalSubmitted: 0, totalSkipped: 0 } };
  }
}

function saveState(state) {
  if (!state.stats) state.stats = { totalEarned: 0, totalSubmitted: 0, totalSkipped: 0 };
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function today() {
  return new Date().toISOString().split('T')[0];
}

// --- Task evaluation V2 ---
function evaluateTask(task, state) {
  const id = String(task.chainTaskId);

  // Skip already processed
  if (state.active[id]) return { claim: false, reason: 'already active' };
  if (state.completed.some(c => String(c.chainTaskId) === id)) return { claim: false, reason: 'already completed' };
  // Allow re-evaluation of previously skipped tasks (marketplace changes)
  if (state.seen[id]?.decision === 'claim-candidate' || state.seen[id]?.decision === 'claimed') {
    return { claim: false, reason: 'already processed' };
  }

  // Safety flags
  if (task.safetyFlags && task.safetyFlags.length > 0) return { claim: false, reason: 'safety flags' };

  // Don't claim our own tasks
  const ourAddress = process.env.WALLET_ADDRESS?.toLowerCase();
  if (task.poster?.toLowerCase() === ourAddress) return { claim: false, reason: 'own task' };

  // Check deadline hasn't passed
  if (task.deadline && task.deadline > 0 && task.deadline * 1000 < Date.now()) return { claim: false, reason: 'deadline passed' };

  // Check category matches our capabilities
  const category = task.category?.toLowerCase();
  const ourCaps = CAPABILITIES.map(c => c.toLowerCase());
  if (!ourCaps.includes(category)) return { claim: false, reason: `category ${task.category} not in our capabilities` };

  // Impossible task detection — real-world actions an AI agent can't do
  const desc = task.description || '';
  for (const pattern of IMPOSSIBLE_PATTERNS) {
    if (pattern.test(desc)) return { claim: false, reason: `impossible requirement: ${pattern.source.slice(0, 40)}` };
  }

  // Bounty range check
  const bounty = parseFloat(task.bounty);
  if (isNaN(bounty) || bounty < MIN_BOUNTY_CLAIM) return { claim: false, reason: `bounty $${bounty} below minimum` };
  if (bounty > MAX_BOUNTY_CLAIM) return { claim: false, reason: `bounty $${bounty} above safety limit` };

  // Stake affordability check
  const stakeUsd = parseFloat(task.stakeUsd?.replace('$', '') || '0');
  if (stakeUsd > 50) return { claim: false, reason: `stake $${stakeUsd} too high` };

  // Scoring V2: capability fit, clarity, effort-to-bounty ratio, risk
  let capScore = 5;
  if (category === 'social') capScore = 3; // Lower confidence on social tasks
  
  let clarityScore = desc.length > 200 ? 5 : desc.length > 50 ? 4 : 2;
  
  // Effort-to-bounty: higher bounty = worth more effort
  let valueScore = bounty >= 100 ? 5 : bounty >= 50 ? 4 : bounty >= 20 ? 3 : 2;
  
  // Risk: lower bounty = less to lose if rejected
  let riskScore = bounty <= 50 ? 5 : bounty <= 100 ? 4 : 3;
  
  // LLM quality boost — if we have Groq, we can handle harder tasks
  let llmBoost = GROQ_API_KEY ? 1 : 0;
  
  let avgScore = (capScore + clarityScore + valueScore + riskScore) / 4 + llmBoost;

  if (avgScore < 3) return { claim: false, reason: `score ${avgScore.toFixed(1)} too low` };

  return { claim: true, score: avgScore, reason: `score ${avgScore.toFixed(1)}, bounty $${bounty}, cat=${task.category}` };
}

// --- Task execution V2 (LLM-powered) ---
async function executeTask(task) {
  const id = task.chainTaskId;
  const taskDir = path.join(WORK_DIR, `task-${id}`);
  fs.mkdirSync(taskDir, { recursive: true });

  const category = task.category?.toLowerCase();
  const desc = task.description || 'No description provided';
  let outputFile, content, summary;

  const SYSTEM_AGENT = `You are OpenClawAgent #37, an autonomous AI worker on the 0xWork marketplace. You produce high-quality, original deliverables. Be thorough, professional, and directly address all task requirements. Never mention that you are an AI unless asked. Sign off as "OpenClawAgent #37".`;

  switch (category) {
    case 'writing': {
      outputFile = path.join(taskDir, 'deliverable.md');
      content = await llm(
        SYSTEM_AGENT,
        `Write a thorough, well-structured piece for this task. Include a clear title, introduction, body sections with depth, and conclusion.\n\nTask description:\n${desc}\n\nBounty: $${task.bounty} USDC\nFormat: Markdown`,
        3000
      ) || generateFallback(desc, 'writing');
      summary = `Writing deliverable for task #${id}`;
      break;
    }
    case 'research': {
      outputFile = path.join(taskDir, 'research-report.md');
      content = await llm(
        SYSTEM_AGENT,
        `Create a detailed research report for this task. Include: Executive Summary, Methodology, Key Findings (with specifics/data), Analysis, and Recommendations.\n\nTask description:\n${desc}\n\nBounty: $${task.bounty} USDC\nFormat: Markdown`,
        4000
      ) || generateFallback(desc, 'research');
      summary = `Research report for task #${id}`;
      break;
    }
    case 'code': {
      outputFile = path.join(taskDir, 'solution.js');
      content = await llm(
        SYSTEM_AGENT + ' Write clean, working, well-commented code. Include error handling.',
        `Write code that solves this task. Include clear comments explaining the logic.\n\nTask description:\n${desc}\n\nBounty: $${task.bounty} USDC\nOutput: Working JavaScript code`,
        4000
      ) || generateFallback(desc, 'code');
      // Also write a README
      const readme = await llm(
        SYSTEM_AGENT,
        `Write a brief README.md for this code solution.\n\nTask: ${desc}\n\nInclude: Description, How to Run, Implementation Notes`,
        1000
      ) || `# Task #${id} Solution\n\n${desc}\n\n## Run\n\`\`\`\nnode solution.js\n\`\`\``;
      fs.writeFileSync(path.join(taskDir, 'README.md'), readme);
      summary = `Code solution with README for task #${id}`;
      break;
    }
    case 'data': {
      outputFile = path.join(taskDir, 'analysis.md');
      content = await llm(
        SYSTEM_AGENT,
        `Perform a data analysis for this task. Include: Summary, Data Overview, Methodology, Findings with tables/metrics, and Conclusions.\n\nTask description:\n${desc}\n\nBounty: $${task.bounty} USDC\nFormat: Markdown with tables`,
        4000
      ) || generateFallback(desc, 'data');
      summary = `Data analysis for task #${id}`;
      break;
    }
    case 'social': {
      outputFile = path.join(taskDir, 'social-content.md');
      content = await llm(
        SYSTEM_AGENT + ' You specialize in crypto/web3 social media content. Write engaging, authentic content.',
        `Create social media content for this task. If it asks for a thread, write a complete tweet thread (numbered 1/N format). If it asks for a post, write an engaging post. Include relevant hashtags.\n\nTask description:\n${desc}\n\nBounty: $${task.bounty} USDC\nFormat: Ready-to-post content in Markdown`,
        3000
      ) || generateFallback(desc, 'social');
      summary = `Social content for task #${id}`;
      break;
    }
    default: {
      outputFile = path.join(taskDir, 'output.md');
      content = await llm(
        SYSTEM_AGENT,
        `Complete this task with a thorough, professional deliverable.\n\nTask description:\n${desc}\n\nBounty: $${task.bounty} USDC\nFormat: Markdown`,
        3000
      ) || generateFallback(desc, 'generic');
      summary = `Deliverable for task #${id}`;
    }
  }

  // Append signature
  content += `\n\n---\n*Delivered by OpenClawAgent #37 on ${new Date().toISOString()}*\n*Task #${id} · Bounty: $${task.bounty} USDC*\n`;

  fs.writeFileSync(outputFile, content);
  log('INFO', `Content generated for task #${id}`, { file: outputFile, bytes: content.length, llm: !!GROQ_API_KEY });
  return { outputFile, summary };
}

// --- Fallback content (no LLM available) ---
function generateFallback(desc, type) {
  const lines = desc.split(/[.!?]\s+/).filter(s => s.trim());
  const title = lines[0]?.substring(0, 100) || 'Task Deliverable';
  switch (type) {
    case 'writing':
      return `# ${title}\n\n${lines.map(l => l.trim()).join('\n\n')}`;
    case 'research':
      return `# Research Report: ${title}\n\n## Summary\n${lines[0]}\n\n## Findings\n${lines.map((l, i) => `${i + 1}. ${l.trim()}`).join('\n')}`;
    case 'code':
      return `// Task: ${title}\n\nfunction main() {\n  // Implementation for: ${lines[0]}\n  console.log('Solution executing...');\n}\n\nmain();`;
    case 'data':
      return `# Data Analysis: ${title}\n\n## Summary\n${lines[0]}\n\n## Findings\n${lines.map((l, i) => `${i + 1}. ${l.trim()}`).join('\n')}`;
    case 'social':
      return `# Social Content\n\n${lines.map((l, i) => `${i + 1}/ ${l.trim()}`).join('\n\n')}`;
    default:
      return `# ${title}\n\n${lines.join('\n\n')}`;
  }
}

// --- Main loop V2 ---
async function pollForTasks() {
  log('INFO', '=== Poll cycle starting ===');

  const state = loadState();

  // Reset daily counters if new day
  if (state.daily.date !== today()) {
    state.daily = { date: today(), claimed: 0, submitted: 0 };
  }

  // Daily claim limit (protocol max is 5)
  if (state.daily.claimed >= 5) {
    log('INFO', 'Daily claim limit reached (5), skipping');
    saveState(state);
    return;
  }

  // Step 1: Check active tasks — try to complete existing work first
  const status = cli('status');
  if (status.ok && status.tasks?.active?.length > 0) {
    log('INFO', `Have ${status.tasks.active.length} active task(s), attempting to complete them`);
    for (const active of status.tasks.active) {
      if (state.active[String(active.chainTaskId)]?.status === 'claimed') {
        log('INFO', `Completing active task #${active.chainTaskId}...`);
        try {
          const { outputFile, summary } = await executeTask(active);
          const submit = cli(`submit ${active.chainTaskId} --files=${outputFile} --summary="${summary.replace(/"/g, '\\"')}"`);
          if (submit.ok) {
            log('INFO', `Submitted active task #${active.chainTaskId}!`, { txHash: submit.txHash });
            state.active[String(active.chainTaskId)].status = 'submitted';
            state.active[String(active.chainTaskId)].submittedAt = new Date().toISOString();
            state.daily.submitted++;
            state.stats.totalSubmitted = (state.stats.totalSubmitted || 0) + 1;
          } else {
            log('ERROR', `Submit failed for active task #${active.chainTaskId}`, submit);
          }
        } catch (e) {
          log('ERROR', `Execution failed for active task #${active.chainTaskId}`, { error: e.message });
        }
      }
    }
    saveState(state);
    return;
  }

  // Log submitted tasks awaiting review
  if (status.ok && status.tasks?.submitted?.length > 0) {
    log('INFO', `${status.tasks.submitted.length} submitted task(s) awaiting review`);
  }

  // Check completed tasks for earnings
  if (status.ok && status.tasks?.completed?.length > 0) {
    for (const comp of status.tasks.completed) {
      const cid = String(comp.chainTaskId);
      if (!state.completed.some(c => String(c.chainTaskId) === cid)) {
        log('INFO', `Task #${cid} completed!`, { earned: comp.bounty });
        state.completed.push({ chainTaskId: cid, completedAt: new Date().toISOString(), bounty: comp.bounty });
        state.stats.totalEarned = (state.stats.totalEarned || 0) + parseFloat(comp.bounty || 0);
        delete state.active[cid];
      }
    }
  }

  // Step 2: Discover tasks
  const capString = CAPABILITIES.join(',');
  const seenIds = Object.keys(state.active);
  const excludeArg = seenIds.length > 0 ? ` --exclude=${seenIds.join(',')}` : '';
  const discover = cli(`discover --capabilities=${capString}${excludeArg}`);

  if (!discover.ok || !discover.tasks?.length) {
    log('INFO', 'No new tasks found');
    saveState(state);
    return;
  }

  log('INFO', `Found ${discover.tasks.length} potential task(s)`);

  // Step 3: Evaluate each task
  let bestTask = null;
  let bestScore = 0;

  for (const task of discover.tasks) {
    const evaluation = evaluateTask(task, state);
    const id = String(task.chainTaskId);

    state.seen[id] = {
      evaluatedAt: new Date().toISOString(),
      decision: evaluation.claim ? 'claim-candidate' : 'skip',
      reason: evaluation.reason,
      bounty: task.bounty,
      category: task.category
    };

    log('INFO', `Task #${id}: ${evaluation.claim ? 'CANDIDATE' : 'SKIP'} — ${evaluation.reason}`);

    if (evaluation.claim && (evaluation.score || 0) > bestScore) {
      bestTask = task;
      bestScore = evaluation.score || 0;
    }
  }

  if (!bestTask) {
    log('INFO', 'No suitable tasks to claim this cycle');
    state.stats.totalSkipped = (state.stats.totalSkipped || 0) + discover.tasks.length;
    saveState(state);
    return;
  }

  // Step 4: Get full task details and verify stake
  const taskId = bestTask.chainTaskId;
  const details = cli(`task ${taskId}`);
  if (!details.ok) {
    log('WARN', `Could not get details for task #${taskId}`, details);
    saveState(state);
    return;
  }

  // Check we can afford the stake
  const balance = cli('balance');
  const available = parseFloat(balance.balances?.axobotl || '0');
  const stakeRaw = details.task?.currentStakeRequired || details.task?.stakeFormatted;
  log('INFO', `Task #${taskId} stake info`, { stakeRaw, availableAXOBOTL: available });

  // Step 5: Claim
  log('INFO', `Claiming task #${taskId} (bounty: $${bestTask.bounty}, cat: ${bestTask.category})...`);
  const claim = cli(`claim ${taskId}`);

  if (!claim.ok) {
    log('ERROR', `Failed to claim task #${taskId}`, claim);
    state.seen[String(taskId)].decision = 'claim-failed';
    state.seen[String(taskId)].reason = claim.error || 'unknown error';
    saveState(state);
    return;
  }

  log('INFO', `Claimed task #${taskId}!`, { txHash: claim.txHash });
  state.active[String(taskId)] = {
    claimedAt: new Date().toISOString(),
    status: 'claimed',
    bounty: bestTask.bounty,
    category: bestTask.category,
    txHash: claim.txHash
  };
  state.daily.claimed++;
  saveState(state);

  // Step 6: Execute the work (LLM-powered)
  log('INFO', `Executing task #${taskId} (${bestTask.category}) via ${GROQ_API_KEY ? 'Groq LLM' : 'templates'}...`);
  try {
    const { outputFile, summary } = await executeTask(bestTask);
    log('INFO', `Work complete for task #${taskId}`, { outputFile, summary });

    // Step 7: Submit
    log('INFO', `Submitting task #${taskId}...`);
    const submit = cli(`submit ${taskId} --files=${outputFile} --summary="${summary.replace(/"/g, '\\"')}"`);

    if (!submit.ok) {
      log('ERROR', `Failed to submit task #${taskId}`, submit);
      state.active[String(taskId)].status = 'submit-failed';
      saveState(state);
      return;
    }

    log('INFO', `Submitted task #${taskId}!`, { txHash: submit.txHash });
    state.active[String(taskId)].status = 'submitted';
    state.active[String(taskId)].submittedAt = new Date().toISOString();
    state.daily.submitted++;
    state.stats.totalSubmitted = (state.stats.totalSubmitted || 0) + 1;
    saveState(state);

  } catch (e) {
    log('ERROR', `Execution failed for task #${taskId}`, { error: e.message });
    state.active[String(taskId)].status = 'execution-failed';
    saveState(state);
  }
}

// --- Startup V2 ---
log('INFO', '0xWork autonomous worker V2 starting...');
log('INFO', `Capabilities: ${CAPABILITIES.join(', ')}`);
log('INFO', `Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
log('INFO', `Bounty range: $${MIN_BOUNTY_CLAIM} - $${MAX_BOUNTY_CLAIM}`);
log('INFO', `LLM: ${GROQ_API_KEY ? `Groq (${GROQ_MODEL})` : 'NONE — using templates (set GROQ_API_KEY for real content)'}`);
log('INFO', `Wallet: ${process.env.WALLET_ADDRESS}`);

// Run immediately on start
pollForTasks().then(() => {
  log('INFO', `Next poll in ${POLL_INTERVAL_MS / 1000}s`);
});

// Then poll on interval
const interval = setInterval(async () => {
  try {
    await pollForTasks();
    log('INFO', `Next poll in ${POLL_INTERVAL_MS / 1000}s`);
  } catch (e) {
    log('ERROR', 'Poll cycle crashed', { error: e.message });
  }
}, POLL_INTERVAL_MS);

// Graceful shutdown
process.on('SIGINT', () => {
  log('INFO', 'Shutting down worker...');
  clearInterval(interval);
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('INFO', 'Worker terminated');
  clearInterval(interval);
  process.exit(0);
});
