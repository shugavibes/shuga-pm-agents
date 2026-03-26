#!/usr/bin/env node
/**
 * Product Sense Orchestrator
 *
 * Coordinates 5 specialized team agents: Design, Cards, Expenses, Mobile, Stakeholders.
 * Fetches Slack + Notion context once, filters per agent, runs in parallel.
 *
 * Usage:
 *   node orchestrator.mjs morning         — parallel morning briefing from all agents
 *   node orchestrator.mjs eod             — parallel EOD summaries + team broadcast
 *   node orchestrator.mjs task "..."      — routes task to the right agent(s)
 */

import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

import { loadEnv } from './lib/env.mjs';
import { log } from './lib/logger.mjs';
import { callClaude } from './lib/claude.mjs';
import { getMyUserId, getSlackMentions, getSlackActiveThreads, getSelfDMChannel, postSlackMessage, postSlackReply, notifyTokenExpired } from './lib/slack-mcp.mjs';
import { getNotionContext, filterNotionPages } from './lib/notion.mjs';
import { markdownToHtml, copyHtmlToClipboard } from './lib/clipboard.mjs';
import { loadState, saveState, writeAgentStatus } from './lib/state.mjs';
import { loadMemory, extractAndSaveMemory } from './lib/memory.mjs';
import os from 'os';
import config from './config.mjs';

// ─── Load all agents ──────────────────────────────────────────────────────────
import * as designAgent      from './agents/design.mjs';
import * as cardsAgent       from './agents/cards.mjs';
import * as expensesAgent    from './agents/expenses.mjs';
import * as mobileAgent      from './agents/mobile.mjs';
import * as stakeholdersAgent from './agents/stakeholders.mjs';

const ALL_AGENTS = [designAgent, cardsAgent, expensesAgent, mobileAgent, stakeholdersAgent];

// ─── Load last known outputs for all agents (for peer context) ────────────────
function loadAgentOutputs() {
  const outputs = {};
  for (const a of ALL_AGENTS) {
    const p = path.join(os.homedir(), '.agents', `output-${a.SLUG}.json`);
    if (!fs.existsSync(p)) continue;
    try {
      const d = JSON.parse(fs.readFileSync(p, 'utf8'));
      outputs[a.SLUG] = { agentName: a.NAME, slackMessage: d.slackMessage || '', output: d.output || '', runAt: d.runAt };
    } catch {}
  }
  return outputs;
}

// ─── Per-agent output persistence ────────────────────────────────────────────
function saveAgentOutput(slug, mode, result) {
  try {
    const dir = path.join(os.homedir(), '.agents');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `output-${slug}.json`),
      JSON.stringify({ output: result.output, slackMessage: result.slackMessage, runAt: new Date().toISOString(), mode, duration: result.duration, success: result.success }, null, 2),
      'utf8'
    );
  } catch {}
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Context helpers ──────────────────────────────────────────────────────────

/**
 * Filter context to what's relevant for a given agent.
 * Stakeholders agent gets everything unfiltered (it synthesizes cross-team).
 */
function filterContext(raw, agent) {
  if (agent.SLUG === 'stakeholders') return raw; // gets everything

  const chanSet = new Set(agent.CHANNELS.map(c => c.toLowerCase()));
  const mentions = raw.mentions.filter(m => {
    const ch = (m.channel || '').toLowerCase();
    return chanSet.size === 0 || [...chanSet].some(c => ch.includes(c));
  });
  const threads = raw.threads.filter(m => {
    const ch = (m.channel || '').toLowerCase();
    return chanSet.size === 0 || [...chanSet].some(c => ch.includes(c));
  });
  const notionPages = filterNotionPages(raw.notionPages, agent.NOTION_KEYWORDS);

  return { ...raw, mentions, threads, notionPages };
}

// ─── Task routing ─────────────────────────────────────────────────────────────

