# PM Agent Framework Setup

You are setting up a personalized multi-agent AI assistant framework for a Product Manager. This framework runs specialized team agents that monitor Slack and Notion, post daily briefings, and accumulate memory over time.

**CRITICAL: Do NOT use any hardcoded personal data, API keys, tokens, emails, user IDs, or workspace-specific values. Everything personal must come from the user during this conversation or from environment variables at runtime.**

---

## Step 1 — Gather information

Ask the user these questions one group at a time. Wait for their answers before proceeding.

**Group A — Identity & product:**
1. What is your first name? (used to personalize agent prompts)
2. What company do you work at?
3. What product or initiative are you a PM for? (1–2 sentences describing what it is)
4. What is your main goal for this product right now? (deadline, launch, milestone)

**Group B — Teams:**
5. What teams do you work with? List 2–6 team names (e.g. "Design, Engineering, Mobile, Growth"). Each will become a dedicated agent.
6. For each team, ask:
   - What Slack channel names are relevant to this team? (comma-separated, partial names ok, e.g. "design, card-design, ux")
   - What Notion keywords identify pages relevant to this team? (e.g. "design, figma, admin experience")
   - In one sentence, what does this team work on?

**Group C — Setup:**
7. Which AI provider do you want to use? (default: anthropic)
   Options: `anthropic` (Claude) · `openai` (GPT-4o) · `gemini` (Google) · `kimi` (Moonshot) · `deepseek` · `groq` (Llama) · `mistral`
   Ask them to have the API key ready — they'll add it to `.env` after setup.
8. Which IDE are you using? (Cursor / VS Code / Windsurf / Claude Code / Other)
   - If **Cursor**: the Slack token is read automatically — no extra steps.
   - If **anything else**: tell them to connect the Slack MCP in their IDE, then copy the token and paste it as `SLACK_MCP_TOKEN` in `.env`.
9. Where do you want to create the project folder? (full path, e.g. `/Users/yourname/pm-agents`)
10. What time should the morning briefing run? (default: 8:00 AM weekdays)
11. What time should the EOD briefing run? (default: 6:00 PM weekdays)

Once you have all answers, proceed to Step 2.

---

## Step 2 — Create the project structure

Create the following directory structure at the path the user specified:

```
{project_dir}/
  agents/           ← one file per team
  lib/              ← shared utilities
  dashboard/        ← monitoring UI
  .env.example      ← placeholder credentials (NO real values)
  orchestrator.mjs  ← main entry point
  package.json
```

---

## Step 3 — Write all files

### `lib/logger.mjs`
Write this exactly as-is (no personalization needed):
```js
const c = {
  blue: '\x1b[0;34m', green: '\x1b[0;32m',
  yellow: '\x1b[1;33m', red: '\x1b[0;31m',
  magenta: '\x1b[0;35m', cyan: '\x1b[0;36m', reset: '\x1b[0m',
};

export const log = {
  info:    (m) => console.log(`${c.blue}[INFO]${c.reset} ${m}`),
  success: (m) => console.log(`${c.green}[SUCCESS]${c.reset} ${m}`),
  warning: (m) => console.warn(`${c.yellow}[WARNING]${c.reset} ${m}`),
  error:   (m) => console.error(`${c.red}[ERROR]${c.reset} ${m}`),
  step:    (m) => console.log(`${c.magenta}[STEP]${c.reset} ${m}`),
  agent:   (name, m) => console.log(`${c.cyan}[${name.toUpperCase()}]${c.reset} ${m}`),
};
```

### `lib/env.mjs`
Write this exactly as-is:
```js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log } from './logger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    log.error('Missing .env file. Copy .env.example and fill in your values.');
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
```

