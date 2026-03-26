import fs from 'fs';
import path from 'path';
import os from 'os';
import { callClaude } from './claude.mjs';

const AGENTS_DIR = path.join(os.homedir(), '.agents');
const MAX_MEMORY_CHARS = 8000;  // trigger compression above this
const COMPRESSED_TARGET = 3000; // compress down to this

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
      `You are compressing an AI agent's accumulated memory log. Preserve all specific facts, decisions, and open questions. Remove redundancy and resolved items.

Current memory (${current.length} chars):
${current}

Produce a compressed summary under ${COMPRESSED_TARGET} chars. Keep: specific decisions with dates, unresolved open questions, key people and their roles, important product facts and patterns. Remove: vague observations, items clearly resolved, duplicate information.`,
      { maxTokens: 1000 }
    );
    fs.writeFileSync(
      memoryPath(slug),
      `# ${agentName} Agent Memory (compressed ${new Date().toISOString().slice(0, 10)})\n\n${compressed}\n`,
      'utf8'
    );
  } catch { /* non-fatal */ }
}

/**
 * Given an agent's run output, extract key learnings and append to its memory file.
 * Also compresses the memory if it's grown too large.
 */
export async function extractAndSaveMemory(slug, agentName, output, date) {
  if (!output) return;
  try {
    const learnings = await callClaude(
      `You are building a long-term memory for an AI agent named "${agentName}".

Date: ${date}

The agent just produced this output:
${output.slice(0, 3000)}

Extract 3-7 specific, concrete learnings to remember for future runs. Focus on:
- Decisions made (who decided what, when)
- Open questions that appeared or were resolved
- New facts about the product, team, or integrations
- Blockers or risks that surfaced
- Important people mentioned and their roles/actions

Format as concise bullet points starting with "-". Be specific. Skip vague or generic observations.`,
      { maxTokens: 400 }
    );
    appendToMemory(slug, agentName, learnings);
    await compressMemoryIfNeeded(slug, agentName);
  } catch { /* non-fatal — memory is enhancement, not critical path */ }
}
