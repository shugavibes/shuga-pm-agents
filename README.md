# PM Agents

An AI assistant for Product Managers that runs on autopilot. Every morning it reads your Slack mentions and Notion pages, generates a briefing from specialized team agents, and sends it to your Slack DMs. Same at end of day.

---

## What it does

- **Morning briefing** — scans your Slack + Notion, posts a prioritized briefing to your DMs with one section per team
- **EOD summary** — recaps the day, surfaces open items, posts a team update draft ready to send
- **Parallel agents** — one agent per team you work with (Design, Engineering, Mobile, etc.), each with deep context about that domain
- **Memory** — agents accumulate context over time and get smarter each day
- **On-demand tasks** — ask it to write a spec, brief, risk register, or any PM doc using the full context it has

---

## What you need

- [Claude Code](https://claude.ai/code) installed (any version)
- An API key from **any of these AI providers** (pick one):

  | Provider | Get a key |
  |---|---|
  | Anthropic (Claude) | [console.anthropic.com](https://console.anthropic.com) |
  | OpenAI (GPT-4o, o3) | [platform.openai.com](https://platform.openai.com) |
  | Google (Gemini) | [aistudio.google.com](https://aistudio.google.com) |
  | Moonshot (Kimi) | [platform.moonshot.cn](https://platform.moonshot.cn) |
  | DeepSeek | [platform.deepseek.com](https://platform.deepseek.com) |
  | Groq (Llama) | [console.groq.com](https://console.groq.com) |
  | Mistral | [console.mistral.ai](https://console.mistral.ai) |

- **Slack MCP** connected in your IDE (see below)
- [Notion desktop app](https://www.notion.so/desktop) installed locally

---

## Slack setup — pick your IDE

Slack auth uses the official MCP OAuth flow. Works with any IDE that supports MCP:

| IDE | How to connect | Token handling |
|---|---|---|
| **Cursor** | Settings → MCP → Add → Slack | Auto-refreshed — no manual steps ever |
| **VS Code** (Cline / Copilot) | Add Slack MCP server in extension settings | Copy token to `SLACK_MCP_TOKEN` in `.env` |
| **Windsurf** | Cascade settings → MCP → Add Slack | Copy token to `SLACK_MCP_TOKEN` in `.env` |
| **Claude Code** | `claude mcp add slack` | Copy token to `SLACK_MCP_TOKEN` in `.env` |
| **Other / none** | Use the [Slack MCP server](https://github.com/modelcontextprotocol/servers) directly | Copy token to `SLACK_MCP_TOKEN` in `.env` |

> **Cursor users:** the token is read automatically from Cursor's local storage and refreshes silently. Nothing to copy or update.
>
> **Everyone else:** after connecting Slack MCP in your IDE, find the token in your IDE's MCP config and paste it as `SLACK_MCP_TOKEN` in your `.env` file.

> **Notion:** read from the local SQLite database on your machine — no API key needed.

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

Claude will ask you about your teams, channels, schedule, and preferred AI provider — answer the questions and it generates everything automatically. Setup takes about 10 minutes.

---

## How it works

```
Slack (mentions + threads)
Notion (local SQLite)        →  Team Agents  →  AI Model  →  Your Slack DMs
                                (one per team)   (your choice)
```

Each agent knows the Slack channels and Notion keywords relevant to its team. They run in parallel, each producing a section of the briefing. A Stakeholders agent synthesizes everything into a cross-team view.

---

## Manual setup (alternative to /setup-pm-agents)

```bash
git clone https://github.com/shugavibes/shuga-pm-agents
cd shuga-pm-agents
npm install
cp .env.example .env
# Edit .env — add your AI provider key + SLACK_MCP_TOKEN if not using Cursor
```

Edit `config.mjs` with your name, company, current goal, and AI provider:

```js
ai: {
  provider: 'openai',   // 'anthropic' | 'openai' | 'gemini' | 'kimi' | 'deepseek' | 'groq' | 'mistral'
  model: 'gpt-4o',      // leave blank to use each provider's default
}
```

Replace the files in `agents/` with agents for your actual teams (use the existing ones as templates).

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

**`config.mjs`** — your name, company, product, AI provider, and active goal. Everything reads from here.

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
- macOS, Windows, or Linux
- Any IDE with MCP support (Cursor, VS Code + Cline, Windsurf, Claude Code, etc.)
- Notion desktop app

---

## Contributing

This is an early-stage personal tool — feedback welcome. Open an issue or PR.