### `lib/claude.mjs`
Write this exactly as-is (supports all providers via config.mjs → ai.provider):
```js
import config from '../config.mjs';

const PROVIDERS = {
  openai:   { baseURL: 'https://api.openai.com/v1',                               envKey: 'OPENAI_API_KEY',   defaultModel: 'gpt-4o' },
  gemini:   { baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', envKey: 'GEMINI_API_KEY',   defaultModel: 'gemini-2.0-flash' },
  kimi:     { baseURL: 'https://api.moonshot.cn/v1',                               envKey: 'KIMI_API_KEY',     defaultModel: 'moonshot-v1-32k' },
  deepseek: { baseURL: 'https://api.deepseek.com',                                 envKey: 'DEEPSEEK_API_KEY', defaultModel: 'deepseek-chat' },
  groq:     { baseURL: 'https://api.groq.com/openai/v1',                           envKey: 'GROQ_API_KEY',     defaultModel: 'llama-3.3-70b-versatile' },
  mistral:  { baseURL: 'https://api.mistral.ai/v1',                                envKey: 'MISTRAL_API_KEY',  defaultModel: 'mistral-large-latest' },
};

async function callAnthropic(userPrompt, { systemPrompt, maxTokens }) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const params = {
    model: config.ai?.model ?? 'claude-opus-4-6',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: userPrompt }],
  };
  if (systemPrompt) params.system = systemPrompt;
  const message = await client.messages.create(params);
  return message.content[0]?.text ?? '';
}

async function callOpenAICompat(userPrompt, { systemPrompt, maxTokens }, providerKey) {
  const cfg = PROVIDERS[providerKey];
  const apiKey = process.env[cfg.envKey];
  if (!apiKey) throw new Error(`${cfg.envKey} not set in .env (required for provider: ${providerKey})`);
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey, baseURL: cfg.baseURL });
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });
  const response = await client.chat.completions.create({
    model: config.ai?.model ?? cfg.defaultModel,
    max_tokens: maxTokens,
    messages,
  });
  return response.choices[0]?.message?.content ?? '';
}

async function call(userPrompt, { systemPrompt = null, maxTokens = 2048 } = {}) {
  const provider = config.ai?.provider ?? 'anthropic';
  if (provider === 'anthropic') return callAnthropic(userPrompt, { systemPrompt, maxTokens });
  if (PROVIDERS[provider]) return callOpenAICompat(userPrompt, { systemPrompt, maxTokens }, provider);
  throw new Error(`Unknown AI provider: "${provider}". Valid options: anthropic, ${Object.keys(PROVIDERS).join(', ')}`);
}

export const callClaude = call;
export const analyzeWithClaude = (prompt, maxTokens = 2048) => call(prompt, { maxTokens });
```

### `lib/slack-mcp.mjs`
Write this exactly as-is (calls the Slack MCP server directly via JSON-RPC — proper OAuth, no browser cookies):
```js
import { log } from './logger.mjs';

async function mcpTool(name, args = {}) {
  const token = process.env.SLACK_MCP_TOKEN;
  if (!token) throw new Error('SLACK_MCP_TOKEN not set in .env');
  const resp = await fetch('https://mcp.slack.com/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(`MCP ${name} error: ${data.error.message}`);
  const text = data.result?.content?.[0]?.text;
  if (!text) throw new Error(`MCP ${name}: empty response`);
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function parseSearchResults(raw) {
  const text = typeof raw === 'string' ? raw : raw.results || '';
  const blocks = text.split(/\n---\n/);
  const results = [];
  for (const block of blocks) {
    const channelMatch = block.match(/Channel: #?(.*?)\s*\(ID:\s*(C\w+)\)/);
    const fromMatch = block.match(/From: .+?\(ID:\s*(U\w+)\)/);
    const usernameMatch = block.match(/From: ([^(]+)\s*\(ID:/);
    const tsMatch = block.match(/Message_ts:\s*([\d.]+)/);
    const permalinkMatch = block.match(/Permalink:\s*\[link\]\((https?:\/\/[^)]+)\)/);
    const textMatch = block.match(/Text:\s*\n([\s\S]*?)(?:\n\n|$)/);
    if (!tsMatch) continue;
    results.push({
      channel: channelMatch ? channelMatch[1].trim() : '',
      channelId: channelMatch ? channelMatch[2] : '',
      user: usernameMatch ? usernameMatch[1].trim() : '',
      userId: fromMatch ? fromMatch[1] : '',
      text: textMatch ? textMatch[1].trim() : '',
      ts: tsMatch[1],
      permalink: permalinkMatch ? permalinkMatch[1] : '',
    });
  }
  return results;
}

function parseThreadMessages(raw) {
  const text = typeof raw === 'string' ? raw : raw.messages || '';
  const blocks = text.split(/\n(?===)/);
  const messages = [];
  for (const block of blocks) {
    const fromMatch = block.match(/From:\s*.+?\((U\w+)\)/);
    const tsMatch = block.match(/Message TS:\s*([\d.]+)/);
    const afterMeta = block.replace(/^=+[^=]+=+\n/, '').replace(/^From:.*\n/m, '').replace(/^Time:.*\n/m, '').replace(/^Message TS:.*\n/m, '');
    if (!fromMatch) continue;
    messages.push({ user: fromMatch[1], text: afterMeta.trim(), ts: tsMatch ? tsMatch[1] : '' });
  }
  return messages;
}

export async function getMyUserId() {
  const data = await mcpTool('slack_read_user_profile');
  const match = (data.result || '').match(/User ID:\s*(\S+)/);
  if (!match) throw new Error('Could not parse user ID from profile');
  return match[1];
}

export async function getSlackMentions(userId, hoursBack = 24) {
  const oldest = Date.now() / 1000 - hoursBack * 3600;
  const data = await mcpTool('slack_search_public_and_private', { query: `<@${userId}>`, count: 30 });
  return parseSearchResults(data).filter(m => parseFloat(m.ts) > oldest);
}

export async function getSlackActiveThreads(userId, hoursBack = 24) {
  const oldest = Date.now() / 1000 - hoursBack * 3600;
  const data = await mcpTool('slack_search_public_and_private', { query: `from:<@${userId}>`, count: 20 });
  return parseSearchResults(data).filter(m => parseFloat(m.ts) > oldest && m.userId === userId);
}

export async function getMorningThreadReplies(channelId, threadTs) {
  try {
    const data = await mcpTool('slack_read_thread', { channel_id: channelId, message_ts: threadTs, limit: 50 });
    return parseThreadMessages(data);
  } catch { return []; }
}

export async function getSelfDMChannel(userId) {
  return userId; // slack_send_message accepts user IDs directly as DM targets
}

export async function postSlackMessage(channelId, text) {
  const data = await mcpTool('slack_send_message', { channel_id: channelId, message: text });
  return data.message_context?.message_ts || '';
}

export async function postSlackReply(channelId, threadTs, text) {
  const data = await mcpTool('slack_send_message', { channel_id: channelId, message: text, thread_ts: threadTs });
  return data.message_context?.message_ts || '';
}

export async function notifyTokenExpired() {
  log.warning('Slack MCP token expired. Re-authorize in Cursor: open Cursor → MCP settings → reconnect Slack → copy new token to .env as SLACK_MCP_TOKEN.');
}
```