async function routeTask(instruction) {
  const routingPrompt = `You are a task router for a PM assistant system at ${config.pm.company} (${config.product.name} project).

Available agents:
${ALL_AGENTS.map(a => `- ${a.SLUG}: ${a.ROUTING_DESCRIPTION}`).join('\n')}

Task: "${instruction}"

Which agents should handle this task? Reply with ONLY a JSON array of slugs, e.g.: ["cards", "expenses"]
Use "all" to route to every agent. Pick the minimum set needed.`;

  try {
    const result = await callClaude(routingPrompt, { maxTokens: 100 });
    const match = result.match(/\[.*?\]/s);
    if (!match) return ALL_AGENTS;
    const slugs = JSON.parse(match[0]);
    if (slugs.includes('all')) return ALL_AGENTS;
    const routed = ALL_AGENTS.filter(a => slugs.includes(a.SLUG));
    return routed.length > 0 ? routed : ALL_AGENTS;
  } catch {
    return ALL_AGENTS;
  }
}

// ─── Aggregate morning/eod sections ──────────────────────────────────────────

async function synthesizeTop3(agentResults, date) {
  const sections = agentResults.filter(r => r.success).map(r => r.slackMessage).join('\n\n');
  return callClaude(
    `Today is ${date}. Here are briefings from 5 specialized team agents:\n\n${sections}\n\nSynthesize into a single opening message with:\n- A one-line good morning greeting\n- *Top 3 priorities today* (numbered, specific, actionable)\n\nMax 6 lines. Slack mrkdwn. Be decisive — pick the 3 most important things across all teams.`,
    { maxTokens: 400 }
  );
}

// ─── Morning run ──────────────────────────────────────────────────────────────

async function runMorning(userId, selfChannel) {
  log.step('Orchestrator — morning run...');

  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const hoursBack = 24;

  log.info('Fetching shared context...');
  const [mentions, threads, notionPages] = await Promise.all([
    getSlackMentions(userId, hoursBack),
    getSlackActiveThreads(userId, hoursBack),
    Promise.resolve(getNotionContext(7)),
  ]);
  log.info(`  ${mentions.length} mentions · ${threads.length} threads · ${notionPages.length} Notion pages`);

  // Load each agent's accumulated memory + last known outputs from peers
  log.info('Loading agent memories and peer outputs...');
  const agentOutputs = loadAgentOutputs();
  const memories = Object.fromEntries(ALL_AGENTS.map(a => [a.SLUG, loadMemory(a.SLUG)]));

  const rawCtx = { date, hoursBack, mentions, threads, notionPages, rawMentions: mentions, rawThreads: threads, rawNotionPages: notionPages, agentOutputs };

  // Support --only flag to run a single agent
  const onlySlug = process.argv.find((a, i) => process.argv[i-1] === '--only');
  const agentsToRun = onlySlug ? ALL_AGENTS.filter(a => a.SLUG === onlySlug) : ALL_AGENTS;

  // Run agents in parallel
  log.step(`Running ${agentsToRun.map(a => a.NAME).join(', ')} in parallel...`);
  const results = await Promise.all(
    agentsToRun.map(agent => {
      log.agent(agent.NAME, 'starting morning briefing...');
      const ctx = { ...filterContext(rawCtx, agent), memory: memories[agent.SLUG] };
      return agent.morningBriefing(ctx)
        .then(r => { log.agent(agent.NAME, r.success ? `done (${r.duration}ms)` : `FAILED: ${r.error?.message}`); saveAgentOutput(agent.SLUG, 'morning', r); return r; });
    })
  );

  // Extract and save learnings from each agent's output (parallel, non-blocking for Slack posting)
  log.step('Saving agent learnings...');
  await Promise.all(
    results.filter(r => r.success).map(r => {
      const agent = ALL_AGENTS.find(a => a.NAME === r.agentName);
      return agent ? extractAndSaveMemory(agent.SLUG, agent.NAME, r.output, date) : Promise.resolve();
    })
  );

  // Synthesize top 3
  log.step('Synthesizing top priorities...');
  const top3 = await synthesizeTop3(results, date);

  // Post: synthesized top 3 as main message, agent sections as thread replies
  log.step('Posting to Slack...');
  const mainTs = await postSlackMessage(selfChannel, top3);

  for (const result of results) {
    if (result.success && result.slackMessage) {
      await postSlackReply(selfChannel, mainTs, result.slackMessage);
    }
  }

  log.success(`Morning briefing posted — main message + ${results.filter(r => r.success).length} agent threads`);

  // Save state
  const state = loadState();
  state.morningTs = mainTs;
  state.morningChannel = selfChannel;
  state.morningDate = new Date().toISOString().slice(0, 10);
  state.notionProposals = notionPages.filter(p => p.title !== 'Untitled').map(p => p.title);
  saveState(state);

  writeAgentStatus({
    lastMorningRun: new Date().toISOString(),
    morningStatus: 'success',
    mentionsCount: mentions.length,
    notionPagesCount: notionPages.length,
    tokenExpired: false,
    errors: [],
    agents: Object.fromEntries(results.map(r => [r.agentName.toLowerCase(), { status: r.success ? 'success' : 'error', duration: r.duration }])),
  });
}

