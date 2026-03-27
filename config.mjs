// ─── Your personal config ─────────────────────────────────────────────────────
// Edit this file with your details. Everything else reads from here.
//
// AGENTS: The files in agents/ are your domain-specific sub-agents.
// Each one covers a team or area you work with (e.g. mobile, design, backend).
// Rename them, rewrite their SYSTEM_PROMPT, CHANNELS, and NOTION_KEYWORDS
// to match your actual teams and product context.

export default {
  pm: {
    name: 'Your Name',       // e.g. 'Alex'
    company: 'Your Company', // e.g. 'Acme Corp'
  },
  product: {
    name: 'Your Product',    // e.g. 'Payments Platform'
    // Your current active goal. Used in all morning/EOD briefings.
    goal: 'Your active goal and deadline.', // e.g. 'Launch v2 by June 1st — all teams aligned.'
  },
};