### `lib/notion.mjs`
Write this exactly as-is (reads Notion's local SQLite database — no API key needed for reads):
```js
import Database from 'better-sqlite3';
import { log } from './logger.mjs';

function extractText(properties) {
  if (!properties) return 'Untitled';
  try {
    const props = typeof properties === 'string' ? JSON.parse(properties) : properties;
    return (props.title || []).map(t => Array.isArray(t) ? t[0] : t).join('').trim() || 'Untitled';
  } catch { return 'Untitled'; }
}

export function getNotionContext(daysBack = 7) {
  const dbPath = process.env.NOTION_DB_PATH;
  const db = new Database(dbPath, { readonly: true });
  const since = Date.now() - daysBack * 24 * 3600 * 1000;
  const pages = db.prepare(`
    SELECT id, properties, last_edited_time FROM block
    WHERE type = 'page' AND alive = 1 AND last_edited_time > ?
    ORDER BY last_edited_time DESC LIMIT 30
  `).all(since);
  const result = [];
  for (const page of pages) {
    const title = extractText(page.properties);
    const blocks = db.prepare(`SELECT type, properties FROM block WHERE parent_id = ? AND alive = 1 LIMIT 30`).all(page.id);
    const content = blocks.map(b => extractText(b.properties)).filter(t => t && t !== 'Untitled').join(' ').slice(0, 500);
    result.push({ id: page.id, title, content, lastEdited: page.last_edited_time });
  }
  db.close();
  return result;
}

export function filterNotionPages(pages, keywords) {
  if (!keywords || keywords.length === 0) return pages;
  const kw = keywords.map(k => k.toLowerCase());
  return pages.filter(p => kw.some(k => p.title.toLowerCase().includes(k)));
}
```

### `lib/state.mjs`
Write this exactly as-is:
```js
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '..', 'state.json');

export function loadState() {
  if (!fs.existsSync(STATE_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return {}; }
}

export function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

export function writeAgentStatus(patch) {
  const agentsDir = path.join(os.homedir(), '.agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  const filePath = path.join(agentsDir, 'product-agent.json');
  let current = {};
  if (fs.existsSync(filePath)) {
    try { current = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch {}
  }
  fs.writeFileSync(filePath, JSON.stringify({ ...current, ...patch }, null, 2), 'utf8');
}
```

### `lib/clipboard.mjs`
Write this exactly as-is (macOS only):
```js
import fs from 'fs';
import { execSync } from 'child_process';
import { log } from './logger.mjs';

function inlineHtml(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

export function markdownToHtml(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  let ulOpen = false, olOpen = false;
  function closeLists() {
    if (ulOpen) { out.push('</ul>'); ulOpen = false; }
    if (olOpen) { out.push('</ol>'); olOpen = false; }
  }
  for (const line of lines) {
    if      (/^### (.+)/.test(line))     { closeLists(); out.push(`<h3>${inlineHtml(line.slice(4))}</h3>`); }
    else if (/^## (.+)/.test(line))      { closeLists(); out.push(`<h2>${inlineHtml(line.slice(3))}</h2>`); }
    else if (/^# (.+)/.test(line))       { closeLists(); out.push(`<h1>${inlineHtml(line.slice(2))}</h1>`); }
    else if (/^[-*] (.+)/.test(line))    { if (!ulOpen) { closeLists(); out.push('<ul>'); ulOpen = true; } out.push(`<li>${inlineHtml(line.slice(2))}</li>`); }
    else if (/^\d+\. (.+)/.test(line))   { if (!olOpen) { closeLists(); out.push('<ol>'); olOpen = true; } out.push(`<li>${inlineHtml(line.replace(/^\d+\. /, ''))}</li>`); }
    else if (/^> (.+)/.test(line))       { closeLists(); out.push(`<blockquote>${inlineHtml(line.slice(2))}</blockquote>`); }
    else if (/^---+$/.test(line.trim())) { closeLists(); out.push('<hr>'); }
    else if (line.trim() === '')         { closeLists(); }
    else                                 { closeLists(); out.push(`<p>${inlineHtml(line)}</p>`); }
  }
  closeLists();
  return out.join('\n');
}

export function copyHtmlToClipboard(html) {
  const tmpPath = '/tmp/pm-agent-clipboard.html';
  fs.writeFileSync(tmpPath, `<html><body>${html}</body></html>`, 'utf8');
  execSync(
    `osascript -e 'set c to (read POSIX file "/tmp/pm-agent-clipboard.html" as «class utf8»)' ` +
    `-e 'set the clipboard to {«class HTML»:c, string:c}'`
  );
  log.success('Formatted content copied to clipboard');
}
```

### `lib/memory.mjs`
Write this exactly as-is:
```js
import fs from 'fs';
import path from 'path';
import os from 'os';
import { callClaude } from './claude.mjs';

const AGENTS_DIR = path.join(os.homedir(), '.agents');
const MAX_MEMORY_CHARS = 8000;
const COMPRESSED_TARGET = 3000;

function memoryPath(slug) {
  return path.join(AGENTS_DIR, `memory-${slug}.md`);
}

export function loadMemory(slug) {
  const p = memoryPath(slug);
  if (!fs.existsSync(p)) return '';
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function appendToMemory(slug, agentName, learnings) {
  fs.mkdirSync(AGENTS_DIR, { recursive: true });
  const p = memoryPath(slug);
  const existing = loadMemory(slug);
  const header = existing ? '' : `# ${agentName} Agent Memory\n\n`;
  const entry = `\n---\n[${new Date().toISOString().slice(0, 10)}]\n${learnings}\n`;
  fs.writeFileSync(p, header + existing + entry, 'utf8');
}

