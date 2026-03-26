import fs from 'fs';
import { execSync } from 'child_process';
import { log } from './logger.mjs';

function inlineHtml(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

export function markdownToHtml(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  let ulOpen = false, olOpen = false;
  function closeLists() {
    if (ulOpen) { out.push('</ul>'); ulOpen = false; }
    if (olOpen) { out.push('</ol>'); olOpen = false; }
  }
  for (const line of lines) {
    if      (/^### (.+)/.test(line))     { closeLists(); out.push(`<h3>${inlineHtml(line.slice(4))}</h3>`); }
    else if (/^## (.+)/.test(line))      { closeLists(); out.push(`<h2>${inlineHtml(line.slice(3))}</h2>`); }
    else if (/^# (.+)/.test(line))       { closeLists(); out.push(`<h1>${inlineHtml(line.slice(2))}</h1>`); }
    else if (/^[-*] (.+)/.test(line))    { if (!ulOpen) { closeLists(); out.push('<ul>'); ulOpen = true; } out.push(`<li>${inlineHtml(line.slice(2))}</li>`); }
    else if (/^\d+\. (.+)/.test(line))   { if (!olOpen) { closeLists(); out.push('<ol>'); olOpen = true; } out.push(`<li>${inlineHtml(line.replace(/^\d+\. /, ''))}</li>`); }
    else if (/^> (.+)/.test(line))       { closeLists(); out.push(`<blockquote>${inlineHtml(line.slice(2))}</blockquote>`); }
    else if (/^---+$/.test(line.trim())) { closeLists(); out.push('<hr>'); }
    else if (line.trim() === '')         { closeLists(); }
    else                                 { closeLists(); out.push(`<p>${inlineHtml(line)}</p>`); }
  }
  closeLists();
  return out.join('\n');
}

export function copyHtmlToClipboard(html) {
  const tmpPath = '/tmp/notion-clipboard.html';
  fs.writeFileSync(tmpPath, `<html><body>${html}</body></html>`, 'utf8');
  execSync(
    `osascript -e 'set c to (read POSIX file "/tmp/notion-clipboard.html" as «class utf8»)' ` +
    `-e 'set the clipboard to {«class HTML»:c, string:c}'`
  );
  log.success('Formatted content copied to clipboard');
}
