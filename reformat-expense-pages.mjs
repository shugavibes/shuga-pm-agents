#!/usr/bin/env node
/**
 * Reformats 3 Expense team Notion pages to match the Mobile Alpha template format.
 * Uses full Slack (72h) + Notion (14d) context, same as the product sense agent task mode.
 * For each page: generates content with Claude → copies to clipboard → opens Notion URL.
 * You: select all (Cmd+A), paste (Cmd+V), click Continue on the dialog.
 */

import fs from 'fs';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import Anthropic from '@anthropic-ai/sdk';

// ── Load env ─────────────────────────────────────────────────────────────────
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
  const xoxc = process.env.SLACK_XOXC_TOKEN;
  const xoxd = process.env.SLACK_XOXD_TOKEN;
  const body = new URLSearchParams({ token: xoxc, ...params }).toString();
  const resp = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': `d=${xoxd}` },
    body,
  });
  const data = await resp.json();
  if (!data.ok) throw new Error(`Slack ${method}: ${data.error}`);
  return data;
}

async function getSlackMentions(userId, hoursBack = 72) {
  console.log(`  Fetching Slack mentions (last ${hoursBack}h)...`);
  const oldest = Math.floor((Date.now() / 1000) - hoursBack * 3600);
  const result = await slackApi('search.messages', { query: `<@${userId}>`, sort: 'timestamp', sort_dir: 'desc', count: 20 });
  const messages = (result.messages?.matches || []).filter(m => parseFloat(m.ts) > oldest);
  console.log(`    Found ${messages.length} mention(s)`);
  return messages.map(m => ({ channel: m.channel?.name || m.channel?.id, text: m.text, user: m.username || m.user }));
}

async function getSlackActiveThreads(userId, hoursBack = 72) {
  console.log(`  Fetching your recent Slack messages (last ${hoursBack}h)...`);
  const oldest = Math.floor((Date.now() / 1000) - hoursBack * 3600);
  const result = await slackApi('search.messages', { query: `from:<@${userId}>`, sort: 'timestamp', sort_dir: 'desc', count: 15 });
  const messages = (result.messages?.matches || []).filter(m => parseFloat(m.ts) > oldest);
  console.log(`    Found ${messages.length} message(s)`);
  return messages.map(m => ({ channel: m.channel?.name || m.channel?.id, text: m.text }));
}

