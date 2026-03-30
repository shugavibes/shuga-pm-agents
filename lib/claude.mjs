/**
 * Provider-agnostic AI caller.
 * Configure your provider + model in config.mjs → ai.provider / ai.model
 *
 * Supported providers:
 *   anthropic — Claude (claude-opus-4-6, claude-sonnet-4-6, etc.)
 *   openai    — GPT-4o, o1, o3-mini, etc.
 *   gemini    — Google Gemini (gemini-2.0-flash, gemini-1.5-pro, etc.)
 *   kimi      — Moonshot AI (moonshot-v1-8k, moonshot-v1-32k, etc.)
 *   deepseek  — DeepSeek (deepseek-chat, deepseek-reasoner)
 *   groq      — Groq fast inference (llama-3.3-70b-versatile, etc.)
 *   mistral   — Mistral AI (mistral-large-latest, etc.)
 *
 * Each provider needs its own API key in .env (see .env.example).
 * All non-Anthropic providers use the OpenAI-compatible chat completions API.
 */
import config from '../config.mjs';

const PROVIDERS = {
  openai:   { baseURL: 'https://api.openai.com/v1',                              envKey: 'OPENAI_API_KEY',   defaultModel: 'gpt-4o' },
  gemini:   { baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', envKey: 'GEMINI_API_KEY',   defaultModel: 'gemini-2.0-flash' },
  kimi:     { baseURL: 'https://api.moonshot.cn/v1',                              envKey: 'KIMI_API_KEY',     defaultModel: 'moonshot-v1-32k' },
  deepseek: { baseURL: 'https://api.deepseek.com',                                envKey: 'DEEPSEEK_API_KEY', defaultModel: 'deepseek-chat' },
  groq:     { baseURL: 'https://api.groq.com/openai/v1',                          envKey: 'GROQ_API_KEY',     defaultModel: 'llama-3.3-70b-versatile' },
  mistral:  { baseURL: 'https://api.mistral.ai/v1',                               envKey: 'MISTRAL_API_KEY',  defaultModel: 'mistral-large-latest' },
};

async function callAnthropic(userPrompt, { systemPrompt, maxTokens }) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const params = {
    model: config.ai?.model ?? 'claude-opus-4-6',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: userPrompt }],
  };
  if (systemPrompt) params.system = systemPrompt;
  const message = await client.messages.create(params);
  return message.content[0]?.text ?? '';
}

async function callOpenAICompat(userPrompt, { systemPrompt, maxTokens }, providerKey) {
  const cfg = PROVIDERS[providerKey];
  const apiKey = process.env[cfg.envKey];
  if (!apiKey) throw new Error(`${cfg.envKey} not set in .env (required for provider: ${providerKey})`);

  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey, baseURL: cfg.baseURL });

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: userPrompt });

  const response = await client.chat.completions.create({
    model: config.ai?.model ?? cfg.defaultModel,
    max_tokens: maxTokens,
    messages,
  });
  return response.choices[0]?.message?.content ?? '';
}

async function call(userPrompt, { systemPrompt = null, maxTokens = 2048 } = {}) {
  const provider = config.ai?.provider ?? 'anthropic';
  if (provider === 'anthropic') return callAnthropic(userPrompt, { systemPrompt, maxTokens });
  if (PROVIDERS[provider]) return callOpenAICompat(userPrompt, { systemPrompt, maxTokens }, provider);
  throw new Error(`Unknown AI provider: "${provider}". Valid options: anthropic, ${Object.keys(PROVIDERS).join(', ')}`);
}

export const callClaude = call;
export const analyzeWithClaude = (prompt, maxTokens = 2048) => call(prompt, { maxTokens });
