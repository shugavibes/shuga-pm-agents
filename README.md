# PM Agents

An AI assistant for Product Managers that runs on autopilot. Every morning it reads your Slack mentions and Notion pages, generates a briefing from specialized team agents, and sends it to your Slack DMs. Same at end of day.

---

## What it does

- **Morning briefing** — scans your Slack + Notion, posts a prioritized briefing to your DMs with one section per team
- **EOD summary** — recaps the day, surfaces open items, posts a team update draft ready to send
- **Parallel agents** — one agent per team you work with (Design, Engineering, Mobile, etc.), each with deep context about that domain
- **Memory** — agents accumulate context over time and get smarter each day
- **On-demand tasks** — ask it to write a spec, brief, risk register, or any PM doc using the full context it has

## What you need

- [Claude Code](https://claude.ai/code) installed
- An [Anthropic API key](https://console.anthropic.com)
- [Cursor IDE](https://cursor.sh) with the Slack MCP connected (one-time OAuth setup)
- [Notion desktop app](https://www.notion.so/desktop) installed locally

> **Note:** Slack auth uses the official Slack MCP OAuth flow via Cursor — proper OAuth tokens, not browser session cookies. Notion is read from the local SQLite database on your machine (no API key needed).

---

## Install

**1. Download the setup command**

```bash
curl -fsSL https://raw.githubusercontent.com/shugavibes/shuga-pm-agents/main/.claude/commands/setup-pm-agents.md \
  -o ~/.claude/commands/setup-pm-agents.md
```

**2. Open any folder in Claude Code and run:**

```
/setup-pm-agents
```

Claude will ask you about your teams, channels, and schedule — answer the questions and it generates everything automatically. Setup takes about 10 minutes.

---

## How it works

```
Slack (mentions + threads)
Notion (local SQLite)        →  Team Agents  →  Claude  →  Your Slack DMs
                                (Design, Eng,
                                 Mobile, etc.)
```

Each agent knows the Slack channels and Notion keywords relevant to its team. They run in parallel, each producing a section of the briefing. A Stakeholders agent synthesizes everything into a cross-team view.

The Slack token is read directly from Cursor's local storage — Cursor handles the OAuth refresh automatically, so you never need to update a token manually.

---

## Manual setup (alternative to /setup-pm-agents)

```bash
git clone https://github.com/shugavibes/shuga-pm-agents
cd pm-agents
npm install
cp .env.example .env
# Edit .env — add your ANTHROPIC_API_KEY and NOTION_DB_PATH
# Connect Slack MCP in Cursor (Settings → MCP → Add Slack)
```

Edit `config.mjs` with your name, company, and current goal. Then replace the files in `agents/` with agents for your actual teams (use the existing ones as templates).

Test it:
```bash
npm run morning
```

Schedule it (macOS):
```bash
# The /setup-pm-agents command creates and loads these automatically
~/Library/LaunchAgents/com.YOUR_NAME.pm-agents-morning.plist
~/Library/LaunchAgents/com.YOUR_NAME.pm-agents-eod.plist
```

---

## Customization

**`config.mjs`** — your name, company, product, and active goal. Everything reads from here.

**`agents/`** — one file per team. Each has:
- `CHANNELS` — Slack channel names to filter mentions
- `NOTION_KEYWORDS` — keywords to filter relevant Notion pages
- `SYSTEM_PROMPT` — deep domain knowledge about that team
- `morningBriefing()`, `eodSummary()`, `runTask()` — the three modes

The existing agents (Cards, Design, Expenses, Mobile, Stakeholders) are examples. Replace or rename them for your teams.

**On-demand tasks:**
```bash
npm run task "write a design brief for the onboarding flow"
npm run task "create a risk register for the Q2 launch"
```

---

## Requirements

- Node.js 18+
- macOS (Slack token auto-refresh via Cursor uses macOS Keychain; on Windows/Linux, set `SLACK_MCP_TOKEN` in `.env` manually)
- Cursor IDE (for Slack MCP OAuth)
- Notion desktop app

---

## Contributing

This is an early-stage personal tool — feedback welcome. Open an issue or PR.
