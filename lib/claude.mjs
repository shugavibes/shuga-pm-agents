import Anthropic from '@anthropic-ai/sdk';

const client = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Simple one-shot call — user message only.
 */
export async function analyzeWithClaude(prompt, maxTokens = 2048) {
  const message = await client().messages.create({
    model: 'claude-opus-4-6',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
  return message.content[0]?.text ?? '';
}

/**
 * Full call with a system prompt for specialized agents.
 * This gives Claude a stable identity and frees the user prompt for pure context + task.
 */
export async function callClaude(userPrompt, { systemPrompt = null, maxTokens = 2048 } = {}) {
  const params = {
    model: 'claude-opus-4-6',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: userPrompt }],
  };
  if (systemPrompt) params.system = systemPrompt;
  const message = await client().messages.create(params);
  return message.content[0]?.text ?? '';
}
