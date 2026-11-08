// Genisys Stage 1: prints where the time goes, from %APPDATA%\Executor\timing.log.
// Usage:  node tools/timing-report.mjs [path-to-timing.log] [--last N]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const li = args.indexOf('--last');
const last = li >= 0 ? Number(args.splice(li, 2)[1]) || 0 : 0;
const file = args[0] || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Executor', 'timing.log');

if (!fs.existsSync(file)) { console.log(`No timing log at ${file}\nRun some commands in Genisys first.`); process.exit(0); }
let rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
if (last) rows = rows.slice(-last);
if (!rows.length) { console.log('timing.log is empty.'); process.exit(0); }

const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const avg = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

// 1) one line per command
console.log(`\nCommands (${rows.length})\n`);
console.log(`${pad('#', 3)}${pad('command', 38)}${pad('route', 7)}${rpad('total', 9)}${rpad('AI calls', 9)}${rpad('model', 9)}${rpad('run', 9)}  ok`);
rows.forEach((r, i) => {
  const st = r.stages || {};
  console.log(`${pad(i + 1, 3)}${pad((r.text || '').slice(0, 36), 38)}${pad(r.route || 'old', 7)}${rpad(fmt(r.totalMs || 0), 9)}${rpad(r.modelCalls ?? 0, 9)}${rpad(fmt(st.modelWait || 0), 9)}${rpad(fmt(st.cmdRun || 0), 9)}  ${r.ok ? 'yes' : 'NO'}`);
});

// 2) average per stage (only commands that used the stage count towards its average; share is of total time)
const names = new Map();
for (const r of rows) for (const [k, v] of Object.entries(r.stages || {})) { if (!names.has(k)) names.set(k, []); names.get(k).push(v); }
const totalAll = rows.reduce((s, r) => s + (r.totalMs || 0), 0) || 1;
const DESC = {
  promptBuild: 'build prompt (prefs, memory, PC context)',
  modelWait: 'waiting for the AI model (renderer view)',
  modelNet: '  of which inside main: network + key/model switching',
  parse: 'parse the JSON reply',
  retryWait: 'sleep before retrying a busy model',
  cmdRun: 'run command (renderer view, incl. .bat)',
  batWrite: '  of which: writing the temp .bat',
  procExit: '  of which: cmd.exe start-up + command until it exits',
  exitGrace: '  of which: fixed wait after exit (late output)',
  find: 'file finder', launchApp: 'launch app', openPath: 'open file/URL', web: 'web search/read', fileWrite: 'write file',
};
console.log(`\nAverage per stage (over the commands that used it)\n`);
console.log(`${pad('stage', 56)}${rpad('uses', 6)}${rpad('avg', 10)}${rpad('median', 10)}${rpad('max', 10)}${rpad('share of time', 15)}`);
const order = Object.keys(DESC);
const keys = [...names.keys()].sort((a, b) => (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)));
for (const k of keys) {
  const v = names.get(k);
  const share = k === 'modelNet' || k === 'batWrite' || k === 'procExit' || k === 'exitGrace' ? '' : `${((v.reduce((s, x) => s + x, 0) / totalAll) * 100).toFixed(0)}%`;
  console.log(`${pad(DESC[k] || k, 56)}${rpad(v.length, 6)}${rpad(fmt(avg(v)), 10)}${rpad(fmt(med(v)), 10)}${rpad(fmt(Math.max(...v)), 10)}${rpad(share, 15)}`);
}
const tot = rows.map((r) => r.totalMs || 0);
console.log(`${pad('TOTAL per command', 56)}${rpad(rows.length, 6)}${rpad(fmt(avg(tot)), 10)}${rpad(fmt(med(tot)), 10)}${rpad(fmt(Math.max(...tot)), 10)}`);

// 3) model calls: provider/model, retries, key switches, tokens
const calls = rows.flatMap((r) => r.ai || []);
if (calls.length) {
  console.log(`\nModel calls: ${calls.length} (avg ${(calls.length / rows.length).toFixed(1)} per command), avg ${fmt(avg(calls.map((c) => c.ms)))} each, slowest ${fmt(Math.max(...calls.map((c) => c.ms)))}`);
  const failedTries = calls.reduce((s, c) => s + (c.attempts || []).filter((a) => a.r !== 'ok').length, 0);
  const switches = calls.reduce((s, c) => s + (c.keySwitches || 0), 0);
  console.log(`Failed attempts before an answer: ${failedTries}   key switches: ${switches}   avg attempts per call: ${(calls.reduce((s, c) => s + (c.attempts || []).length, 0) / calls.length).toFixed(1)}`);
  const pc = calls.map((c) => c.promptChars || 0);
  console.log(`Prompt size: avg ${Math.round(avg(pc)).toLocaleString()} chars (about ${Math.round(avg(pc) / 4).toLocaleString()} tokens)`);
  const tk = calls.filter((c) => c.usage);
  if (tk.length) console.log(`Reported tokens: avg ${Math.round(avg(tk.map((c) => c.usage.prompt_tokens || 0)))} in / ${Math.round(avg(tk.map((c) => c.usage.completion_tokens || 0)))} out (${tk.length} calls reported usage)`);
  const byModel = new Map();
  for (const c of calls) { const m = c.model || '(failed)'; if (!byModel.has(m)) byModel.set(m, []); byModel.get(m).push(c.ms); }
  console.log(`\n${pad('model that answered', 56)}${rpad('calls', 6)}${rpad('avg', 10)}`);
  for (const [m, v] of [...byModel].sort((a, b) => b[1].length - a[1].length)) console.log(`${pad(m, 56)}${rpad(v.length, 6)}${rpad(fmt(avg(v)), 10)}`);
}
console.log('');
