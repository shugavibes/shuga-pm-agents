#!/usr/bin/env node
/**
 * Product Sense Agent
 *
 * Reads Slack mentions + Notion docs, sends morning/EOD summaries via Slack DM.
 *
 * Usage:
 *   npm run morning   — 8am run: priorities + Notion proposals
 *   npm run eod       — 6pm run: day summary + apply confirmed proposals
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import Anthropic from '@anthropic-ai/sdk';
import { getMyUserId, getSlackMentions, getSlackActiveThreads, getMorningThreadReplies, getSelfDMChannel, postSlackMessage, notifyTokenExpired } from './lib/slack-mcp.mjs';
import config from './config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, 'state.json');

// ─── Colours ─────────────────────────────────────────────────────────────────
const c = {
  blue: '\x1b[0;34m', green: '\x1b[0;32m',
  yellow: '\x1b[1;33m', red: '\x1b[0;31m',
  magenta: '\x1b[0;35m', reset: '\x1b[0m',
};
const log = {
  info: (m) => console.log(`${c.blue}[INFO]${c.reset} ${m}`),
  success: (m) => console.log(`${c.green}[SUCCESS]${c.reset} ${m}`),
  warning: (m) => console.warn(`${c.yellow}[WARNING]${c.reset} ${m}`),
  error: (m) => console.error(`${c.red}[ERROR]${c.reset} ${m}`),
  step: (m) => console.log(`${c.magenta}[STEP]${c.reset} ${m}`),
};

// ─── Env ─────────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    log.error('Missing .env file. Copy .env.example and fill in values.');
    process.exit(1);
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

// ─── State ───────────────────────────────────────────────────────────────────
function loadState() {
  if (!fs.existsSync(STATE_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return {}; }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

// ─── Agent status ─────────────────────────────────────────────────────────────
function writeAgentStatus(patch) {
  const agentsDir = path.join(os.homedir(), '.agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  const filePath = path.join(agentsDir, 'product-agent.json');
  let current = {};
  if (fs.existsSync(filePath)) {
    try { current = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
  }
  fs.writeFileSync(filePath, JSON.stringify({ ...current, ...patch }, null, 2), 'utf8');
}


// ─── Notion ───────────────────────────────────────────────────────────────────
function extractText(properties) {
  if (!properties) return 'Untitled';
  try {
    const props = typeof properties === 'string' ? JSON.parse(properties) : properties;
    const title = props.title || [];
    return title.map((t) => (Array.isArray(t) ? t[0] : t)).join('').trim() || 'Untitled';
  } catch {
    return 'Untitled';
  }
}

/**
 * Get recently modified Notion pages and their content.
 */
function getNotionContext(daysBack = 7) {
  log.info(`Reading Notion pages modified in last ${daysBack} days...`);
  const dbPath = process.env.NOTION_DB_PATH;
  const db = new Database(dbPath, { readonly: true });

  const since = (Date.now() - daysBack * 24 * 3600 * 1000);

  const pages = db.prepare(`
    SELECT id, properties, last_edited_time, parent_id
    FROM block
    WHERE type = 'page' AND alive = 1 AND last_edited_time > ?
    ORDER BY last_edited_time DESC
    LIMIT 25
  `).all(since);

  log.info(`  Found ${pages.length} recently modified page(s)`);

  const result = [];
  for (const page of pages) {
    const title = extractText(page.properties);

    // Get content blocks for this page
    const blocks = db.prepare(`
      SELECT type, properties
      FROM block
      WHERE parent_id = ? AND alive = 1
      LIMIT 30
    `).all(page.id);

    const content = blocks
      .map((b) => extractText(b.properties))
      .filter((t) => t && t !== 'Untitled')
      .join(' ')
      .slice(0, 500);

    result.push({ id: page.id, title, content, lastEdited: page.last_edited_time });
  }

  db.close();
  return result;
}

/**
 * Get a specific Notion page and all its content blocks by page ID (with or without hyphens).
 */