// ── Notion SQLite ─────────────────────────────────────────────────────────────
function toHyphen(id) {
  if (id.includes('-')) return id;
  return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`;
}

function extractText(propsStr) {
  if (!propsStr) return '';
  try { return (JSON.parse(propsStr).title || []).map(t => Array.isArray(t) ? t[0] : '').join(''); }
  catch { return ''; }
}

function readPage(rawId) {
  const db = new Database(DB_PATH, { readonly: true });
  const hId = toHyphen(rawId);
  const noH = rawId.replace(/-/g, '');
  const page = db.prepare('SELECT id, properties FROM block WHERE id IN (?, ?) AND alive = 1').get(hId, noH);
  if (!page) { db.close(); return null; }
  const title = extractText(page.properties);
  const blocks = db.prepare(`
    SELECT type, properties FROM block
    WHERE parent_id = ? AND alive = 1 ORDER BY created_time ASC LIMIT 200
  `).all(page.id);
  const content = blocks.map(b => `[${b.type}] ${extractText(b.properties)}`).filter(l => !l.endsWith('] ')).join('\n');
  db.close();
  return { title, content };
}

function getNotionContext(daysBack = 14) {
  console.log(`  Reading Notion pages modified in last ${daysBack} days...`);
  const db = new Database(DB_PATH, { readonly: true });
  const since = Date.now() - daysBack * 24 * 3600 * 1000;
  const pages = db.prepare(`
    SELECT id, properties FROM block
    WHERE type = 'page' AND alive = 1 AND last_edited_time > ?
    ORDER BY last_edited_time DESC LIMIT 25
  `).all(since);
  console.log(`    Found ${pages.length} page(s)`);
  const result = [];
  for (const p of pages) {
    const title = extractText(p.properties);
    const blocks = db.prepare(`SELECT properties FROM block WHERE parent_id = ? AND alive = 1 LIMIT 30`).all(p.id);
    const content = blocks.map(b => extractText(b.properties)).filter(t => t && t !== 'Untitled').join(' ').slice(0, 500);
    result.push({ title, content });
  }
  db.close();
  return result;
}

// ── Clipboard ─────────────────────────────────────────────────────────────────
function inlineHtml(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function markdownToHtml(md) {
  const lines = md.split('\n');
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

function copyHtmlToClipboard(html) {
  const tmp = '/tmp/notion-expense-clipboard.html';
  fs.writeFileSync(tmp, `<html><body>${html}</body></html>`, 'utf8');
  execSync(
    `osascript -e 'set c to (read POSIX file "${tmp}" as «class utf8»)' ` +
    `-e 'set the clipboard to {«class HTML»:c, string:c}'`
  );
}

// ── macOS dialog ──────────────────────────────────────────────────────────────
function waitForUser(message) {
  execSync(`osascript -e 'display dialog "${message}" buttons {"Continue"} default button "Continue"'`);
}

// ── Claude generator ──────────────────────────────────────────────────────────
async function generateForPage(templatePage, targetPage, mentions, threads, notionPages) {
  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `You are a product manager's assistant at Remote.com with full context from Slack and Notion.
You are reformatting a Notion page for the EOR Expense Card project (Expenses team).

## Slack mentions (last 72h)
${mentions.length > 0 ? mentions.map(m => `- [#${m.channel}] ${m.user}: "${m.text}"`).join('\n') : '(none)'}

## Your recent Slack messages (last 72h)
${threads.length > 0 ? threads.map(m => `- [#${m.channel}] You: "${m.text}"`).join('\n') : '(none)'}

## Recently modified Notion pages (last 14 days)
${notionPages.length > 0 ? notionPages.map(p => `- "${p.title}": ${p.content || '(no preview)'}`).join('\n') : '(none)'}

## Template format (from "EOR Expense Card - Mobile Alpha")
${templatePage.content}

## Target page to reformat: "${targetPage.title}"
Current content:
${targetPage.content}

Rewrite the target page using exactly this structure — enrich with any relevant details from Slack or Notion context above:

### TL;DR
---
[2–4 sentences: what this feature/task is, why it matters, current status based on all context]

### Resources
---
- [Figma link]
- [Design doc / Product Mechanics doc]
- [Any other relevant links from current content or context]

### Scope
---
- **IN-scope:** [what is included, based on content + context]
- **OUT-of-scope:** [what is explicitly excluded or deferred]

### Dependencies
---
[numbered list. Include team name in brackets: [💳 Cards team], [🧾 Expenses team], [Payroll team], [Billing team]]

Rules:
- Prioritise info from Slack/Notion context to fill gaps the page doesn't have.
- Keep it concise and actionable. Use [TBD] only when truly unknown.
- Output ONLY the markdown. No intro, no explanation.`
    }]
  });
  return msg.content[0].text;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const TEMPLATE_ID = '304cb4dadab48023b678eaf4a014573e';

const PAGES = [
  {
    id: '321cb4dadab480f48998ed50513b2c89',
    name: 'Employee view in Expenses',
    url: 'https://www.notion.so/remotecom/EOR-Expense-Card-employee-view-in-Expenses-321cb4dadab480f48998ed50513b2c89',
  },
  {
    id: '321cb4dadab480429071f130bfb5dd1e',
    name: 'Notional pay item mappings',
    url: 'https://www.notion.so/remotecom/EOR-Expense-Card-Notional-pay-item-mappings-321cb4dadab480429071f130bfb5dd1e',
  },
  {
    id: '321cb4dadab4805a9087fcd0e240c663',
    name: 'Direct billing integration',
    url: 'https://www.notion.so/remotecom/EOR-Expense-Card-Direct-billing-integration-321cb4dadab4805a9087fcd0e240c663',
  },
];

const userId = process.env.SLACK_USER_ID;

console.log('Reading template page...');
const templatePage = readPage(TEMPLATE_ID);
if (!templatePage) { console.error('Template page not found in local Notion DB'); process.exit(1); }
console.log(`  Template: "${templatePage.title}"\n`);

console.log('Fetching shared context (Slack + Notion)...');
const [mentions, threads, notionPages] = await Promise.all([
  getSlackMentions(userId, 72),
  getSlackActiveThreads(userId, 72),
  Promise.resolve(getNotionContext(14)),
]);
console.log('  Context ready.\n');

for (let i = 0; i < PAGES.length; i++) {
  const p = PAGES[i];
  console.log(`\n[${i+1}/${PAGES.length}] ${p.name}`);
  console.log('  Reading current page content...');

  const targetPage = readPage(p.id);
  if (!targetPage) {
    console.warn(`  ⚠ Page not found in local Notion DB — skipping. (Open it in Notion desktop to sync first)`);
    continue;
  }
  console.log(`  Found: "${targetPage.title}"`);
  console.log('  Generating content with Claude (full context)...');

  const markdown = await generateForPage(templatePage, targetPage, mentions, threads, notionPages);
  console.log('\n  Generated content:\n');
  console.log(markdown.split('\n').map(l => '    ' + l).join('\n'));

  copyHtmlToClipboard(markdownToHtml(markdown));
  console.log('\n  ✓ Copied to clipboard');

  execSync(`open "${p.url}"`);
  console.log('  ✓ Opened Notion page in browser');

  waitForUser(`[${i+1}/3] ${p.name}\\n\\nContent is in your clipboard.\\n\\n1. Go to the Notion page (just opened)\\n2. Select all (Cmd+A)\\n3. Paste (Cmd+V)\\n\\nClick Continue when done.`);
}

console.log('\n✅ All done!');