async function compressMemoryIfNeeded(slug, agentName) {
  const current = loadMemory(slug);
  if (current.length <= MAX_MEMORY_CHARS) return;
  try {
    const compressed = await callClaude(
      `You are compressing an AI agent's accumulated memory log. Preserve all specific facts, decisions, and open questions. Remove redundancy and resolved items.\n\nCurrent memory (${current.length} chars):\n${current}\n\nProduce a compressed summary under ${COMPRESSED_TARGET} chars. Keep: specific decisions with dates, unresolved open questions, key people and their roles, important product facts and patterns. Remove: vague observations, items clearly resolved, duplicate information.`,
      { maxTokens: 1000 }
    );
    fs.writeFileSync(
      memoryPath(slug),
      `# ${agentName} Agent Memory (compressed ${new Date().toISOString().slice(0, 10)})\n\n${compressed}\n`,
      'utf8'
    );
  } catch {}
}

export async function extractAndSaveMemory(slug, agentName, output, date) {
  if (!output) return;
  try {
    const learnings = await callClaude(
      `You are building a long-term memory for an AI agent named "${agentName}".\n\nDate: ${date}\n\nThe agent just produced this output:\n${output.slice(0, 3000)}\n\nExtract 3-7 specific, concrete learnings to remember for future runs. Focus on:\n- Decisions made (who decided what, when)\n- Open questions that appeared or were resolved\n- New facts about the product, team, or integrations\n- Blockers or risks that surfaced\n- Important people mentioned and their roles/actions\n\nFormat as concise bullet points starting with "-". Be specific. Skip vague or generic observations.`,
      { maxTokens: 400 }
    );
    appendToMemory(slug, agentName, learnings);
    await compressMemoryIfNeeded(slug, agentName);
  } catch {}
}
```

---

### `agents/{slug}.mjs` — Generate one file per team

For each team the user provided, generate a file following this exact pattern. Use the user's name, company, product, and team-specific info. Do NOT invent channel names or keywords — use exactly what the user provided.

```js
import { callClaude } from '../lib/claude.mjs';