function getNotionPageById(rawId) {
  const dbPath = process.env.NOTION_DB_PATH;
  if (!dbPath) return null;
  const db = new Database(dbPath, { readonly: true });

  // Notion stores IDs with hyphens; URL has them without
  const withHyphens = rawId.includes('-') ? rawId
    : `${rawId.slice(0,8)}-${rawId.slice(8,12)}-${rawId.slice(12,16)}-${rawId.slice(16,20)}-${rawId.slice(20)}`;
  const withoutHyphens = withHyphens.replace(/-/g, '');

  let page = db.prepare('SELECT id, properties FROM block WHERE id = ? AND alive = 1').get(withHyphens)
           ?? db.prepare('SELECT id, properties FROM block WHERE id = ? AND alive = 1').get(withoutHyphens);

  if (!page) { db.close(); return null; }

  const title = extractText(page.properties);
  const blocks = db.prepare(`
    SELECT type, properties FROM block
    WHERE parent_id = ? AND alive = 1
    ORDER BY created_time ASC
    LIMIT 150
  `).all(page.id);

  const lines = blocks
    .map((b) => extractText(b.properties))
    .filter((t) => t && t !== 'Untitled');

  db.close();
  log.info(`  Loaded target page: "${title}" (${lines.length} blocks)`);
  return { title, content: lines.join('\n') };
}

// ─── Notion API (write) ───────────────────────────────────────────────────────

async function notionApi(method, endpoint, body) {
  const apiKey = process.env.NOTION_API_KEY;
  const payload = body ? JSON.stringify(body) : null;
  const resp = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    ...(payload ? { body: payload } : {}),
  });
  const data = await resp.json();
  if (data.object === 'error') throw new Error(`Notion API: ${data.message}`);
  return data;
}

async function getPageBlockIds(pageId) {
  const data = await notionApi('GET', `/blocks/${pageId}/children?page_size=100`);
  return (data.results || []).map((b) => b.id);
}

async function clearPageContent(pageId) {
  const ids = await getPageBlockIds(pageId);
  for (const id of ids) {
    await notionApi('PATCH', `/blocks/${id}`, { archived: true });
  }
  log.info(`  Cleared ${ids.length} existing blocks`);
}

async function appendBlocks(pageId, blocks) {
  // Notion allows max 100 children per request
  for (let i = 0; i < blocks.length; i += 100) {
    await notionApi('PATCH', `/blocks/${pageId}/children`, {
      children: blocks.slice(i, i + 100),
    });
  }
}

/**
 * Parse inline markdown (bold, italic, links) into Notion rich_text array.
 */
function parseRichText(text) {
  const segments = [];
  const re = /\*\*([^*]+)\*\*|__([^_]+)__|_([^_]+)_|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)|(`[^`]+`)|([^*_\[`]+)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match[1] || match[2]) { // **bold** or __bold__
      segments.push({ type: 'text', text: { content: match[1] ?? match[2] }, annotations: { bold: true } });
    } else if (match[3] || match[4]) { // _italic_ or *italic*
      segments.push({ type: 'text', text: { content: match[3] ?? match[4] }, annotations: { italic: true } });
    } else if (match[5] && match[6]) { // [link](url)
      segments.push({ type: 'text', text: { content: match[5], link: { url: match[6] } } });
    } else if (match[7]) { // `code`
      segments.push({ type: 'text', text: { content: match[7].slice(1, -1) }, annotations: { code: true } });
    } else if (match[8]) {
      segments.push({ type: 'text', text: { content: match[8] } });
    }
  }
  return segments.length ? segments : [{ type: 'text', text: { content: text } }];
}

/**
 * Convert a simple markdown string into an array of Notion block objects.
 */
function markdownToNotionBlocks(markdown) {
  const lines = markdown.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (/^### (.+)/.test(line)) {
      blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: parseRichText(line.slice(4)) } });
    } else if (/^## (.+)/.test(line)) {
      blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: parseRichText(line.slice(3)) } });
    } else if (/^# (.+)/.test(line)) {
      blocks.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: parseRichText(line.slice(2)) } });
    } else if (/^[-*] (.+)/.test(line)) {
      blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: parseRichText(line.slice(2)) } });
    } else if (/^\d+\. (.+)/.test(line)) {
      blocks.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: parseRichText(line.replace(/^\d+\. /, '')) } });
    } else if (/^> (.+)/.test(line)) {
      blocks.push({ object: 'block', type: 'quote', quote: { rich_text: parseRichText(line.slice(2)) } });
    } else if (/^---+$/.test(line.trim())) {
      blocks.push({ object: 'block', type: 'divider', divider: {} });
    } else if (line.trim() === '') {
      // skip blank lines
    } else {
      blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: parseRichText(line) } });
    }
    i++;
  }
  return blocks;
}