// ─── EOD run ──────────────────────────────────────────────────────────────────

async function runEOD(userId, selfChannel) {
  log.step('Orchestrator — EOD run...');

  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const hoursBack = 10;

  log.info('Fetching shared context...');
  const [mentions, threads, notionPages] = await Promise.all([
    getSlackMentions(userId, hoursBack),
    getSlackActiveThreads(userId, hoursBack),
    Promise.resolve(getNotionContext(7)),
  ]);

  log.info('Loading agent memories and peer outputs...');
  const agentOutputs = loadAgentOutputs();
  const memories = Object.fromEntries(ALL_AGENTS.map(a => [a.SLUG, loadMemory(a.SLUG)]));

  const rawCtx = { date, hoursBack, mentions, threads, notionPages, rawMentions: mentions, rawThreads: threads, rawNotionPages: notionPages, agentOutputs };

  const onlySlug = process.argv.find((a, i) => process.argv[i-1] === '--only');
  const agentsToRun = onlySlug ? ALL_AGENTS.filter(a => a.SLUG === onlySlug) : ALL_AGENTS;

  log.step(`Running ${agentsToRun.map(a => a.NAME).join(', ')} in parallel...`);
  const results = await Promise.all(
    agentsToRun.map(agent => {
      log.agent(agent.NAME, 'starting EOD summary...');
      const ctx = { ...filterContext(rawCtx, agent), memory: memories[agent.SLUG] };
      return agent.eodSummary(ctx)
        .then(r => { log.agent(agent.NAME, r.success ? `done (${r.duration}ms)` : `FAILED: ${r.error?.message}`); saveAgentOutput(agent.SLUG, 'eod', r); return r; });
    })
  );

  log.step('Saving agent learnings...');
  await Promise.all(
    results.filter(r => r.success).map(r => {
      const agent = ALL_AGENTS.find(a => a.NAME === r.agentName);
      return agent ? extractAndSaveMemory(agent.SLUG, agent.NAME, r.output, date) : Promise.resolve();
    })
  );

  // Personal EOD summary (thread reply per agent)
  const mainTs = await postSlackMessage(selfChannel, `*EOD Summary 🌅 — ${date}*\n\nEnd-of-day report across all teams. See thread for details.`);

  for (const result of results) {
    if (result.success && result.slackMessage) {
      await postSlackReply(selfChannel, mainTs, result.slackMessage);
    }
  }

  // Broadcast team update — from stakeholders agent result if available
  const stakeholdersResult = results.find(r => r.agentName === 'Stakeholders');
  const broadcast = stakeholdersResult?.broadcast;
  if (broadcast) {
    await postSlackMessage(selfChannel, broadcast);
    log.success('EOD broadcast posted');
  }

  log.success(`EOD summaries posted — ${results.filter(r => r.success).length} agents`);

  writeAgentStatus({
    lastEodRun: new Date().toISOString(),
    eodStatus: 'success',
    mentionsCount: mentions.length,
    errors: [],
    agents: Object.fromEntries(results.map(r => [r.agentName.toLowerCase(), { status: r.success ? 'success' : 'error', duration: r.duration }])),
  });
}

// ─── Task run ─────────────────────────────────────────────────────────────────

