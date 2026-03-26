#!/usr/bin/env node
/**
 * Generates draft weekly Slack messages for each team:
 * Mobile, Expenses, Billing & Payroll, Cards, Design
 * Uses full Slack (72h) + Notion (14d) context.
 */

import fs from 'fs';
import Database from 'better-sqlite3';
import Anthropic from '@anthropic-ai/sdk';

// ── Load env ──────────────────────────────────────────────────────────────────
const envPath = '/Users/nico.alvarezquiros/product-sense/.env';
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
  if (k && !(k in process.env)) process.env[k] = v;
}

const DB_PATH = process.env.NOTION_DB_PATH;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Slack API ─────────────────────────────────────────────────────────────────
async function slackApi(method, params = {}) {
  const body = new URLSearchParams({ token: process.env.SLACK_XOXC_TOKEN, ...params }).toString();
  const resp = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': `d=${process.env.SLACK_XOXD_TOKEN}` },
    body,
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(`Slack ${method}: ${data.error}`);
  return data;
}

async function getSlackMentions(userId, hoursBack = 72) {
  const oldest = Math.floor((Date.now() / 1000) - hoursBack * 3600);
  const result = await slackApi('search.messages', { query: `<@${userId}>`, sort: 'timestamp', sort_dir: 'desc', count: 30 });
  return (result.messages?.matches || [])
    .filter(m => parseFloat(m.ts) > oldest)
    .map(m => ({ channel: m.channel?.name || m.channel?.id, text: m.text, user: m.username || m.user }));
}

async function getSlackActiveThreads(userId, hoursBack = 72) {
  const oldest = Math.floor((Date.now() / 1000) - hoursBack * 3600);
  const result = await slackApi('search.messages', { query: `from:<@${userId}>`, sort: 'timestamp', sort_dir: 'desc', count: 20 });
  return (result.messages?.matches || [])
    .filter(m => parseFloat(m.ts) > oldest)
    .map(m => ({ channel: m.channel?.name || m.channel?.id, text: m.text }));
}

// ── Notion SQLite ─────────────────────────────────────────────────────────────
function extractText(propsStr) {
  if (!propsStr) return '';
  try { return (JSON.parse(propsStr).title || []).map(t => Array.isArray(t) ? t[0] : '').join(''); }
  catch { return ''; }
}

function getNotionContext(daysBack = 14) {
  const db = new Database(DB_PATH, { readonly: true });
  const since = Date.now() - daysBack * 24 * 3600 * 1000;
  const pages = db.prepare(`
    SELECT id, properties FROM block
    WHERE type = 'page' AND alive = 1 AND last_edited_time > ?
    ORDER BY last_edited_time DESC LIMIT 30
  `).all(since);
  const result = [];
  for (const p of pages) {
    const title = extractText(p.properties);
    const blocks = db.prepare(`SELECT properties FROM block WHERE parent_id = ? AND alive = 1 LIMIT 40`).all(p.id);
    const content = blocks.map(b => extractText(b.properties)).filter(t => t && t !== 'Untitled').join(' ').slice(0, 600);
    result.push({ title, content });
  }
  db.close();
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const userId = process.env.SLACK_USER_ID;
const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

console.log('Fetching context...');
const [mentions, threads, notionPages] = await Promise.all([
  getSlackMentions(userId, 72),
  getSlackActiveThreads(userId, 72),
  Promise.resolve(getNotionContext(14)),
]);
console.log(`  ${mentions.length} Slack mentions · ${threads.length} your messages · ${notionPages.length} Notion pages\n`);

console.log('Generating drafts with Claude...\n');

const msg = await anthropic.messages.create({
  model: 'claude-opus-4-6',
  max_tokens: 4096,
  messages: [{
    role: 'user',
    content: `You are a product manager at Remote.com working on the EOR Expense Card project.
Today is ${today}.

Using the Slack and Notion context below, write SHORT weekly Slack messages for each of the 5 teams you work with.

Each message must have exactly 3 sections:
• *✅ Last week* — 2–3 bullet points of what was accomplished / decided
• *🎯 This week* — 2–3 bullet points of what to focus on
• *❓ Open questions* — 1–3 specific questions you need answered, with @mention if you know who owns it

Tone: direct, concise, no fluff. Each full message should fit in ~10 lines.
Format in Slack mrkdwn. Start each message with a bold team label: *[Team Name]*

## Slack mentions (last 72h)
${mentions.length > 0 ? mentions.map(m => `[#${m.channel}] ${m.user}: "${m.text}"`).join('\n') : '(none)'}

## Your recent Slack messages (last 72h)
${threads.length > 0 ? threads.map(m => `[#${m.channel}] You: "${m.text}"`).join('\n') : '(none)'}

## Recently modified Notion pages (last 14 days)
${notionPages.map(p => `- "${p.title}": ${p.content || '(no preview)'}`).join('\n')}

---
Write one message per team in this order:
1. 📱 Mobile team
2. 🧾 Expenses team
3. 💰 Billing & Payroll
4. 💳 Cards team
5. 🎨 Design

Separate each message with a line: ────────────────────────`
  }]
});

console.log(msg.content[0].text);
console.log('\n✅ Done — review and edit before sending.');
