// ─── Your personal config ─────────────────────────────────────────────────────
// Edit this file with your details. Everything else reads from here.
//
// AGENTS: The files in agents/ are your domain-specific sub-agents.
// Each one covers a team or area you work with (e.g. mobile, design, backend).
// Rename them, rewrite their SYSTEM_PROMPT, CHANNELS, and NOTION_KEYWORDS
// to match your actual teams and product context.

export default {
  pm: {
    name: 'Nico',
    company: 'Remote.com',
  },
  product: {
    name: 'EOR Expense Card',
    // Your current active goal. Used in all morning/EOD briefings.
    goal: 'Launch Card integration MVP by April 1st — all teams aligned and unblocked.',
  },
};