export const NAME = '{TeamName}';
export const SLUG = '{teamslug}';
export const CHANNELS = {channels array from user input};
export const NOTION_KEYWORDS = {keywords array from user input};
export const ROUTING_DESCRIPTION = '{one sentence describing what tasks this agent handles}';

export const SYSTEM_PROMPT = `You are the {TeamName} Agent for {UserFirstName}, a Product Manager at {Company} working on {product description}.

Your domain: {what this team works on, based on user's description}.

Active goal: {user's main product goal}.

When generating documents, you produce detailed, specific, actionable content — not just bullet summaries.
Format all Slack messages in mrkdwn. Format documents in clean markdown with clear headers.`;

function buildContext(ctx) {
  const memorySection = ctx.memory
    ? `## Your memory from prior runs\n${ctx.memory}\n\n`
    : '';

  const peers = ctx.agentOutputs
    ? Object.entries(ctx.agentOutputs)
        .filter(([slug]) => slug !== SLUG)
        .map(([, d]) => `### ${d.agentName} (${d.runAt ? d.runAt.slice(0, 10) : 'unknown'})\n${(d.slackMessage || '').slice(0, 600)}`)
        .join('\n\n')
    : '';
  const peersSection = peers ? `## What peer agents reported last run\n${peers}\n\n` : '';

  return `${memorySection}${peersSection}## Slack — {team} channels (last ${ctx.hoursBack}h)
${ctx.mentions.length > 0 ? ctx.mentions.map(m => `[#${m.channel}] ${m.user}: "${m.text}"`).join('\n') : '(none)'}

## Your recent messages in {team} channels
${ctx.threads.length > 0 ? ctx.threads.map(m => `[#${m.channel}] You: "${m.text}"`).join('\n') : '(none)'}

## Relevant Notion pages (last 14 days)
${ctx.notionPages.length > 0 ? ctx.notionPages.map(p => `- "${p.title}": ${p.content || '(no preview)'}`).join('\n') : '(none)'}

Today: ${ctx.date}`;
}

export async function morningBriefing(ctx) {
  const start = Date.now();
  try {
    const output = await callClaude(
      `${buildContext(ctx)}

Produce a morning briefing for the {TeamName} team. Cover:
- What needs attention or decisions today
- Any blockers or open questions
- Dependencies from or to other teams
- Timeline risks

Format as a tight Slack mrkdwn section starting with *{emoji} {TeamName}*. Max 8 lines.`,
      { systemPrompt: SYSTEM_PROMPT, maxTokens: 600 }
    );
    return { agentName: NAME, success: true, output, slackMessage: output, duration: Date.now() - start };
  } catch (err) {
    return { agentName: NAME, success: false, output: '', slackMessage: '', error: err, duration: Date.now() - start };
  }
}

export async function eodSummary(ctx) {
  const start = Date.now();
  try {
    const output = await callClaude(
      `${buildContext(ctx)}

Produce an EOD summary for the {TeamName} team. Cover:
- What was accomplished or decided today
- What's still open or blocked
- Action items and owners for tomorrow

Format as a tight Slack mrkdwn section starting with *{emoji} {TeamName}*. Max 8 lines.`,
      { systemPrompt: SYSTEM_PROMPT, maxTokens: 600 }
    );
    return { agentName: NAME, success: true, output, slackMessage: output, duration: Date.now() - start };
  } catch (err) {
    return { agentName: NAME, success: false, output: '', slackMessage: '', error: err, duration: Date.now() - start };
  }
}

export async function runTask(instruction, ctx) {
  const start = Date.now();
  try {
    const output = await callClaude(
      `${buildContext(ctx)}

## Task
${instruction}

Execute the task using the {team} context above. Write full documents, not just bullets. Be specific and detailed.`,
      { systemPrompt: SYSTEM_PROMPT, maxTokens: 4096 }
    );
    return { agentName: NAME, success: true, output, duration: Date.now() - start };
  } catch (err) {
    return { agentName: NAME, success: false, output: '', error: err, duration: Date.now() - start };
  }
}
```

Pick an appropriate emoji per team (🎨 design, 💳 engineering/payments, 🧾 billing/finance, 📱 mobile, 📊 strategy/stakeholders, 🚀 growth, 🔧 platform, 📣 marketing, etc).

---

### `orchestrator.mjs`

Generate this file replacing `{...}` with the actual agent imports and ALL_AGENTS array based on the teams provided. The logic is otherwise identical for every user:

```js
#!/usr/bin/env node
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

// ─── Load agents (one import per team) ───────────────────────────────────────
{insert one import per team, e.g.:}
import * as designAgent from './agents/design.mjs';
import * as engineeringAgent from './agents/engineering.mjs';
// etc.

const ALL_AGENTS = [{list all agent variables}];

// ─── Load last known peer outputs ─────────────────────────────────────────────
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

// ─── Per-agent output persistence ─────────────────────────────────────────────
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

// ─── Context filtering ────────────────────────────────────────────────────────
function filterContext(raw, agent) {
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
  const routingPrompt = `You are a task router for a PM assistant system.\n\nAvailable agents:\n${ALL_AGENTS.map(a => `- ${a.SLUG}: ${a.ROUTING_DESCRIPTION}`).join('\n')}\n\nTask: "${instruction}"\n\nWhich agents should handle this task? Reply with ONLY a JSON array of slugs, e.g.: ["design", "engineering"]\nUse "all" to route to every agent. Pick the minimum set needed.`;
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

// ─── Synthesize top 3 priorities ──────────────────────────────────────────────
async function synthesizeTop3(agentResults, date) {
  const sections = agentResults.filter(r => r.success).map(r => r.slackMessage).join('\n\n');
  return callClaude(
    `Today is ${date}. Here are briefings from ${ALL_AGENTS.length} specialized team agents:\n\n${sections}\n\nSynthesize into a single opening message with:\n- A one-line good morning greeting\n- *Top 3 priorities today* (numbered, specific, actionable)\n\nMax 6 lines. Slack mrkdwn. Be decisive — pick the 3 most important things across all teams.`,
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

  log.info('Loading agent memories and peer outputs...');
  const agentOutputs = loadAgentOutputs();
  const memories = Object.fromEntries(ALL_AGENTS.map(a => [a.SLUG, loadMemory(a.SLUG)]));

  const rawCtx = { date, hoursBack, mentions, threads, notionPages, rawMentions: mentions, rawThreads: threads, rawNotionPages: notionPages, agentOutputs };

  const onlySlug = process.argv.find((a, i) => process.argv[i-1] === '--only');
  const agentsToRun = onlySlug ? ALL_AGENTS.filter(a => a.SLUG === onlySlug) : ALL_AGENTS;

  log.step(`Running ${agentsToRun.map(a => a.NAME).join(', ')} in parallel...`);
  const results = await Promise.all(
    agentsToRun.map(agent => {
      log.agent(agent.NAME, 'starting morning briefing...');
      const ctx = { ...filterContext(rawCtx, agent), memory: memories[agent.SLUG] };
      return agent.morningBriefing(ctx)
        .then(r => { log.agent(agent.NAME, r.success ? `done (${r.duration}ms)` : `FAILED: ${r.error?.message}`); saveAgentOutput(agent.SLUG, 'morning', r); return r; });
    })
  );

  log.step('Saving agent learnings...');
  await Promise.all(
    results.filter(r => r.success).map(r => {
      const agent = ALL_AGENTS.find(a => a.NAME === r.agentName);
      return agent ? extractAndSaveMemory(agent.SLUG, agent.NAME, r.output, date) : Promise.resolve();
    })
  );

  log.step('Synthesizing top priorities...');
  const top3 = await synthesizeTop3(results, date);

  log.step('Posting to Slack...');
  const mainTs = await postSlackMessage(selfChannel, top3);
  for (const result of results) {
    if (result.success && result.slackMessage) await postSlackReply(selfChannel, mainTs, result.slackMessage);
  }

  log.success(`Morning briefing posted — main message + ${results.filter(r => r.success).length} agent threads`);

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

  const mainTs = await postSlackMessage(selfChannel, `*EOD Summary — ${date}*\n\nEnd-of-day report across all teams. See thread for details.`);
  for (const result of results) {
    if (result.success && result.slackMessage) await postSlackReply(selfChannel, mainTs, result.slackMessage);
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
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  log.info('Fetching context...');
  const [mentions, threads, notionPages] = await Promise.all([
    getSlackMentions(userId, 72),
    getSlackActiveThreads(userId, 72),
    Promise.resolve(getNotionContext(14)),
  ]);

  const agentOutputs = loadAgentOutputs();
  const memories = Object.fromEntries(ALL_AGENTS.map(a => [a.SLUG, loadMemory(a.SLUG)]));
  const rawCtx = { date, hoursBack: 72, mentions, threads, notionPages, rawMentions: mentions, rawThreads: threads, rawNotionPages: notionPages, agentOutputs };

  log.step('Routing task...');
  const targetAgents = await routeTask(instruction);
  log.info(`  Routed to: ${targetAgents.map(a => a.NAME).join(', ')}`);

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

  for (const result of successResults) {
    const label = successResults.length > 1 ? `*[${result.agentName} Agent]*\n` : '';
    await postSlackMessage(selfChannel, label + result.output);
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

  log.info(`PM Agent Orchestrator — ${mode} — ${new Date().toISOString()}`);
  log.info(`Agents: ${ALL_AGENTS.map(a => a.NAME).join(', ')}`);

  log.step('Connecting to Slack via MCP...');
  let userId;
  try {
    userId = await getMyUserId();
    if (!userId) throw new Error('Could not resolve Slack user ID');
    log.success(`Slack user: ${userId}`);
  } catch (err) {
    log.error(`Slack MCP connection failed: ${err.message}`);
    await notifyTokenExpired();
    writeAgentStatus({ tokenExpired: true, errors: [err.message], [mode + 'Status']: 'error' });
    process.exit(1);
  }
  const selfChannel = await getSelfDMChannel(userId);

  if (mode === 'morning') await runMorning(userId, selfChannel);
  else if (mode === 'eod') await runEOD(userId, selfChannel);
  else await runTask(taskInstruction, userId, selfChannel);

  log.success('Done!');

  try {
    execSync(`node ${path.join(path.dirname(fileURLToPath(import.meta.url)), 'dashboard', 'generate.mjs')}`, { stdio: 'inherit' });
  } catch {
    log.warning('Could not regenerate dashboard');
  }
}

main().catch(err => {
  log.error(err.message ?? String(err));
  process.exit(1);
});
```

---

### `.env.example`

Write this with placeholder values only. Explain where to get each one in comments. NO real values.

```
# ─── Claude / Anthropic ───────────────────────────────────────────────────────
# Get your key at: https://console.anthropic.com
ANTHROPIC_API_KEY=sk-ant-your-key-here

# ─── Slack ────────────────────────────────────────────────────────────────────
# This is your personal OAuth token from the Slack MCP server.
# How to get it (requires Cursor IDE):
#   1. Open Cursor → Settings → MCP
#   2. Add the Slack MCP server:
#      URL: https://mcp.slack.com/mcp
#   3. Click "Connect" — it will open a Slack OAuth flow in your browser
#   4. Authorize it with your Slack account
#   5. Cursor stores the token. To extract it, run:
#      node -e "
#        const sqlite3 = require('better-sqlite3');
#        // path: ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb
#        // decrypt the mcp.oauth.tokens entry using your Cursor Safe Storage keychain key
#      "
#      (The setup command will extract this for you automatically if Cursor is installed)
# Note: tokens last ~12 hours and refresh automatically through Cursor.
SLACK_MCP_TOKEN=xoxe.xoxp-1-your-token-here

# ─── Notion ───────────────────────────────────────────────────────────────────
# Path to Notion's local SQLite database (reads without internet, no API key needed).
# On macOS, it's usually at one of these paths:
#   ~/Library/Application Support/Notion/notion.db
#   ~/notion/notion.db
# Run: find ~/Library -name "notion.db" 2>/dev/null
NOTION_DB_PATH=/Users/YOUR_USERNAME/Library/Application Support/Notion/notion.db
```

---

### `package.json`

```json
{
  "name": "pm-agents",
  "type": "module",
  "scripts": {
    "morning": "node orchestrator.mjs morning",
    "eod": "node orchestrator.mjs eod",
    "task": "node orchestrator.mjs task",
    "dashboard": "node dashboard/server.mjs"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "better-sqlite3": "^9.0.0"
  }
}
```

---

### `dashboard/server.mjs`

Write this exactly as-is:
```js
#!/usr/bin/env node
import http from 'http';
import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 3747;

function generate() {
  try {
    execSync(`node ${path.join(__dirname, 'generate.mjs')}`, { cwd: ROOT, stdio: 'pipe' });
  } catch (e) {
    console.error('generate failed:', e.message);
  }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    generate();
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html); return;
  }

  if (req.method === 'GET' && req.url === '/api/status') {
    generate();
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const match = html.match(/const DATA = ([\s\S]+?);\s*\n/);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(match ? match[1] : '{}'); return;
  }

  if (req.method === 'POST' && req.url === '/api/run') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { mode = 'morning', only = null } = JSON.parse(body || '{}');
        const args = ['orchestrator.mjs', mode];
        if (only) args.push('--only', only);
        const proc = spawn('/opt/homebrew/bin/node', args, {
          cwd: ROOT,
          detached: true,
          stdio: ['ignore', fs.openSync(path.join(process.env.HOME, '.pm-agent.log'), 'a'), fs.openSync(path.join(process.env.HOME, '.pm-agent.log'), 'a')],
        });
        proc.unref();
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, pid: proc.pid, mode, only }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
  try { execSync(`open http://localhost:${PORT}`); } catch {}
});
```

---

### `dashboard/generate.mjs`

Generate this file with:
- `AGENT_META` array built from the user's actual teams (slug, name, emoji, channels, keywords, routing, systemPrompt)
- All the dashboard HTML/CSS/JS — use the dark green terminal aesthetic
- `agentMemories` reading from `~/.agents/memory-{slug}.md` for each agent
- Each agent card showing: status badge, metrics, [LAST OUTPUT] section, [ACCUMULATED MEMORY] section, [RULES & INSTRUCTIONS] section, [MORNING] [EOD] run buttons
- `IS_SERVER` detection for run buttons
- Toast notifications
- `runAgent(mode, only, btn)` function calling `/api/run`

The dashboard reads these files from `~/.agents/`:
- `product-agent.json` — orchestrator status
- `output-{slug}.json` — each agent's last output
- `memory-{slug}.md` — each agent's accumulated memory

---

## Step 4 — LaunchAgent plists (macOS auto-scheduling)

Generate two plist files in `~/Library/LaunchAgents/` using the times the user specified. Use the actual project directory path the user provided.

**`com.{username}.pm-agents-morning.plist`:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.{username}.pm-agents-morning</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/zsh</string>
        <string>-c</string>
        <string>sleep 20 &amp;&amp; /opt/homebrew/bin/node {project_dir}/orchestrator.mjs morning</string>
    </array>
    <key>StartCalendarInterval</key>
    <array>
        <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>{morning_hour}</integer><key>Minute</key><integer>0</integer></dict>
        <dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>{morning_hour}</integer><key>Minute</key><integer>0</integer></dict>
        <dict><key>Weekday</key><integer>3</integer><key>Hour</key><integer>{morning_hour}</integer><key>Minute</key><integer>0</integer></dict>
        <dict><key>Weekday</key><integer>4</integer><key>Hour</key><integer>{morning_hour}</integer><key>Minute</key><integer>0</integer></dict>
        <dict><key>Weekday</key><integer>5</integer><key>Hour</key><integer>{morning_hour}</integer><key>Minute</key><integer>0</integer></dict>
    </array>
    <key>WorkingDirectory</key>
    <string>{project_dir}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key>
        <string>{home_dir}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>{home_dir}/.pm-agent.log</string>
    <key>StandardErrorPath</key>
    <string>{home_dir}/.pm-agent.log</string>
</dict>
</plist>
```

