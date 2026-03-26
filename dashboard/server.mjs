#!/usr/bin/env node
/**
 * Dashboard server — serves the agent dashboard + handles "Run" button requests.
 * Usage: node dashboard/server.mjs
 * Opens: http://localhost:3747
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORT = 3747;

function generate() {
  try {
    execSync(`node ${path.join(__dirname, 'generate.mjs')}`, { cwd: ROOT, stdio: 'pipe' });
  } catch (e) {
    console.error('generate failed:', e.message);
  }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer((req, res) => {
  cors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return;
  }

  // Serve dashboard
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    generate();
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html); return;
  }

  // Status JSON (live, no regenerate)
  if (req.method === 'GET' && req.url === '/api/status') {
    generate();
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    // Extract the DATA json from the generated HTML
    const match = html.match(/const DATA = ([\s\S]+?);\s*\n/);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(match ? match[1] : '{}'); return;
  }

  // Run orchestrator
  if (req.method === 'POST' && req.url === '/api/run') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { mode = 'morning', only = null } = JSON.parse(body || '{}');
        const args = ['orchestrator.mjs', mode];
        if (only) args.push('--only', only);
        const proc = spawn('/opt/homebrew/bin/node', args, {
          cwd: ROOT,
          detached: true,
          stdio: ['ignore', fs.openSync(path.join(process.env.HOME, '.product-agent.log'), 'a'), fs.openSync(path.join(process.env.HOME, '.product-agent.log'), 'a')],
        });
        proc.unref();
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, pid: proc.pid, mode, only }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
  try { execSync(`open http://localhost:${PORT}`); } catch {}
});
