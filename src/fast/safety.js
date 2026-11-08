// Stage 9: the safety checker for AI-written PowerShell. It is a filter, not a sandbox: it blocks the obvious dangerous
// shapes, requires confirmation for anything that deletes/overwrites/downloads, and checks every literal path.
// The caller (main process) runs it again right before executing, so the page cannot skip it.
import path from 'node:path';

// Undo common obfuscation before matching: backticks, 'i'+'ex' string splicing, extra spaces.
export function flatten(script) {
  return String(script).replace(/`/g, '').replace(/(['"])\s*\+\s*\1/g, '').replace(/\s+/g, ' ');
}

const BLOCK = [
  [/\b(invoke-expression|iex)\b/i, 'uses Invoke-Expression'],
  [/(?:^|\s)-(?:enc|encodedcommand)\b/i, 'encoded command'],
  [/&\s*\$|\.\s+\$[a-z]|&\s*\(|\bcall\s+\$/i, 'runs a command built at run time'],
  [/\b(format-volume|format-disk|clear-disk|remove-partition|initialize-disk|new-partition|set-disk|diskpart|bcdedit)\b|\bformat\s+[a-z]:/i, 'disk or boot management'],
  [/\b(stop-computer|restart-computer|shutdown)\b/i, 'shuts down or restarts the PC'],
  [/\b(new-localuser|remove-localuser|set-localuser|add-localgroupmember|net\s+user|net\s+localgroup)\b/i, 'user account management'],
  [/\b(set-itemproperty|new-itemproperty|remove-itemproperty|remove-item\s+hk|new-item\s+(?:-path\s+)?hk|reg\s+(?:add|delete|import)|regedit)\b|\bhk(?:lm|cu|cr|u):/i, 'registry write'],
  [/-verb\s+runas|\brunas\b|start-process[^|;]*-verb\s+['"]?runas/i, 'asks for administrator rights'],
  [/\b(set-mppreference|disable-windowsoptionalfeature|set-executionpolicy|netsh\s+advfirewall)\b/i, 'changes security settings'],
];
const DOWNLOAD = /\b(invoke-webrequest|iwr|invoke-restmethod|irm|curl|wget|start-bitstransfer|downloadstring|downloadfile|net\.webclient)\b/i;
const EXEC = /\b(start-process|invoke-item|ii)\b|\.(exe|bat|cmd|ps1|msi|vbs)\b|\|\s*(iex|invoke-expression)/i;
const DESTRUCTIVE = /\b(remove-item|del|erase|rd|rmdir|rm|move-item|mv|rename-item|ren|clear-content|clear-recyclebin|set-content|out-file|add-content|copy-item|cp|new-item|mkdir|md)\b|(?:^|\s)>>?\s|-outfile\b|-destination\b/i;
const CREATES = /\b(new-item|mkdir|md|set-content|out-file|add-content|copy-item|cp|move-item|mv|rename-item|ren)\b|-outfile\b|-destination\b|(?:^|\s)>>?\s/i;
const WIPES = /\b(remove-item|del|erase|rd|rmdir|rm|clear-content|clear-recyclebin|move-item|mv|rename-item|ren)\b/i;
const CONFIRM = [
  [/\b(stop-process|taskkill|kill)\b/i, 'stops running programs'],
  [DOWNLOAD, 'downloads from the internet'],
];

// Literal absolute paths inside the script (C:\x\y, quoted or not, plus $env:USERPROFILE\...).
export function extractPaths(script, env = {}) {
  const found = new Set();
  let rest = String(script);
  // quoted paths first (they may contain spaces: 'C:\Program Files\x.exe'), then cut them out
  rest = rest.replace(/(['"])([A-Za-z]:\\[^'"\r\n]*)\1/g, (m, q, p) => { found.add(p); return ' '; });
  for (const m of rest.matchAll(/[A-Za-z]:\\[^\s'"`|;,)<>*?]*/g)) found.add(m[0]);
  for (const m of rest.matchAll(/\$env:([A-Za-z_]+)((?:\\[^\s'"`|;,)<>*?]+)?)/gi)) { const base = env[m[1].toUpperCase()]; if (base) found.add(base + m[2]); }
  return [...found].map((p) => p.replace(/[\\.]+$/, '')).filter(Boolean);
}

const inside = (p, roots) => { const n = path.win32.resolve(p).toLowerCase(); return roots.some((r) => { const x = path.win32.resolve(r).toLowerCase(); return n === x || n.startsWith(x.endsWith('\\') ? x : x + '\\'); }); };
export const isInside = inside;

// -> { level: 'ok' | 'confirm' | 'block', reasons: [..], paths: [..], destructive: bool }
export function checkScript(script, { allowed = [], launchRoots = [], exists = () => true, env = {} } = {}) {
  const reasons = [];
  let level = 'ok';
  const up = (l) => { if (l === 'block' || (l === 'confirm' && level === 'ok')) level = l; };
  const flat = flatten(script);
  if (!String(script).trim()) return { level: 'block', reasons: ['empty script'], paths: [], destructive: false };
  if (/[\u2018\u2019\u201c\u201d]/.test(script) && /[\u2018\u2019\u201c\u201d]\s*[;|&]/.test(script)) { reasons.push('curly quotes can hide a second command'); up('block'); }
  for (const [re, why] of BLOCK) if (re.test(flat)) { reasons.push(`blocked: ${why}`); up('block'); }
  if (DOWNLOAD.test(flat) && EXEC.test(flat)) { reasons.push('blocked: download and run'); up('block'); }
  for (const [re, why] of CONFIRM) if (re.test(flat)) { reasons.push(why); up('confirm'); }
  const destructive = DESTRUCTIVE.test(flat);
  const wipes = WIPES.test(flat);
  if (wipes) { reasons.push('deletes, moves or renames things'); up('confirm'); }
  else if (destructive) { reasons.push('writes or overwrites files'); up('confirm'); }

  const paths = extractPaths(script, env);
  const missing = paths.filter((p) => !exists(p)).length;
  for (const p of paths) {
    if (p.split(/[\\/]+/).includes('..')) { reasons.push(`blocked: path with ".." ${p}`); up('block'); continue; }
    const ok = inside(p, allowed);
    if (!ok && wipes) { reasons.push(`blocked: ${p} is outside the allowed folders`); up('block'); }
    else if (!ok && destructive) { reasons.push(`blocked: writing outside the allowed folders (${p})`); up('block'); }
    else if (!ok && !inside(p, launchRoots)) { reasons.push(`touches ${p} (outside the usual folders)`); up('confirm'); }
    if (!exists(p)) {
      // a NEW file/folder is fine when its folder exists and the script creates things (at most one such path)
      if (CREATES.test(flat) && missing === 1 && exists(path.win32.dirname(p))) continue;
      reasons.push(`blocked: path does not exist ${p}`); up('block');
    }
  }
  return { level, reasons: [...new Set(reasons)], paths, destructive: wipes || destructive };
}