async function runTask(instruction, userId, selfChannel) {
  log.step(`Orchestrator — task: "${instruction.slice(0, 80)}..."`);

  // Extract Notion page ID if present
  const notionUrlMatch = instruction.match(/notion\.so\/[^\s]*?([a-f0-9]{32})(?:\?|\s|$)/i);
  const notionPageId = notionUrlMatch?.[1] ?? null;

  log.info('Fetching context...');
  const [mentions, threads, notionPages] = await Promise.all([
    getSlackMentions(userId, 72),
    getSlackActiveThreads(userId, 72),
    Promise.resolve(getNotionContext(14)),
  ]);

  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  log.info('Loading agent memories and peer outputs...');
  const agentOutputs = loadAgentOutputs();
  const memories = Object.fromEntries(ALL_AGENTS.map(a => [a.SLUG, loadMemory(a.SLUG)]));

  const rawCtx = { date, hoursBack: 72, mentions, threads, notionPages, rawMentions: mentions, rawThreads: threads, rawNotionPages: notionPages, agentOutputs };

  // Route to relevant agents
  log.step('Routing task...');
  const targetAgents = await routeTask(instruction);
  log.info(`  Routed to: ${targetAgents.map(a => a.NAME).join(', ')}`);

  // Run targeted agents in parallel
  const results = await Promise.all(
    targetAgents.map(agent => {
      log.agent(agent.NAME, 'executing task...');
      const ctx = { ...filterContext(rawCtx, agent), memory: memories[agent.SLUG] };
      return agent.runTask(instruction, ctx)
        .then(r => { log.agent(agent.NAME, r.success ? `done (${r.duration}ms)` : `FAILED: ${r.error?.message}`); saveAgentOutput(agent.SLUG, 'task', r); return r; });
    })
  );

  const successResults = results.filter(r => r.success && r.output);

  if (successResults.length === 0) {
    await postSlackMessage(selfChannel, '❌ All agents failed to execute this task. Check logs.');
    return;
  }

  // Single agent → output directly
  if (successResults.length === 1) {
    const result = successResults[0];
    if (notionPageId) {
      copyHtmlToClipboard(markdownToHtml(result.output));
      await postSlackMessage(selfChannel,
        `📋 *[${result.agentName}] Content ready* — Cmd+V into the Notion page.\n<https://www.notion.so/${notionPageId.replace(/-/g, '')}|Open page>`
      );
    } else {
      await postSlackMessage(selfChannel, result.output);
    }
    return;
  }

  // Multiple agents → post each as separate message with agent label
  for (const result of successResults) {
    if (notionPageId) {
      // For Notion updates with multiple agents, copy first agent to clipboard and note others
      copyHtmlToClipboard(markdownToHtml(result.output));
      await postSlackMessage(selfChannel,
        `📋 *[${result.agentName}]* — Cmd+V into Notion:\n<https://www.notion.so/${notionPageId.replace(/-/g, '')}|Open page>`
      );
    } else {
      await postSlackMessage(selfChannel, `*[${result.agentName} Agent]*\n${result.output}`);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const mode = process.argv[2];
  if (!mode || !['morning', 'eod', 'task'].includes(mode)) {
    log.error('Usage: node orchestrator.mjs [morning|eod|task "instruction"]');
    process.exit(1);
  }

  const taskInstruction = process.argv[3];
  if (mode === 'task' && !taskInstruction) {
    log.error('Usage: node orchestrator.mjs task "your instruction here"');
    process.exit(1);
  }

  loadEnv();

  if (!process.env.ANTHROPIC_API_KEY) {
    log.error('ANTHROPIC_API_KEY not set in .env');
    process.exit(1);
  }

  log.info(`Product Sense Orchestrator — ${mode} — ${new Date().toISOString()}`);
  log.info(`Agents: ${ALL_AGENTS.map(a => a.NAME).join(', ')}`);

  // Identify user via Slack MCP
  log.step('Connecting to Slack via MCP...');
  let userId;
  try {
    userId = await getMyUserId();
    if (!userId) throw new Error('Could not resolve Slack user ID from MCP');
    log.success(`Slack user: ${userId}`);
  } catch (err) {
    log.error(`Slack MCP connection failed: ${err.message}`);
    await notifyTokenExpired();
    writeAgentStatus({ tokenExpired: true, errors: [err.message], [mode + 'Status']: 'error' });
    process.exit(1);
  }
  const selfChannel = await getSelfDMChannel(userId);

  if (mode === 'morning') {
    await runMorning(userId, selfChannel);
  } else if (mode === 'eod') {
    await runEOD(userId, selfChannel);
  } else {
    await runTask(taskInstruction, userId, selfChannel);
  }

  log.success('Done!');

  try {
    execSync(`node ${path.join(__dirname, 'dashboard', 'generate.mjs')}`, { stdio: 'inherit' });
  } catch {
    log.warning('Could not regenerate dashboard');
  }
}

main().catch(err => {
  log.error(err.message ?? String(err));
  process.exit(1);
});
