import { callClaude } from '../lib/claude.mjs';

export const NAME = 'Expenses';
export const SLUG = 'expenses';
export const CHANNELS = ['expense', 'expenses', 'billing', 'payroll', 'pay', 'disbursement', 'finance'];
export const NOTION_KEYWORDS = ['expense', 'billing', 'payroll', 'pay item', 'notional', 'direct billing', 'disbursement', 'net pay', 'payslip', 'gross-up'];
export const ROUTING_DESCRIPTION = 'Handles expense flows, direct billing integration, notional pay item mappings, payroll processing, gross-up, and cross-domain billing questions';

export const SYSTEM_PROMPT = `You are the Expenses Agent for Nico, a Product Manager at Remote.com working on the EOR Expense Card product.

Your domain spans three tightly coupled areas:

1. EXPENSE FLOWS — how card transactions become expense records:
   - Employee submits/views card expenses in the Expenses product
   - Admin reviews, categorizes, and approves card expenses
   - MCC codes determine expense category and taxability

2. BILLING INTEGRATION — how card spend becomes a customer invoice:
   - Non-taxable transactions → billed DIRECTLY from Expenses domain (on approval, no payroll run needed)
   - Taxable transactions → mapped to a NOTIONAL PAY ITEM in payroll → gross-up calculated → billable = transaction amount + tax → charged to customer
   - No actual payment to the employee (notional = tax calculated but not disbursed)
   - Direct billing model: customers agree at sign-up to be billed per transaction (no approval/decline step)
   - Corrections/reversals → negative billables or Credit Memos
   - Billing Platform + Billing Experience teams implement (~1 week estimate, pending Payroll alignment)

3. PAYROLL INTEGRATION — the Expenses ↔ Payroll ↔ Cards cross-domain:
   - Notional Pay Items: payroll processes the taxable amount for gross-up without disbursing
   - Launch limited to countries with automated taxability + gross-up
   - Payroll team must align before billing can be confirmed
   - Key meeting happened 2026-03-18: Payroll × Billing × Expenses × Cards

Open questions you track:
- How do line items appear on the invoice for card spend?
- Do we need a new column on the Detailed Invoice?
- What description on the Itemized Report?
- Which countries lack gross-up and what's the fallback?

Key people: @Jean Jaymalin, @Christian Lundgren, @Nico

When generating documents, you produce:
- PROCESS FLOW NARRATIVES: step-by-step billing flows with decision points (taxable vs non-taxable, corrections)
- PAY ITEM MAPPING TABLES: country → taxability → pay item type → billing treatment
- BILLING INTEGRATION SPECS: API contracts between Expenses domain and Billing Platform
- CROSS-TEAM ALIGNMENT DOCS: what Payroll needs from Cards, what Billing needs from Expenses

Active goal: Launch Card integration MVP by April 1st. The Payroll alignment is the critical path.

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

  return `${memorySection}${peersSection}## Slack — expenses/billing/payroll channels (last ${ctx.hoursBack}h)
${ctx.mentions.length > 0 ? ctx.mentions.map(m => `[#${m.channel}] ${m.user}: "${m.text}"`).join('\n') : '(none)'}

## Your recent messages in these channels
${ctx.threads.length > 0 ? ctx.threads.map(m => `[#${m.channel}] You: "${m.text}"`).join('\n') : '(none)'}

## Relevant Notion pages (expenses/billing/payroll, last 14 days)
${ctx.notionPages.length > 0 ? ctx.notionPages.map(p => `- "${p.title}": ${p.content || '(no preview)'}`).join('\n') : '(none)'}

Today: ${ctx.date}`;
}

export async function morningBriefing(ctx) {
  const start = Date.now();
  try {
    const output = await callClaude(
      `${buildContext(ctx)}

Produce a morning expenses/billing/payroll briefing. Cover:
- Payroll alignment blockers (critical path for April 1st)
- Open billing questions that need answers
- Any payroll or billing team asks waiting on product input
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

Produce an EOD expenses/billing/payroll summary. Cover:
- Decisions or alignments reached today
- Payroll/billing integration progress
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

Execute the task using the expenses/billing/payroll context above. If it's a document (process flow, pay item mapping, billing spec), write it in full. Include tables for billing treatment by transaction type or country where relevant. Be precise about the taxable vs non-taxable split.`,
      { systemPrompt: SYSTEM_PROMPT, maxTokens: 4096 }
    );
    return { agentName: NAME, success: true, output, duration: Date.now() - start };
  } catch (err) {
    return { agentName: NAME, success: false, output: '', error: err, duration: Date.now() - start };
  }
}
