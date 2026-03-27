/**
 * Example agent — Expenses / Billing / Finance team
 * Replace the SYSTEM_PROMPT, CHANNELS, and NOTION_KEYWORDS below
 * with context relevant to YOUR team and product.
 */
import { callClaude } from '../lib/claude.mjs';
import config from '../config.mjs';

export const NAME = 'Expenses';
export const SLUG = 'expenses';
export const CHANNELS = ['expense', 'expenses', 'billing', 'payroll', 'finance', 'disbursement'];
export const NOTION_KEYWORDS = ['expense', 'billing', 'payroll', 'invoice', 'finance', 'reimbursement'];
export const ROUTING_DESCRIPTION = 'Handles expense flows, billing integration, invoicing, payroll processing, and cross-domain finance questions';

export const SYSTEM_PROMPT = `You are the Expenses Agent for ${config.pm.name}, a Product Manager at ${config.pm.company} working on the ${config.product.name} product.

Your domain spans expense management and billing:

1. EXPENSE FLOWS — how transactions become expense records:
   - Employees submit and view expenses in the product
   - Admins review, categorize, and approve expenses
   - Category codes determine expense type and taxability

2. BILLING INTEGRATION — how spend becomes a customer invoice:
   - Non-taxable transactions → billed directly without payroll dependency
   - Taxable transactions → routed through payroll for tax calculation
   - Invoice line items, corrections, and reversals

3. CROSS-TEAM DEPENDENCIES — the Expenses ↔ Payroll ↔ Engineering relationship:
   - Payroll team alignment required before billing flows can be confirmed
   - Engineering integration for automatic expense creation from transactions

When generating documents, you produce:
- PROCESS FLOW NARRATIVES: step-by-step billing flows with decision points
- BILLING INTEGRATION SPECS: API contracts between expense and billing systems
- CROSS-TEAM ALIGNMENT DOCS: what payroll needs from engineering, what billing needs from expenses
- PAY ITEM MAPPING TABLES: transaction type → taxability → billing treatment

Active goal: ${config.product.goal}

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

  return `${memorySection}${peersSection}## Slack — expenses/billing channels (last ${ctx.hoursBack}h)
${ctx.mentions.length > 0 ? ctx.mentions.map(m => `[#${m.channel}] ${m.user}: "${m.text}"`).join('\n') : '(none)'}

## Your recent messages in these channels
${ctx.threads.length > 0 ? ctx.threads.map(m => `[#${m.channel}] You: "${m.text}"`).join('\n') : '(none)'}

## Relevant Notion pages (expenses/billing, last 14 days)
${ctx.notionPages.length > 0 ? ctx.notionPages.map(p => `- "${p.title}": ${p.content || '(no preview)'}`).join('\n') : '(none)'}

Today: ${ctx.date}`;
}

export async function morningBriefing(ctx) {
  const start = Date.now();
  try {
    const output = await callClaude(
      `${buildContext(ctx)}

Produce a morning expenses/billing briefing. Cover:
- Billing or payroll alignment blockers on the critical path
- Open billing questions that need answers today
- Any finance or billing team asks waiting on product input
- Cross-team dependency risks

Format as a tight Slack mrkdwn section starting with *🧾 Expenses & Billing*. Max 8 lines.`,
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

Produce an EOD expenses/billing summary. Cover:
- Decisions or alignments reached today
- Billing integration progress
- What's still blocking the billing flow from going live
- Action items and owners for tomorrow

Format as a tight Slack mrkdwn section starting with *🧾 Expenses & Billing*. Max 8 lines.`,
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

Execute the task using the expenses/billing context above. If it's a document (process flow, billing spec, alignment doc), write it in full. Include tables for billing treatment by transaction type where relevant.`,
      { systemPrompt: SYSTEM_PROMPT, maxTokens: 4096 }
    );
    return { agentName: NAME, success: true, output, duration: Date.now() - start };
  } catch (err) {
    return { agentName: NAME, success: false, output: '', error: err, duration: Date.now() - start };
  }
}
