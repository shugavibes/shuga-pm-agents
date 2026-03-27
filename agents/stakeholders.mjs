/**
 * Example agent — Stakeholders / Leadership / Cross-team
 * Replace the SYSTEM_PROMPT, CHANNELS, and NOTION_KEYWORDS below
 * with context relevant to YOUR team and product.
 */
import { callClaude } from '../lib/claude.mjs';
import config from '../config.mjs';

export const NAME = 'Stakeholders';
export const SLUG = 'stakeholders';
export const CHANNELS = ['product', 'leadership', 'general', 'announce', 'exec', 'stakeholder'];
export const NOTION_KEYWORDS = ['stakeholder', 'alignment', 'roadmap', 'strategy', 'goals', 'plan', 'mvp', 'risk', 'competitor'];
export const ROUTING_DESCRIPTION = 'Handles cross-team alignment, leadership updates, strategic documents, stakeholder communications, and team-wide broadcasts';

export const SYSTEM_PROMPT = `You are the Stakeholders Agent for ${config.pm.name}, a Product Manager at ${config.pm.company} working on the ${config.product.name} product.

Your domain is cross-cutting communication and strategic alignment:

INTERNAL STAKEHOLDERS:
- Leadership / exec team: need concise status, risk flags, and go/no-go signals
- Cross-functional teams: need clear dependency maps and decision records
- The broader product org: need strategic context for why this product matters

EXTERNAL CONTEXT:
- Competitive landscape: what competitors are doing in this space
- Customer feedback: churn risks or satisfaction signals
- Regulatory or compliance considerations

KEY STRATEGIC CONTEXT:
- Keeping documentation current is critical — Notion pages must reflect reality
- Launch deadlines are often company-level commitments, not just team goals
- Surface risks early — leadership hates surprises

You synthesize across ALL teams to produce leadership-level views. You don't go deep on any one domain — you go wide and highlight what matters at the org level.

When generating documents, you produce:
- EXECUTIVE UPDATES: 3–5 bullet status, risks, asks — fits in a Slack message or email
- STAKEHOLDER BRIEFS: 1-pager with context, status, risks, decisions needed
- CROSS-TEAM ALIGNMENT DOCS: dependency matrix, RACI, open decisions with owners and deadlines
- WEEKLY BROADCAST MESSAGES: per-team scope summaries
- RISK REGISTERS: open risks, probability, impact, mitigation owner

Active goal: ${config.product.goal} Surface risks early.

Format all Slack messages in mrkdwn. Format documents in clean markdown. Exec updates should be scannable in 30 seconds.`;

function buildContext(ctx) {
  const mentions = ctx.rawMentions || ctx.mentions;
  const threads = ctx.rawThreads || ctx.threads;
  const notionPages = ctx.rawNotionPages || ctx.notionPages;

  const memorySection = ctx.memory
    ? `## Your memory from prior runs\n${ctx.memory}\n\n`
    : '';

  const peers = ctx.agentOutputs
    ? Object.entries(ctx.agentOutputs)
        .filter(([slug]) => slug !== SLUG)
        .map(([, d]) => `### ${d.agentName} (${d.runAt ? d.runAt.slice(0, 10) : 'unknown'})\n${d.slackMessage || ''}`)
        .join('\n\n')
    : '';
  const peersSection = peers ? `## Peer agents' last reports\n${peers}\n\n` : '';

  return `${memorySection}${peersSection}## All Slack activity (last ${ctx.hoursBack}h)
${mentions.length > 0 ? mentions.map(m => `[#${m.channel}] ${m.user}: "${m.text}"`).join('\n') : '(none)'}

## Your recent messages across all channels
${threads.length > 0 ? threads.map(m => `[#${m.channel}] You: "${m.text}"`).join('\n') : '(none)'}

## All recent Notion pages (last 14 days)
${notionPages.length > 0 ? notionPages.map(p => `- "${p.title}": ${p.content || '(no preview)'}`).join('\n') : '(none)'}

Today: ${ctx.date}`;
}

export async function morningBriefing(ctx) {
  const start = Date.now();
  try {
    const output = await callClaude(
      `${buildContext(ctx)}

Produce a morning stakeholder briefing. Cover:
- Cross-team blockers or alignment gaps that leadership should know about
- Any competitor or customer context that surfaced recently
- Strategic items that need PM decision today (org-level, not team-level)
- Launch timeline confidence signal

Format as a tight Slack mrkdwn section starting with *📊 Stakeholders*. Max 6 lines.`,
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

Produce two things:

1. A short EOD stakeholder section (max 6 lines, Slack mrkdwn, starting with *📊 Stakeholders*):
   - Cross-team wins today
   - Open risks for tomorrow

2. A full EOD team update broadcast message (detailed, ready to send to all teams):
   Format:
   *📋 EOD Team Update — ${ctx.date}*

   *Overall Summary*
   [2-3 sentences across all teams]

   ---
   [One section per team with real activity, using this format:]
   *[Team Name]*
   ✅ *Accomplished & agreed:* ...
   ❓ *Open questions & next actions:* ... → @person

Separate the two with: ---BROADCAST---`,
      { systemPrompt: SYSTEM_PROMPT, maxTokens: 2048 }
    );

    const parts = output.split('---BROADCAST---');
    const slackSection = parts[0].trim();
    const broadcast = parts[1]?.trim() || output;

    return {
      agentName: NAME,
      success: true,
      output,
      slackMessage: slackSection,
      broadcast,
      duration: Date.now() - start,
    };
  } catch (err) {
    return { agentName: NAME, success: false, output: '', slackMessage: '', broadcast: '', error: err, duration: Date.now() - start };
  }
}

export async function runTask(instruction, ctx) {
  const start = Date.now();
  try {
    const output = await callClaude(
      `${buildContext(ctx)}

## Task
${instruction}

Execute the task using the full cross-team context above. If it's a strategic document (exec update, stakeholder brief, risk register, alignment doc), write it in full. Be concise at the top (exec summary) and detailed below. Make it scannable.`,
      { systemPrompt: SYSTEM_PROMPT, maxTokens: 4096 }
    );
    return { agentName: NAME, success: true, output, duration: Date.now() - start };
  } catch (err) {
    return { agentName: NAME, success: false, output: '', error: err, duration: Date.now() - start };
  }
}
