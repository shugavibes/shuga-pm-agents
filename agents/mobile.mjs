import { callClaude } from '../lib/claude.mjs';
import config from '../config.mjs';

export const NAME = 'Mobile';
export const SLUG = 'mobile';
export const CHANNELS = ['mobile', 'ios', 'android', 'app', 'mobile-card', 'mobile-expenses'];
export const NOTION_KEYWORDS = ['mobile', 'alpha', 'beta', 'eor expense card - mobile', 'app', 'ios', 'android', 'wallet', 'push notification'];
export const ROUTING_DESCRIPTION = 'Handles mobile app implementation, iOS/Android card features, Mobile Alpha and Beta launches, app-side UX, release planning';

export const SYSTEM_PROMPT = `You are the Mobile Agent for ${config.pm.name}, a Product Manager at ${config.pm.company} working on the ${config.product.name} product.

Your domain is the mobile app experience for the EOR Expense Card:

ALPHA (current phase — internal Remoters):
- Card provisioning: adding card to Apple/Google Wallet
- Transaction view: seeing card transactions in the app
- Balance view: available balance for the card
- Basic spend controls

BETA EXTERNAL TEST (next phase):
- External EOR employees testing the card experience
- More complete transaction management
- Expense submission from mobile
- Push notifications for transactions

You know the Alpha tracker status:
- ✅ Done: Stable entry API from Cards team
- ✅ Done: MCC mapping
- ✅ Done: Onboarding script
- ✅ Done: Staging environment
- 🔄 In progress: Partial multi-tenancy
- 🔄 In progress: Airwallex contract

Key considerations:
- iOS and Android must ship in parallel — flag parity gaps
- App Store / Play Store review takes 3-5 days — must be in submission before April 1st
- Mobile Alpha scope is intentionally limited (EOR focus, not contractors)
- "Can transactions be declined at POS?" is an open question affecting UX for beta

When generating documents, you produce:
- SPRINT REVIEWS: features completed, velocity, blockers, next sprint plan
- RELEASE READINESS: per-platform checklist, outstanding items, submission timeline
- FEATURE SPECS: user story, acceptance criteria, mobile-specific edge cases (offline, push permissions, wallet availability)
- ALPHA/BETA STATUS REPORTS: % complete, red/amber/green per feature, known bugs, go/no-go recommendation

Active goal: ${config.product.goal}

Format all Slack messages in mrkdwn. Format documents in clean markdown.`;

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

  return `${memorySection}${peersSection}## Slack — mobile channels (last ${ctx.hoursBack}h)
${ctx.mentions.length > 0 ? ctx.mentions.map(m => `[#${m.channel}] ${m.user}: "${m.text}"`).join('\n') : '(none)'}

## Your recent messages in mobile channels
${ctx.threads.length > 0 ? ctx.threads.map(m => `[#${m.channel}] You: "${m.text}"`).join('\n') : '(none)'}

## Relevant Notion pages (mobile-related, last 14 days)
${ctx.notionPages.length > 0 ? ctx.notionPages.map(p => `- "${p.title}": ${p.content || '(no preview)'}`).join('\n') : '(none)'}

Today: ${ctx.date}`;
}

export async function morningBriefing(ctx) {
  const start = Date.now();
  try {
    const output = await callClaude(
      `${buildContext(ctx)}

Produce a morning mobile briefing. Cover:
- Alpha/Beta feature status and any overnight blockers
- iOS vs Android parity concerns
- Dependencies from Cards team that mobile is waiting on
- Timeline risks for store submission

Format as a tight Slack mrkdwn section starting with *📱 Mobile*. Max 8 lines.`,
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

Produce an EOD mobile summary. Cover:
- Features shipped or signed off today
- Remaining alpha/beta scope
- Platform-specific (iOS/Android) issues
- Timeline confidence for store submission

Format as a tight Slack mrkdwn section starting with *📱 Mobile*. Max 8 lines.`,
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

Execute the task using the mobile context above. If it's a document (feature spec, release readiness, sprint review), write it in full with acceptance criteria and mobile-specific edge cases. Flag iOS vs Android differences where relevant.`,
      { systemPrompt: SYSTEM_PROMPT, maxTokens: 4096 }
    );
    return { agentName: NAME, success: true, output, duration: Date.now() - start };
  } catch (err) {
    return { agentName: NAME, success: false, output: '', error: err, duration: Date.now() - start };
  }
}
