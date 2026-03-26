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

export function getNotionPageById(rawId) {
  const dbPath = process.env.NOTION_DB_PATH;
  if (!dbPath) return null;
  const db = new Database(dbPath, { readonly: true });
  const withHyphens = rawId.includes('-') ? rawId
    : `${rawId.slice(0,8)}-${rawId.slice(8,12)}-${rawId.slice(12,16)}-${rawId.slice(16,20)}-${rawId.slice(20)}`;
  const withoutHyphens = withHyphens.replace(/-/g, '');
  let page = db.prepare('SELECT id, properties FROM block WHERE id = ? AND alive = 1').get(withHyphens)
           ?? db.prepare('SELECT id, properties FROM block WHERE id = ? AND alive = 1').get(withoutHyphens);
  if (!page) { db.close(); return null; }
  const title = extractText(page.properties);
  const blocks = db.prepare(`SELECT type, properties FROM block WHERE parent_id = ? AND alive = 1 ORDER BY created_time ASC LIMIT 150`).all(page.id);
  const lines = blocks.map(b => extractText(b.properties)).filter(t => t && t !== 'Untitled');
  db.close();
  return { title, content: lines.join('\n') };
}

// ─── Notion API write ─────────────────────────────────────────────────────────
export async function notionApi(method, endpoint, body) {
  const apiKey = process.env.NOTION_API_KEY;
  const payload = body ? JSON.stringify(body) : null;
  const resp = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    ...(payload ? { body: payload } : {}),
  });
  const data = await resp.json();
  if (data.object === 'error') throw new Error(`Notion API: ${data.message}`);
  return data;
}

function parseRichText(text) {
  const segments = [];
  const re = /\*\*([^*]+)\*\*|__([^_]+)__|_([^_]+)_|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)|(`[^`]+`)|([^*_\[`]+)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match[1] || match[2]) segments.push({ type: 'text', text: { content: match[1] ?? match[2] }, annotations: { bold: true } });
    else if (match[3] || match[4]) segments.push({ type: 'text', text: { content: match[3] ?? match[4] }, annotations: { italic: true } });
    else if (match[5] && match[6]) segments.push({ type: 'text', text: { content: match[5], link: { url: match[6] } } });
    else if (match[7]) segments.push({ type: 'text', text: { content: match[7].slice(1,-1) }, annotations: { code: true } });
    else if (match[8]) segments.push({ type: 'text', text: { content: match[8] } });
  }
  return segments.length ? segments : [{ type: 'text', text: { content: text } }];
}

export function markdownToNotionBlocks(markdown) {
  const lines = markdown.split('\n');
  const blocks = [];
  for (const line of lines) {
    if (/^### (.+)/.test(line))        blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: parseRichText(line.slice(4)) } });
    else if (/^## (.+)/.test(line))    blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: parseRichText(line.slice(3)) } });
    else if (/^# (.+)/.test(line))     blocks.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: parseRichText(line.slice(2)) } });
    else if (/^[-*] (.+)/.test(line))  blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: parseRichText(line.slice(2)) } });
    else if (/^\d+\. (.+)/.test(line)) blocks.push({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: parseRichText(line.replace(/^\d+\. /, '')) } });
    else if (/^> (.+)/.test(line))     blocks.push({ object: 'block', type: 'quote', quote: { rich_text: parseRichText(line.slice(2)) } });
    else if (/^---+$/.test(line.trim())) blocks.push({ object: 'block', type: 'divider', divider: {} });
    else if (line.trim() !== '')       blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: parseRichText(line) } });
  }
  return blocks;
}

export async function updateNotionPage(pageId, markdownContent) {
  const withHyphens = pageId.includes('-') ? pageId
    : `${pageId.slice(0,8)}-${pageId.slice(8,12)}-${pageId.slice(12,16)}-${pageId.slice(16,20)}-${pageId.slice(20)}`;
  const ids = await notionApi('GET', `/blocks/${withHyphens}/children?page_size=100`).then(d => (d.results||[]).map(b => b.id));
  for (const id of ids) await notionApi('PATCH', `/blocks/${id}`, { archived: true });
  const blocks = markdownToNotionBlocks(markdownContent);
  for (let i = 0; i < blocks.length; i += 100) {
    await notionApi('PATCH', `/blocks/${withHyphens}/children`, { children: blocks.slice(i, i+100) });
  }
  log.success(`Notion page updated (${blocks.length} blocks written)`);
}

/**
 * Filter a Notion pages array to only those matching given keywords in their title.
 * If keywords is empty, returns all pages.
 */
export function filterNotionPages(pages, keywords) {
  if (!keywords || keywords.length === 0) return pages;
  const kw = keywords.map(k => k.toLowerCase());
  return pages.filter(p => kw.some(k => p.title.toLowerCase().includes(k)));
}
