import { callClaude } from '../lib/claude.mjs';
import config from '../config.mjs';

export const NAME = 'Design';
export const SLUG = 'design';
export const CHANNELS = ['design', 'card-design', 'ux', 'figma', 'product-design'];
export const NOTION_KEYWORDS = ['design', 'figma', 'admin experience', 'employee view', 'ui', 'screens', 'flow'];
export const ROUTING_DESCRIPTION = 'Handles design reviews, Figma status, UX decisions, screen specs, admin and employee-facing UI for the card product';

export const SYSTEM_PROMPT = `You are the Design Agent for ${config.pm.name}, a Product Manager at ${config.pm.company} working on the ${config.product.name} product.

Your domain is everything visual and UX: Figma files, design reviews, screen specs, component decisions, and design sign-offs. You know the card product has two primary surfaces:
1. ADMIN experience — employer/HR admin portal: card issuance, limits, transaction oversight, balance management
2. EMPLOYEE experience — employee-facing: card request, transaction view, expense submission from mobile and web

You understand the design workflow: discovery → wireframes → high-fi → review → sign-off → handoff to engineering.

When generating documents, you produce:
- DESIGN REVIEW NOTES: per-screen status table (screen name, designer, status: draft/review/signed-off, link, blockers)
- DESIGN BRIEFS: problem statement, user story, constraints, open UX questions, success criteria
- HANDOFF DOCS: component inventory, interaction specs, edge cases, responsive behavior
- WEEKLY DESIGN STATUS: per-surface progress, what's ready for eng, what's blocked, what needs PM decision

Active goal: ${config.product.goal} Flag anything that could delay design sign-off.

Format all Slack messages in mrkdwn. Format documents in clean markdown with clear headers.`;

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

  return `${memorySection}${peersSection}## Slack — design channels (last ${ctx.hoursBack}h)
${ctx.mentions.length > 0 ? ctx.mentions.map(m => `[#${m.channel}] ${m.user}: "${m.text}"`).join('\n') : '(none)'}

## Your recent messages in design channels
${ctx.threads.length > 0 ? ctx.threads.map(m => `[#${m.channel}] You: "${m.text}"`).join('\n') : '(none)'}

## Relevant Notion pages (design-related, last 14 days)
${ctx.notionPages.length > 0 ? ctx.notionPages.map(p => `- "${p.title}": ${p.content || '(no preview)'}`).join('\n') : '(none)'}

Today: ${ctx.date}`;
}

export async function morningBriefing(ctx) {
  const start = Date.now();
  try {
    const output = await callClaude(
      `${buildContext(ctx)}

Produce a morning design briefing. Cover:
- Which screens/surfaces need attention or decisions today
- Any design reviews scheduled or overdue
- Figma files that may be out of sync with what eng is building
- Open design questions that are blocking progress

Format as a tight Slack mrkdwn section starting with *🎨 Design*. Max 8 lines.`,
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

Produce an EOD design summary. Cover:
- Screens signed off or reviewed today
- Design decisions made (and by whom)
- What still needs sign-off before eng can proceed
- Tomorrow's design priorities

Format as a tight Slack mrkdwn section starting with *🎨 Design*. Max 8 lines.`,
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

Execute the task using the design context above. If it's a document (design brief, review notes, spec), write it in full — not just bullets. Be detailed and specific.`,
      { systemPrompt: SYSTEM_PROMPT, maxTokens: 4096 }
    );
    return { agentName: NAME, success: true, output, duration: Date.now() - start };
  } catch (err) {
    return { agentName: NAME, success: false, output: '', error: err, duration: Date.now() - start };
  }
}
