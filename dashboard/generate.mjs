#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = path.join(os.homedir(), '.agents');
const OUT_FILE = path.join(__dirname, 'index.html');
const ROOT = path.join(__dirname, '..');

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, ''); // eslint-disable-line no-control-regex
}

function tailLog(logPath, lines = 20) {
  const fullPath = logPath.startsWith('~/') ? path.join(os.homedir(), logPath.slice(2)) : logPath;
  if (!fs.existsSync(fullPath)) return [];
  try {
    const all = fs.readFileSync(fullPath, 'utf8').split('\n').filter(Boolean);
    return all.slice(-lines).map(stripAnsi);
  } catch { return []; }
}

// ─── Agent metadata (static — from source files) ──────────────────────────────
const AGENT_META = [
  {
    slug: 'design', name: 'Design', emoji: '🎨',
    channels: ['design', 'card-design', 'ux', 'figma', 'product-design'],
    keywords: ['design', 'figma', 'admin experience', 'employee view', 'ui', 'screens', 'flow'],
    routing: 'Design reviews, Figma status, UX decisions, screen specs, admin and employee-facing UI',
    systemPrompt: `You are the Design Agent for Nico, PM at Remote.com on the EOR Expense Card.
Domain: Admin experience (employer portal: card issuance, limits, spend controls) and Employee experience (card request, transactions, expense submission).
Documents: Design Review Notes, Design Briefs, Handoff Docs, Weekly Design Status.
Active goal: Card MVP by April 1st — flag anything blocking design sign-off.`,
  },
  {
    slug: 'cards', name: 'Cards', emoji: '💳',
    channels: ['card', 'cards', 'eng-card', 'card-engineering', 'card-integration', 'card-alpha', 'card-program'],
    keywords: ['card', 'atlas', 'airwallex', 'alpha', 'card program', 'mcc', 'card setup'],
    routing: 'Card engineering integration, API contracts, Atlas/Airwallex, card program setup, alpha launch, technical blockers',
    systemPrompt: `You are the Cards Agent for Nico, PM at Remote.com on the EOR Expense Card.
Domain: Atlas integration (issued by Airwallex), API contracts, card program setup (Remoters internal alpha → EOR external), MCC mapping, transaction flows, partial multi-tenancy.
Alpha tracker: ✅ Stable entry API, ✅ MCC mapping, ✅ Onboarding script, ✅ Staging env, 🔄 Partial multi-tenancy, 🔄 Airwallex contract.
Documents: Integration Status Reports, API Contract Summaries, Launch Readiness Checklists.
Active goal: Card MVP by April 1st. Be precise about technical blockers and ETAs.`,
  },
  {
    slug: 'expenses', name: 'Expenses', emoji: '🧾',
    channels: ['expense', 'expenses', 'billing', 'payroll', 'pay', 'disbursement', 'finance'],
    keywords: ['expense', 'billing', 'payroll', 'pay item', 'notional', 'direct billing', 'disbursement', 'net pay', 'gross-up'],
    routing: 'Expense flows, direct billing integration, notional pay item mappings, payroll processing, cross-domain billing',
    systemPrompt: `You are the Expenses Agent for Nico, PM at Remote.com on the EOR Expense Card.
Domain: (1) Expense flows — card transactions → expense records via MCC codes. (2) Billing — non-taxable → direct billing from Expenses domain; taxable → Notional Pay Item in payroll → gross-up → billable = amount + tax. (3) Payroll integration — limited to countries with automated taxability + gross-up.
Key decisions (2026-03-18 meeting): taxable via payroll, non-taxable via Expenses domain, launch limited to gross-up countries.
Open questions: invoice line item format, Detailed Invoice column, Itemized Report description, country fallback for no gross-up.
Documents: Process Flow Narratives, Pay Item Mapping Tables, Billing Integration Specs.`,
  },
  {
    slug: 'mobile', name: 'Mobile', emoji: '📱',
    channels: ['mobile', 'ios', 'android', 'app', 'mobile-card', 'mobile-expenses'],
    keywords: ['mobile', 'alpha', 'beta', 'eor expense card - mobile', 'app', 'ios', 'android', 'wallet'],
    routing: 'Mobile app, iOS/Android card features, Mobile Alpha and Beta launches, app-side UX, release planning',
    systemPrompt: `You are the Mobile Agent for Nico, PM at Remote.com on the EOR Expense Card.
Alpha (internal Remoters): card provisioning → Apple/Google Wallet, transaction view, balance view, spend controls.
Beta external test (next): expense submission from mobile, push notifications, full transaction management.
Key: iOS + Android ship in parallel. App Store/Play Store review = 3-5 days. Open question: can transactions be declined at POS?
Documents: Sprint Reviews, Release Readiness Checklists, Feature Specs (with acceptance criteria).
Active goal: Alpha stable end of March, Beta external kickoff April 1st.`,
  },
  {
    slug: 'stakeholders', name: 'Stakeholders', emoji: '📊',
    channels: ['product', 'leadership', 'general', 'announce', 'remote-is-ssot', 'exec', 'international-operations'],
    keywords: ['stakeholder', 'ssot', 'alignment', 'competitor', 'churn', 'mvp', 'roadmap', 'strategy', 'plan'],
    routing: 'Cross-team alignment, leadership updates, competitor context, strategic documents, team-wide broadcasts',
    systemPrompt: `You are the Stakeholders Agent for Nico, PM at Remote.com on the EOR Expense Card.
Domain: Synthesizes across ALL teams (Design, Cards, Expenses, Mobile) for leadership-level views.
Context: "Remote is SSoT" initiative — Notion as single source of truth. Card MVP = company-level April 1st commitment. Card product reduces EOR churn by solving top admin pain point.
Documents: Executive Updates (scannable in 30s), Stakeholder Briefs, Cross-Team Alignment Docs, Weekly Broadcast Messages, Risk Registers.
Gets unfiltered context across all Slack channels and Notion pages.`,
  },
];

