/**
 * Example agent — Cards / Payments Engineering team
 * Replace the SYSTEM_PROMPT, CHANNELS, and NOTION_KEYWORDS below
 * with context relevant to YOUR team and product.
 */
import { callClaude } from '../lib/claude.mjs';
import config from '../config.mjs';

export const NAME = 'Cards';
export const SLUG = 'cards';
export const CHANNELS = ['card', 'cards', 'card-engineering', 'card-integration', 'card-alpha'];
export const NOTION_KEYWORDS = ['card', 'payments', 'alpha', 'card program', 'card integration', 'transaction'];
export const ROUTING_DESCRIPTION = 'Handles card engineering, API contracts, payment infrastructure, alpha/beta launch, and technical blockers';

export const SYSTEM_PROMPT = `You are the Cards Agent for ${config.pm.name}, a Product Manager at ${config.pm.company} working on the ${config.product.name} product.

Your domain is the card infrastructure and engineering integration:
- Payment API contracts: the stable endpoints that mobile and web apps depend on
- Card program setup: onboarding of internal testers (alpha) and external customers (beta)
- Transaction flows: authorization, clearing, settlement, and webhook reliability
- Infrastructure: multi-tenant architecture, staging environments, API stability
- Alpha/Beta launch phases and readiness criteria

When generating documents, you produce:
- INTEGRATION STATUS REPORTS: component-by-component go/no-go table, blockers, owner, ETA
- API CONTRACT SUMMARIES: endpoint list, request/response shape, authentication, breaking change log
- LAUNCH READINESS CHECKLISTS: per-phase criteria (alpha/beta/GA), sign-off owners
- TECHNICAL DEPENDENCY MAPS: what mobile needs from cards, what other teams need from cards

Active goal: ${config.product.goal} Be precise about technical blockers and ETAs.

Format all Slack messages in mrkdwn. Format documents in clean markdown with tables where useful.`;

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

  return `${memorySection}${peersSection}## Slack — cards channels (last ${ctx.hoursBack}h)
${ctx.mentions.length > 0 ? ctx.mentions.map(m => `[#${m.channel}] ${m.user}: "${m.text}"`).join('\n') : '(none)'}

## Your recent messages in cards channels
${ctx.threads.length > 0 ? ctx.threads.map(m => `[#${m.channel}] You: "${m.text}"`).join('\n') : '(none)'}

## Relevant Notion pages (cards-related, last 14 days)
${ctx.notionPages.length > 0 ? ctx.notionPages.map(p => `- "${p.title}": ${p.content || '(no preview)'}`).join('\n') : '(none)'}

Today: ${ctx.date}`;
}

export async function morningBriefing(ctx) {
  const start = Date.now();
  try {
    const output = await callClaude(
      `${buildContext(ctx)}

Produce a morning cards/engineering briefing. Cover:
- Card integration blockers or items needing PM action today
- API or infrastructure issues that could impact other teams
- Any eng questions waiting on product decisions
- Launch readiness risks

Format as a tight Slack mrkdwn section starting with *💳 Cards*. Max 8 lines.`,
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

Produce an EOD cards summary. Cover:
- Technical progress or unblocks today
- What shipped or was confirmed working
- Remaining blockers for alpha/MVP
- Open questions for the cards engineering team

Format as a tight Slack mrkdwn section starting with *💳 Cards*. Max 8 lines.`,
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

Execute the task using the cards/engineering context above. If it's a document (integration status, API contract, launch checklist), write it in full with tables where helpful. Be technically precise.`,
      { systemPrompt: SYSTEM_PROMPT, maxTokens: 4096 }
    );
    return { agentName: NAME, success: true, output, duration: Date.now() - start };
  } catch (err) {
    return { agentName: NAME, success: false, output: '', error: err, duration: Date.now() - start };
  }
}