async function updateNotionPage(pageId, markdownContent) {
  log.step('Updating Notion page...');
  const withHyphens = pageId.includes('-') ? pageId
    : `${pageId.slice(0,8)}-${pageId.slice(8,12)}-${pageId.slice(12,16)}-${pageId.slice(16,20)}-${pageId.slice(20)}`;
  await clearPageContent(withHyphens);
  const blocks = markdownToNotionBlocks(markdownContent);
  await appendBlocks(withHyphens, blocks);
  log.success(`Notion page updated (${blocks.length} blocks written)`);
}

// ─── Clipboard (macOS HTML) ───────────────────────────────────────────────────

function inlineHtml(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function markdownToHtml(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  let ulOpen = false;
  let olOpen = false;

  function closeLists() {
    if (ulOpen) { out.push('</ul>'); ulOpen = false; }
    if (olOpen) { out.push('</ol>'); olOpen = false; }
  }

  for (const line of lines) {
    if (/^### (.+)/.test(line))       { closeLists(); out.push(`<h3>${inlineHtml(line.slice(4))}</h3>`); }
    else if (/^## (.+)/.test(line))   { closeLists(); out.push(`<h2>${inlineHtml(line.slice(3))}</h2>`); }
    else if (/^# (.+)/.test(line))    { closeLists(); out.push(`<h1>${inlineHtml(line.slice(2))}</h1>`); }
    else if (/^[-*] (.+)/.test(line)) { if (!ulOpen) { closeLists(); out.push('<ul>'); ulOpen = true; } out.push(`<li>${inlineHtml(line.slice(2))}</li>`); }
    else if (/^\d+\. (.+)/.test(line)){ if (!olOpen) { closeLists(); out.push('<ol>'); olOpen = true; } out.push(`<li>${inlineHtml(line.replace(/^\d+\. /, ''))}</li>`); }
    else if (/^> (.+)/.test(line))    { closeLists(); out.push(`<blockquote>${inlineHtml(line.slice(2))}</blockquote>`); }
    else if (/^---+$/.test(line.trim())) { closeLists(); out.push('<hr>'); }
    else if (line.trim() === '')      { closeLists(); }
    else                              { closeLists(); out.push(`<p>${inlineHtml(line)}</p>`); }
  }
  closeLists();
  return out.join('\n');
}

function copyHtmlToClipboard(html) {
  const tmpPath = '/tmp/notion-clipboard.html';
  fs.writeFileSync(tmpPath, `<html><body>${html}</body></html>`, 'utf8');
  execSync(
    `osascript -e 'set c to (read POSIX file "/tmp/notion-clipboard.html" as «class utf8»)' ` +
    `-e 'set the clipboard to {«class HTML»:c, string:c}'`
  );
  log.success('Formatted content copied to clipboard');
}

// ─── Claude ───────────────────────────────────────────────────────────────────
async function analyzeWithClaude(prompt, maxTokens = 2048) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  return message.content[0]?.text ?? '';
}

// ─── Morning run ──────────────────────────────────────────────────────────────
async function runMorning(userId, selfChannel) {
  log.step('Running morning analysis...');

  const [mentions, activeThreads, notionPages] = await Promise.all([
    getSlackMentions(userId, 24),
    getSlackActiveThreads(userId, 24),
    Promise.resolve(getNotionContext(7)),
  ]);

  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const prompt = `You are a product manager's assistant. Today is ${date}.

Here is the context from the last 24 hours:

## Slack mentions (people tagged you)
${mentions.length > 0
  ? mentions.map((m) => `- [#${m.channel}] ${m.user}: "${m.text}"`).join('\n')
  : '(no mentions)'}

## Your recent Slack messages
${activeThreads.length > 0
  ? activeThreads.map((m) => `- [#${m.channel}] You: "${m.text}"`).join('\n')
  : '(no messages)'}

## Notion pages modified in the last 7 days
${notionPages.length > 0
  ? notionPages.map((p) => `- "${p.title}": ${p.content || '(no preview)'}`).join('\n')
  : '(no recent pages)'}

## Active goal
${config.product.goal}

Based on all this context, produce a morning briefing in Slack mrkdwn format with these sections:

*Good morning ${config.pm.name}!* 👋

*Top 3 priorities for today:*
1. ...
2. ...
3. ...

*Slack threads that need your attention:*
• ... (be specific about what action is needed for each)

*Notion pages that may need updating:*
• Page: "..." — Suggested update: ... (be specific about what's likely outdated based on Slack context)
• ...

_Reply *yes* to this message to confirm the Notion updates — I'll remind you at EOD._

Keep it concise, actionable, and focused on ${config.product.name}.`;

  log.step('Asking Claude for morning briefing...');
  const briefing = await analyzeWithClaude(prompt);

  log.step('Posting morning briefing to Slack...');
  const ts = await postSlackMessage(selfChannel, briefing);
  log.success(`Morning message posted (ts: ${ts})`);

  // Save state for EOD run
  const state = loadState();
  state.morningTs = ts;
  state.morningChannel = selfChannel;
  state.morningDate = new Date().toISOString().slice(0, 10);
  state.notionProposals = notionPages.filter((p) => p.title !== 'Untitled').map((p) => p.title);
  saveState(state);

  writeAgentStatus({
    lastMorningRun: new Date().toISOString(),
    morningStatus: 'success',
    mentionsCount: mentions.length,
    notionPagesCount: notionPages.length,
    notionProposalsPending: state.notionProposals,
    tokenExpired: false,
    errors: [],
  });
}

// ─── EOD run ─────────────────────────────────────────────────────────────────
async function runEOD(userId, selfChannel) {
  log.step('Running EOD analysis...');

  const state = loadState();
  const today = new Date().toISOString().slice(0, 10);

  // Check if user confirmed Notion proposals in morning thread
  let userConfirmed = false;
  if (state.morningTs && state.morningDate === today) {
    const replies = await getMorningThreadReplies(state.morningChannel, state.morningTs);
    // Look for a "yes" reply from the user (skip the first message which is the bot's)
    userConfirmed = replies.slice(1).some((r) =>
      r.user === userId && /\byes\b/i.test(r.text)
    );
    if (userConfirmed) log.info('User confirmed Notion proposals ✓');
    else log.info('No confirmation found in morning thread');
  }

  const [mentions, activeThreads] = await Promise.all([
    getSlackMentions(userId, 10), // last 10h for EOD
    getSlackActiveThreads(userId, 10),
  ]);

  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const context = `## Slack mentions today
${mentions.length > 0
  ? mentions.map((m) => `- [#${m.channel}] ${m.user}: "${m.text}"`).join('\n')
  : '(none)'}

## Messages you sent today
${activeThreads.length > 0
  ? activeThreads.map((m) => `- [#${m.channel}] You: "${m.text}"`).join('\n')
  : '(none)'}

## Notion proposals from this morning
${state.notionProposals?.join(', ') || '(none)'}

## User confirmed Notion updates: ${userConfirmed ? 'YES' : 'NO'}

## Active goal
${config.product.goal}`;

  // ── Personal EOD summary ──
  const summaryPrompt = `You are a product manager's assistant. Today is ${date} and it's end of day.

${context}

Produce a concise personal EOD summary in Slack mrkdwn format:

*EOD Summary* 🌅

*What moved forward today:*
• ...

*Still open / needs follow-up tomorrow:*
• ...

${userConfirmed
  ? `*Notion updates to apply now:*\n${state.notionProposals?.map((p) => `• "${p}" — review and update based on today's Slack context`).join('\n') || ''}`
  : '*Notion updates:* No confirmation received — proposals are saved for tomorrow.'}

Keep it short. Focus on ${config.product.name} progress.`;

  // ── Team update draft ──
  const teamUpdatePrompt = `You are a product manager's assistant. Today is ${date} and it's end of day.

${context}

Produce a draft end-of-day update message ready to be sent to all teams. Use Slack mrkdwn format.

Structure it exactly like this:

*📋 EOD Team Update — ${date}*

*Overall Summary*
[2-3 sentence summary of what happened today across all topics]

---

Then one section per team inferred from the Slack channels and people involved. For each team:

*[Team Name]*
✅ *Accomplished & agreed:*
• [what was decided, completed, or aligned on with this team]

❓ *Open questions & next actions:*
• [action or question] → @[person responsible]

---

Keep each team section tight. Only include teams that had real activity today. Infer team names from channel names (e.g. #eng-card → Card Engineering, #design → Design, #product → Product).`;

  log.step('Asking Claude for EOD summary...');
  log.step('Asking Claude for team update draft...');
  const [summary, teamUpdate] = await Promise.all([
    analyzeWithClaude(summaryPrompt),
    analyzeWithClaude(teamUpdatePrompt, 4096),
  ]);

  log.step('Posting EOD messages to Slack...');
  await postSlackMessage(selfChannel, summary);
  await postSlackMessage(selfChannel, teamUpdate);
  log.success('EOD message posted');

  writeAgentStatus({
    lastEodRun: new Date().toISOString(),
    eodStatus: 'success',
    mentionsCount: mentions.length,
    errors: [],
  });
}

// ─── Task run ─────────────────────────────────────────────────────────────────
async function runTask(instruction, userId, selfChannel) {
  log.step('Running ad-hoc task...');

  // Extract Notion page ID from instruction URL if present
  const notionUrlMatch = instruction.match(/notion\.so\/[^\s]*?([a-f0-9]{32})(?:\?|\s|$)/i);
  const notionPageId = notionUrlMatch?.[1] ?? null;

  const [mentions, activeThreads, notionPages] = await Promise.all([
    getSlackMentions(userId, 72),
    getSlackActiveThreads(userId, 72),
    Promise.resolve(getNotionContext(14)),
  ]);

  let targetPage = null;
  if (notionPageId) {
    log.info(`Looking up Notion page: ${notionPageId}`);
    targetPage = getNotionPageById(notionPageId);
    if (!targetPage) log.warning('Target page not found in local Notion DB — may not be synced yet.');
  }

  const hasNotionApi = !!notionPageId && !!process.env.NOTION_API_KEY;
  const isNotionUpdate = !!notionPageId;

  const prompt = `You are a product manager's assistant with full context from Slack and Notion.

## Task
${instruction}

## Slack mentions (last 72h)
${mentions.length > 0
  ? mentions.map((m) => `- [#${m.channel}] ${m.user}: "${m.text}"`).join('\n')
  : '(none)'}

## Your recent Slack messages (last 72h)
${activeThreads.length > 0
  ? activeThreads.map((m) => `- [#${m.channel}] You: "${m.text}"`).join('\n')
  : '(none)'}

## Recently modified Notion pages (last 14 days)
${notionPages.length > 0
  ? notionPages.map((p) => `- "${p.title}": ${p.content || '(no preview)'}`).join('\n')
  : '(none)'}

${targetPage
  ? `## Current content of the target Notion page: "${targetPage.title}"\n${targetPage.content}`
  : notionPageId ? '## Target Notion page: not found in local cache — use surrounding context to infer updates.' : ''}

${isNotionUpdate
  ? `Output ONLY the full updated page content in clean markdown (# headings, ## subheadings, - bullets, **bold**). No preamble, no explanation — just the page content. It will be written directly to Notion.`
  : `Execute the task using the context above. Format your response in Slack mrkdwn so I can review it easily.`}`;

  log.step('Asking Claude to execute task...');
  const result = await analyzeWithClaude(prompt);

  if (isNotionUpdate && hasNotionApi) {
    await updateNotionPage(notionPageId, result);
    log.step('Posting confirmation to Slack...');
    await postSlackMessage(selfChannel, `✅ *Notion page updated*: <https://www.notion.so/${notionPageId.replace(/-/g, '')}|${targetPage?.title ?? 'page'}>`);
    log.success('Notion page updated and Slack confirmation sent');
  } else if (isNotionUpdate) {
    // No API key — copy formatted HTML to clipboard so user can Cmd+V directly into Notion
    const html = markdownToHtml(result);
    copyHtmlToClipboard(html);
    log.step('Posting confirmation to Slack...');
    await postSlackMessage(selfChannel,
      `📋 *Content ready — just Cmd+V into the Notion page and it will paste with proper formatting.*\n<https://www.notion.so/${notionPageId.replace(/-/g, '')}|Open page>`
    );
    log.success('HTML copied to clipboard, confirmation sent to Slack');
  } else {
    log.step('Posting result to Slack...');
    await postSlackMessage(selfChannel, result);
    log.success('Task result posted to your Slack DM');
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const mode = process.argv[2];
  if (!mode || !['morning', 'eod', 'task'].includes(mode)) {
    log.error('Usage: node agent.mjs [morning|eod|task "instruction"]');
    process.exit(1);
  }

  const taskInstruction = process.argv[3];
  if (mode === 'task' && !taskInstruction) {
    log.error('Usage: node agent.mjs task "your instruction here"');
    process.exit(1);
  }

  loadEnv();

  if (!process.env.ANTHROPIC_API_KEY) {
    log.error('ANTHROPIC_API_KEY not set in .env');
    process.exit(1);
  }

  log.info(`Product Sense Agent — ${mode} run — ${new Date().toISOString()}`);

  // Connect to Slack via MCP
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
  log.info(`Self DM channel: ${selfChannel}`);

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

main().catch((err) => {
  log.error(err.message ?? String(err));
  process.exit(1);
});
