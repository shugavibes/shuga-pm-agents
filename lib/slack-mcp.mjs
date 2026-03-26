/**
 * Slack via MCP server — calls https://mcp.slack.com/mcp directly using JSON-RPC
 * with the xoxe.xoxp- OAuth token obtained from the Cursor Slack MCP auth flow.
 * Stored in .env as SLACK_MCP_TOKEN.
 */
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

// ─── Parse helpers ────────────────────────────────────────────────────────────

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
    // Text is everything after the metadata lines (From/Time/Message TS)
    const afterMeta = block.replace(/^=+[^=]+=+\n/, '').replace(/^From:.*\n/m, '').replace(/^Time:.*\n/m, '').replace(/^Message TS:.*\n/m, '');
    const msgText = afterMeta.trim();
    if (!fromMatch) continue;
    messages.push({
      user: fromMatch[1],
      text: msgText,
      ts: tsMatch ? tsMatch[1] : '',
    });
  }
  return messages;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function getMyUserId() {
  const data = await mcpTool('slack_read_user_profile');
  const match = (data.result || '').match(/User ID:\s*(\S+)/);
  if (!match) throw new Error('Could not parse user ID from profile');
  return match[1];
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getSlackMentions(userId, hoursBack = 24) {
  const oldest = Date.now() / 1000 - hoursBack * 3600;
  const data = await mcpTool('slack_search_public_and_private', {
    query: `<@${userId}>`, count: 30,
  });
  return parseSearchResults(data)
    .filter(m => parseFloat(m.ts) > oldest);
}

export async function getSlackActiveThreads(userId, hoursBack = 24) {
  const oldest = Date.now() / 1000 - hoursBack * 3600;
  const data = await mcpTool('slack_search_public_and_private', {
    query: `from:<@${userId}>`, count: 20,
  });
  return parseSearchResults(data)
    .filter(m => parseFloat(m.ts) > oldest && m.userId === userId);
}

export async function getMorningThreadReplies(channelId, threadTs) {
  try {
    const data = await mcpTool('slack_read_thread', { channel_id: channelId, message_ts: threadTs, limit: 50 });
    return parseThreadMessages(data);
  } catch { return []; }
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function getSelfDMChannel(userId) {
  // slack_send_message accepts user IDs directly as DM targets
  return userId;
}

export async function postSlackMessage(channelId, text) {
  const data = await mcpTool('slack_send_message', { channel_id: channelId, message: text });
  return data.message_context?.message_ts || data.message_ts || '';
}

export async function postSlackReply(channelId, threadTs, text) {
  const data = await mcpTool('slack_send_message', { channel_id: channelId, message: text, thread_ts: threadTs });
  return data.message_context?.message_ts || data.message_ts || '';
}

export async function notifyTokenExpired() {
  log.warning('Slack MCP token expired. Re-authorize in Cursor then run: node scripts/refresh-slack-token.mjs');
}
