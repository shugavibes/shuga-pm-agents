/**
 * Reads the Slack MCP OAuth token directly from Cursor's local SQLite database.
 * Cursor auto-refreshes the token — this always returns the current valid one.
 * Falls back to SLACK_MCP_TOKEN env var if Cursor isn't available.
 */
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import Database from 'better-sqlite3';

const CURSOR_DB = join(homedir(), 'Library/Application Support/Cursor/User/globalStorage/state.vscdb');

function decryptCursorValue(encryptedBuffer, aesKey) {
  if (!encryptedBuffer.slice(0, 3).equals(Buffer.from('v10'))) {
    return encryptedBuffer.toString('utf8');
  }
  const iv = Buffer.alloc(16, ' ');
  const decipher = crypto.createDecipheriv('aes-128-cbc', aesKey, iv);
  decipher.setAutoPadding(false);
  const dec = Buffer.concat([decipher.update(encryptedBuffer.slice(3)), decipher.final()]);
  const pad = dec[dec.length - 1];
  return dec.slice(0, dec.length - pad).toString('utf8');
}

function readFromCursor() {
  if (!existsSync(CURSOR_DB)) return null;
  try {
    const masterKey = execFileSync(
      'security', ['find-generic-password', '-s', 'Cursor Safe Storage', '-a', 'Cursor', '-w'],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString().trim();

    const aesKey = crypto.pbkdf2Sync(masterKey, 'saltysalt', 1003, 16, 'sha1');

    const db = new Database(CURSOR_DB, { readonly: true });
    const row = db.prepare(
      "SELECT value FROM ItemTable WHERE key LIKE '%plugin-slack%mcp_tokens%'"
    ).get();
    db.close();

    if (!row) return null;
    const parsed = JSON.parse(row.value);
    const rawBuffer = Buffer.from(parsed.data);
    const decrypted = decryptCursorValue(rawBuffer, aesKey);
    const data = JSON.parse(decrypted);
    return data.access_token || null;
  } catch {
    return null;
  }
}

export function getSlackToken() {
  const fromCursor = readFromCursor();
  if (fromCursor) return fromCursor;
  const fromEnv = process.env.SLACK_MCP_TOKEN;
  if (fromEnv) return fromEnv;
  throw new Error('No Slack token found. Ensure Cursor is installed with Slack MCP connected, or set SLACK_MCP_TOKEN in .env');
}