// ─── Read all data ────────────────────────────────────────────────────────────
const shugaTina    = readJson(path.join(AGENTS_DIR, 'shugaTina.json'));
const productAgent = readJson(path.join(AGENTS_DIR, 'product-agent.json'));
const shugaLogs    = tailLog('~/.weekly-audit.log', 20);
const productLogs  = tailLog('~/.product-agent.log', 20);

const agentOutputs = {};
const agentMemories = {};
for (const a of AGENT_META) {
  agentOutputs[a.slug] = readJson(path.join(AGENTS_DIR, `output-${a.slug}.json`));
  const memPath = path.join(AGENTS_DIR, `memory-${a.slug}.md`);
  agentMemories[a.slug] = fs.existsSync(memPath) ? fs.readFileSync(memPath, 'utf8') : null;
}

const data = {
  generatedAt: new Date().toISOString(),
  shugaTina,
  productAgent,
  shugaLogs,
  productLogs,
  agentMeta: AGENT_META,
  agentOutputs,
  agentMemories,
};

const dataJson = JSON.stringify(data, null, 2).replace(/<\/script>/gi, '<\\/script>');

// ─── HTML ─────────────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AGENT_DASHBOARD</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #000;
      color: #00ff41;
      font-family: 'Courier New', Courier, monospace;
      font-size: 13px;
      line-height: 1.6;
      padding: 28px 24px;
      min-height: 100vh;
    }

    body::after {
      content: '';
      position: fixed; inset: 0;
      background: repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.08) 3px, rgba(0,0,0,0.08) 4px);
      pointer-events: none; z-index: 9999;
    }

    h1 {
      font-size: 15px; font-weight: normal; color: #00ff41;
      text-shadow: 0 0 10px #00ff41, 0 0 24px #00ff4144;
      margin-bottom: 6px; letter-spacing: 0.15em; text-transform: uppercase;
    }
    h1::before { content: '> '; color: #00aa33; }

    .subtitle {
      font-size: 10px; color: #00aa33; letter-spacing: 0.1em;
      margin-bottom: 24px;
    }

    /* ── Layout ── */
    .section-label {
      font-size: 10px; color: #009933; letter-spacing: 0.14em;
      text-transform: uppercase; margin-bottom: 10px; margin-top: 4px;
    }
    .section-label::before { content: '// '; }

    .row { display: grid; gap: 16px; margin-bottom: 16px; }
    .row-1 { grid-template-columns: 1fr; }
    .row-2 { grid-template-columns: 1fr 1fr; }
    .row-3 { grid-template-columns: repeat(3, 1fr); }
    .row-2-3 { grid-template-columns: repeat(2, 1fr); }

    /* ── Cards ── */
    .card {
      background: #000; border: 1px solid #00aa2a;
      box-shadow: 0 0 12px #00ff4122, inset 0 0 16px #00ff410a;
      padding: 18px 16px 14px;
    }
    .card.orchestrator {
      border-color: #00ff41;
      box-shadow: 0 0 20px #00ff4144, inset 0 0 24px #00ff4110;
    }
    .card.agent-card { border-color: #00aa33; }
    .card.agent-card.status-error { border-color: #882200; box-shadow: 0 0 12px #ff333322; }
    .card.agent-card.status-never { border-color: #335533; }

    .card-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid #005518;
    }
    .card-title-row { display: flex; align-items: center; gap: 8px; }
    .card-title { font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: #00ff41; text-shadow: 0 0 8px #00ff41aa; }
    .card-emoji { font-size: 14px; }

    /* ── Badges ── */
    .badge { font-size: 10px; letter-spacing: 0.1em; padding: 2px 7px; border: 1px solid currentColor; }
    .badge-ok   { color: #00ff41; text-shadow: 0 0 6px #00ff41; }
    .badge-err  { color: #ff3333; text-shadow: 0 0 6px #ff3333; border-color: #ff3333; }
    .badge-part { color: #ffaa00; text-shadow: 0 0 6px #ffaa00; border-color: #ffaa00; }
    .badge-run  { color: #00aaff; text-shadow: 0 0 6px #00aaff; border-color: #00aaff; }
    .badge-none { color: #448844; border-color: #448844; }

    /* ── Alerts ── */
    .alert { border: 1px solid #ff3333; background: #0d0000; color: #ff3333; text-shadow: 0 0 6px #ff333388; padding: 6px 10px; margin-bottom: 10px; font-size: 11px; }
    .alert::before { content: '! '; }
    .alert-warn { border-color: #ffaa00; background: #0d0800; color: #ffaa00; text-shadow: 0 0 6px #ffaa0088; }

    /* ── Metrics ── */
    .metrics { display: flex; flex-direction: column; gap: 3px; margin-bottom: 14px; font-size: 11px; }
    .metric { display: flex; align-items: baseline; white-space: nowrap; overflow: hidden; }
    .metric-label { color: #00cc44; text-transform: uppercase; letter-spacing: 0.06em; flex-shrink: 0; }
    .metric-dots  { flex: 1; color: #005518; padding: 0 3px; min-width: 6px; }
    .metric-value { color: #00ff41; text-shadow: 0 0 4px #00ff4166; flex-shrink: 0; }

    /* ── Agent sub-status grid ── */
    .agent-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 14px; }
    .agent-mini { border: 1px solid #007722; padding: 6px 8px; font-size: 10px; }
    .agent-mini.ok  { border-color: #00cc44; }
    .agent-mini.err { border-color: #882200; }
    .agent-mini-name { color: #00cc44; letter-spacing: 0.08em; display: block; margin-bottom: 3px; }
    .agent-mini.ok  .agent-mini-name { color: #00ff41; }
    .agent-mini.err .agent-mini-name { color: #ff3333; }
    .agent-mini-val  { color: #00aa33; font-size: 10px; }

    /* ── Expandable sections ── */
    details { margin-top: 8px; }
    summary { font-size: 10px; color: #009933; cursor: pointer; user-select: none; list-style: none; letter-spacing: 0.1em; text-transform: uppercase; padding: 4px 0; }
    summary::-webkit-details-marker { display: none; }
    summary::before { content: '[+] '; }
    details[open] summary::before { content: '[-] '; }
    summary:hover { color: #00ff41; }
    .section-body { margin-top: 8px; }

    /* ── Tags ── */
    .tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
    .tag { font-size: 9px; letter-spacing: 0.08em; padding: 1px 6px; border: 1px solid #007722; color: #00aa33; text-transform: uppercase; }

    /* ── System prompt box ── */
    pre {
      margin-top: 8px; background: #000; border: 1px solid #005518;
      padding: 8px 10px; font-size: 10px; font-family: 'Courier New', Courier, monospace;
      color: #00aa33; overflow-x: auto; white-space: pre-wrap; word-break: break-all;
      line-height: 1.7; max-height: 180px; overflow-y: auto;
    }

    /* ── Last output ── */
    .output-text {
      margin-top: 8px; background: #000; border: 1px solid #005518;
      padding: 8px 10px; font-size: 10px; color: #00dd44;
      line-height: 1.7; max-height: 200px; overflow-y: auto;
      white-space: pre-wrap; word-break: break-word;
    }
    .output-meta { font-size: 9px; color: #009933; margin-top: 4px; }

    /* ── Run buttons ── */
    .btn-row { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
    .btn {
      font-family: 'Courier New', Courier, monospace;
      font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase;
      border: 1px solid #00aa33; color: #00cc44; background: #000;
      padding: 4px 10px; cursor: pointer; transition: all 0.15s;
    }
    .btn:hover  { border-color: #00ff41; color: #00ff41; text-shadow: 0 0 6px #00ff41; box-shadow: 0 0 8px #00ff4133; }
    .btn:active { background: #001a08; }
    .btn.running { color: #00aaff; border-color: #00aaff; animation: pulse 1s infinite; }
    .btn.danger  { border-color: #882200; color: #ff5533; }
    .btn.danger:hover { border-color: #ff3333; color: #ff3333; text-shadow: 0 0 6px #ff3333; }

    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

    /* ── Toast ── */
    #toast {
      position: fixed; bottom: 24px; right: 24px; z-index: 10000;
      font-family: 'Courier New', Courier, monospace; font-size: 11px;
      border: 1px solid #00aa2a; background: #000; color: #00ff41;
      padding: 8px 14px; letter-spacing: 0.08em;
      opacity: 0; transition: opacity 0.3s; pointer-events: none;
    }
    #toast.show { opacity: 1; }
    #toast.err  { border-color: #ff3333; color: #ff3333; }

    /* ── Footer ── */
    .footer { margin-top: 24px; font-size: 10px; color: #007722; letter-spacing: 0.1em; }
    .footer::before { content: '// '; }
  </style>
</head>
<body>
  <h1>Agent_Dashboard</h1>
  <p class="subtitle" id="subtitle"></p>
  <div id="root"></div>
  <p class="footer" id="footer"></p>
  <div id="toast"></div>

<script>
const DATA = ${dataJson};
const IS_SERVER = window.location.protocol === 'http:';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function relTime(isoStr) {
  if (!isoStr) return 'NEVER';
  const s = Math.floor((Date.now() - new Date(isoStr)) / 1000);
  if (s < 60) return 'JUST_NOW';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm_AGO';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h_AGO';
  return Math.floor(h / 24) + 'd_AGO';
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const h = d.getHours(), mm = String(d.getMinutes()).padStart(2,'0');
  return days[d.getDay()] + ' ' + months[d.getMonth()] + ' ' + d.getDate() + ' ' + String(h).padStart(2,'0') + ':' + mm;
}
function nextWeekdayAt(hour) {
  const now = new Date(), d = new Date(now);
  d.setHours(hour,0,0,0);
  if (d <= now) d.setDate(d.getDate()+1);
  while (d.getDay()===0||d.getDay()===6) d.setDate(d.getDate()+1);
  return d;
}
function nextProductRun() {
  const at8=nextWeekdayAt(8), at18=nextWeekdayAt(18);
  return at8<at18?at8:at18;
}
function nextMonday9am() {
  const now=new Date(), d=new Date(now);
  d.setHours(9,0,0,0);
  const day=d.getDay(), daysUntil=day===1?(d<=now?7:0):(8-day)%7||7;
  d.setDate(d.getDate()+daysUntil);
  if(d<=now) d.setDate(d.getDate()+7);
  return d;
}

function h(tag, attrs, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs||{})) {
    if (k==='class') e.className=v;
    else if (k==='onclick') e.onclick=v;
    else if (k==='style') e.style.cssText=v;
    else e.setAttribute(k,v);
  }
  for (const c of children) {
    if (c==null) continue;
    e.append(typeof c==='string'?document.createTextNode(c):c);
  }
  return e;
}

function badge(status) {
  if (!status || status==='never') return h('span',{class:'badge badge-none'},'NO_DATA');
  if (status==='success') return h('span',{class:'badge badge-ok'},'OK');
  if (status==='partial')  return h('span',{class:'badge badge-part'},'PARTIAL');
  if (status==='running')  return h('span',{class:'badge badge-run'},'RUNNING');
  return h('span',{class:'badge badge-err'},'ERR');
}

function metricRow(label, value) {
  const lbl = label.toUpperCase().replace(/ /g,'_');
  const val = String(value).toUpperCase().replace(/ /g,'_');
  const dotsLen = Math.max(3, 42 - lbl.length - val.length);
  return h('div',{class:'metric'},
    h('span',{class:'metric-label'},lbl),
    h('span',{class:'metric-dots'},'.'.repeat(dotsLen)),
    h('span',{class:'metric-value'},val),
  );
}

function tags(items, color='#004410') {
  return h('div',{class:'tags'},...items.map(t=>h('span',{class:'tag',style:'border-color:'+color+';color:'+color},t)));
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(msg, isErr=false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (isErr?' err':'');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>el.className='', 3500);
}

// ─── Run button ───────────────────────────────────────────────────────────────
async function runAgent(mode, only, btn) {
  if (!IS_SERVER) {
    toast('Open via "npm run dashboard" to enable Run buttons', true); return;
  }
  btn.classList.add('running');
  btn.textContent = '[RUNNING...]';
  toast('Starting ' + (only||'all agents') + ' — ' + mode + '...');
  try {
    const r = await fetch('/api/run', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({mode, only}),
    });
    const j = await r.json();
    if (j.ok) {
      toast('Started PID ' + j.pid + ' — reload in ~30s to see results');
      setTimeout(()=>{btn.classList.remove('running');btn.textContent='['+mode.toUpperCase()+']';}, 2000);
    } else {
      toast('Error: ' + j.error, true);
      btn.classList.remove('running'); btn.textContent='['+mode.toUpperCase()+']';
    }
  } catch {
    toast('Server not reachable — use npm run dashboard', true);
    btn.classList.remove('running'); btn.textContent='['+mode.toUpperCase()+']';
  }
}

// ─── Orchestrator card ────────────────────────────────────────────────────────
function renderOrchestrator() {
  const d = DATA.productAgent;
  const overallStatus = !d ? null
    : (d.morningStatus==='error'||d.eodStatus==='error') ? 'error'
    : (d.morningStatus==='success'||d.eodStatus==='success') ? 'success' : null;

  const card = h('div',{class:'card orchestrator'});

  card.append(h('div',{class:'card-header'},
    h('div',{class:'card-title-row'},
      h('span',{class:'card-emoji'},'🧠'),
      h('span',{class:'card-title'},'Orchestrator'),
    ),
    badge(overallStatus),
  ));

  if (!d) { card.append(h('p',{class:'metric-label',style:'color:#224422;margin-bottom:12px'},'-- NEVER_RUN --')); }
  else {
    if (d.tokenExpired) card.append(h('div',{class:'alert alert-warn'},'TOKEN_EXPIRED — refresh xoxc/xoxd in .env'));
    if (d.errors?.length) card.append(h('div',{class:'alert'},d.errors.join(' | ')));

    card.append(h('div',{class:'metrics'},
      metricRow('Last morning', relTime(d.lastMorningRun)),
      metricRow('Morning',      d.morningStatus?.toUpperCase()||'NO_DATA'),
      metricRow('Last EOD',     relTime(d.lastEodRun)),
      metricRow('EOD',          d.eodStatus?.toUpperCase()||'NO_DATA'),
      metricRow('Mentions',     String(d.mentionsCount??0)),
      metricRow('Notion pages', String(d.notionPagesCount??0)),
      metricRow('Next run',     fmtDate(nextProductRun())),
    ));

    // Per-agent sub-status from orchestrator's agents map
    if (d.agents) {
      const grid = h('div',{class:'agent-grid'});
      for (const meta of DATA.agentMeta) {
        const st = d.agents[meta.slug]||d.agents[meta.name.toLowerCase()]||{};
        const cls = st.status==='success'?'ok':st.status==='error'?'err':'';
        grid.append(h('div',{class:'agent-mini '+cls},
          h('span',{class:'agent-mini-name'},meta.emoji+' '+meta.name),
          h('span',{class:'agent-mini-val'},st.status?st.status.toUpperCase():'NO_DATA'),
          st.duration?h('span',{class:'agent-mini-val',style:'display:block'},(st.duration/1000).toFixed(1)+'s'):'',
        ));
      }
      card.append(grid);
    }
  }

  // Logs
  if (DATA.productLogs?.length) {
    card.append(h('details',{},
      h('summary',{},'LOGS (LAST 20 LINES)'),
      h('div',{class:'section-body'},h('pre',{},DATA.productLogs.join('\\n'))),
    ));
  }

  // Run buttons
  const btnRow = h('div',{class:'btn-row'});
  const btnM = h('button',{class:'btn',onclick:function(){runAgent('morning',null,this)}},'[MORNING]');
  const btnE = h('button',{class:'btn',onclick:function(){runAgent('eod',null,this)}},'[EOD]');
  const reloadBtn = h('button',{class:'btn',onclick:function(){location.reload();}},'[REFRESH]');
  btnRow.append(btnM, btnE, reloadBtn);
  card.append(btnRow);

  return card;
}

// ─── ShugaTina card ───────────────────────────────────────────────────────────
function renderShugaTina() {
  const d = DATA.shugaTina;
  const card = h('div',{class:'card agent-card'+((!d)?' status-never':d.status!=='success'?' status-error':'')});

  card.append(h('div',{class:'card-header'},
    h('div',{class:'card-title-row'},
      h('span',{class:'card-emoji'},'🐚'),
      h('span',{class:'card-title'},'ShugaTina'),
    ),
    badge(d?.status||null),
  ));

  if (!d) { card.append(h('p',{class:'metric-label',style:'color:#224422;margin-bottom:10px'},'-- NEVER_RUN --')); }
  else {
    if (d.errors?.length) card.append(h('div',{class:'alert'},d.errors.join(' | ')));
    card.append(h('div',{class:'metrics'},
      metricRow('Last run',    relTime(d.lastRun)),
      metricRow('Findings',    String(d.findingsCount??0)),
      metricRow('MRs',         (d.mrsCreated??0)+'/'+(d.mrsTotal??0)),
      metricRow('Next run',    fmtDate(nextMonday9am())),
    ));
    if (d.findings?.length) {
      const sec = h('div',{class:'section-body'});
      for (const f of d.findings) {
        sec.append(h('div',{style:'font-size:11px;margin-bottom:4px;color:#00cc33'},
          '>> ', h('a',{href:f.mrUrl,target:'_blank',style:'color:#00cc33;text-decoration:none'},f.title)
        ));
      }
      card.append(h('details',{},h('summary',{},'FINDINGS ('+d.findings.length+')'),sec));
    }
  }

  if (DATA.shugaLogs?.length) {
    card.append(h('details',{},
      h('summary',{},'LOGS'),
      h('div',{class:'section-body'},h('pre',{},DATA.shugaLogs.join('\\n'))),
    ));
  }
  return card;
}

// ─── Team agent card ──────────────────────────────────────────────────────────
function renderAgentCard(meta) {
  const out = DATA.agentOutputs[meta.slug];
  const agentStatus = DATA.productAgent?.agents?.[meta.slug]||DATA.productAgent?.agents?.[meta.name.toLowerCase()];
  const status = agentStatus?.status || (out ? (out.success?'success':'error') : null);

  const card = h('div',{class:'card agent-card'+(status==='error'?' status-error':!status?' status-never':'')});

  card.append(h('div',{class:'card-header'},
    h('div',{class:'card-title-row'},
      h('span',{class:'card-emoji'},meta.emoji),
      h('span',{class:'card-title'},meta.name),
    ),
    badge(status),
  ));

  // Metrics
  if (out) {
    card.append(h('div',{class:'metrics'},
      metricRow('Last run', relTime(out.runAt)),
      metricRow('Mode',     out.mode?.toUpperCase()||'—'),
      metricRow('Duration', out.duration ? (out.duration/1000).toFixed(1)+'s' : '—'),
    ));
  } else {
    card.append(h('p',{class:'metric-label',style:'color:#224422;margin-bottom:10px'},'-- NEVER_RUN --'));
  }

  // Last output
  if (out?.output) {
    card.append(h('details',{},
      h('summary',{},'LAST OUTPUT'),
      h('div',{class:'section-body'},
        h('div',{class:'output-text'},out.output.slice(0, 1200)+(out.output.length>1200?'\\n[...]':'')),
        h('p',{class:'output-meta'},'run: '+fmtDate(out.runAt)+' · mode: '+(out.mode||'?')),
      ),
    ));
  }

  // Memory
  const mem = DATA.agentMemories?.[meta.slug];
  if (mem) {
    card.append(h('details',{},
      h('summary',{},'ACCUMULATED MEMORY'),
      h('div',{class:'section-body'},
        h('pre',{style:'color:#00cc44;border-color:#007722'},mem),
      ),
    ));
  }

  // Rules & instructions
  card.append(h('details',{},
    h('summary',{},'RULES & INSTRUCTIONS'),
    h('div',{class:'section-body'},
      h('p',{style:'font-size:10px;color:#00aa33;margin-bottom:6px'},'// SLACK CHANNELS'),
      tags(meta.channels, '#0066cc'),
      h('p',{style:'font-size:10px;color:#00aa33;margin:8px 0 6px'},'// NOTION KEYWORDS'),
      tags(meta.keywords, '#009933'),
      h('p',{style:'font-size:10px;color:#00aa33;margin:8px 0 6px'},'// ROUTING'),
      h('p',{style:'font-size:10px;color:#00aa33;margin-bottom:8px'},meta.routing),
      h('p',{style:'font-size:10px;color:#00aa33;margin-bottom:6px'},'// SYSTEM PROMPT'),
      h('pre',{},meta.systemPrompt),
    ),
  ));

  // Run buttons
  const btnRow = h('div',{class:'btn-row'});
  const btnM = h('button',{class:'btn',onclick:function(){runAgent('morning',meta.slug,this)}},'[MORNING]');
  const btnE = h('button',{class:'btn',onclick:function(){runAgent('eod',meta.slug,this)}},'[EOD]');
  btnRow.append(btnM, btnE);
  card.append(btnRow);

  return card;
}

// ─── Render ───────────────────────────────────────────────────────────────────
const root = document.getElementById('root');

// Orchestrator row
root.append(h('p',{class:'section-label'},'ORCHESTRATOR'));
root.append(h('div',{class:'row row-1'},renderOrchestrator()));

// Team agents row
root.append(h('p',{class:'section-label'},'TEAM_AGENTS'));
const agentRow = h('div',{class:'row',style:'grid-template-columns:repeat(3,1fr)'});
for (const meta of DATA.agentMeta) agentRow.append(renderAgentCard(meta));
root.append(agentRow);

// System agents row (ShugaTina)
root.append(h('p',{class:'section-label'},'SYSTEM_AGENTS'));
root.append(h('div',{class:'row',style:'grid-template-columns:1fr 2fr'},
  renderShugaTina(),
  h('div',{class:'card agent-card',style:'display:flex;align-items:center;justify-content:center;border-color:#002208'},
    h('span',{style:'color:#003310;font-size:11px;letter-spacing:0.1em'},'// SLOT AVAILABLE'),
  ),
));

const ts = new Date(DATA.generatedAt);
document.getElementById('subtitle').textContent =
  (IS_SERVER ? 'LIVE SERVER MODE — auto-refresh available' : 'STATIC MODE — open via npm run dashboard for Run buttons');
document.getElementById('footer').textContent =
  'GENERATED ' + ts.toLocaleString('en-US',{weekday:'short',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'}).toUpperCase().replace(/,/g,'');
</script>
</body>
</html>`;

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, html, 'utf8');
console.log(`Dashboard written to ${OUT_FILE}`);