Do the same for the EOD plist with `{eod_hour}`.

---

## Step 5 — Final instructions

After creating all files, print this summary to the user (fill in the actual paths):

```
✅ Setup complete! Here's what to do next:

1. INSTALL DEPENDENCIES
   cd {project_dir}
   npm install

2. CONFIGURE YOUR CREDENTIALS
   cp .env.example .env
   # Edit .env and fill in:
   #   ANTHROPIC_API_KEY  → get at console.anthropic.com
   #   SLACK_MCP_TOKEN    → connect Slack MCP in Cursor (see .env.example)
   #   NOTION_DB_PATH     → run: find ~/Library -name "notion.db" 2>/dev/null

3. TEST IT MANUALLY
   node orchestrator.mjs morning

4. ENABLE AUTO-SCHEDULING (macOS)
   launchctl load ~/Library/LaunchAgents/com.{username}.pm-agents-morning.plist
   launchctl load ~/Library/LaunchAgents/com.{username}.pm-agents-eod.plist

5. START THE DASHBOARD
   npm run dashboard
   # Opens http://localhost:3747

📝 NOTES:
- Agents run in parallel and post to your Slack DM
- Slack token: if it expires, reconnect Slack MCP in Cursor and update SLACK_MCP_TOKEN in .env
- Memory files grow in ~/.agents/memory-{slug}.md after each run
- Run a single agent: node orchestrator.mjs morning --only {slug}
- Send a task: node orchestrator.mjs task "write a design brief for the onboarding flow"
```
