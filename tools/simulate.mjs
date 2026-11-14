// Dev check (file + PC tables): plays typical user requests through the real parser + real tools on this PC's folders and prints what the
// user would see. Run: node tools/simulate-files.mjs ["your own request"]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { parseIntent } from '../src/fast/intent.js';
import { makeActions } from '../src/fast/actions.js';
import { scanFiles, hashSample } from '../src/fast/files.js';

const home = os.homedir();
// the real library folders (Desktop/Pictures often live in OneDrive), like app.getPath gives the app
const SF = { documents: 'MyDocuments', desktop: 'Desktop', pictures: 'MyPictures', videos: 'MyVideos', music: 'MyMusic' };
const got = execSync(`powershell -NoProfile -Command "${Object.values(SF).map((v) => `[Environment]::GetFolderPath('${v}')`).join(';')}"`, { encoding: 'utf8' }).trim().split(/\r?\n/);
const paths = { home, downloads: path.join(home, 'Downloads'), ...Object.fromEntries(Object.keys(SF).map((k, i) => [k, got[i] || path.join(home, k)])) };
const A = makeActions({
  paths, exists: fs.existsSync, totalRam: os.totalmem(),
  sysQuery: async (q) => { const o = execSync('powershell -NoProfile -Command -', { input: q, encoding: 'utf8', maxBuffer: 1e8 }).trim(); try { return /^[[{]/.test(o) ? JSON.parse(o) : o; } catch { return o; } },
  isDir: (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
  scanFiles: (root) => scanFiles(root, fs.promises, { deadline: Date.now() + 8000 }),
  hashOf: (f) => hashSample(f, fs.promises, createHash),
  findFiles: async ({ name }) => { // stand-in for the app's index: folder names one level under the libraries
    const want = name.toLowerCase().replace(/s$/, '');
    const m = Object.values(paths).flatMap((r) => { try { return fs.readdirSync(r, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(r, e.name)); } catch { return []; } })
      .filter((p) => path.basename(p).toLowerCase().replace(/s$/, '') === want);
    return { matches: m.map((p) => ({ path: p, score: 1 })) };
  },
});
const asks = process.argv.length > 2 ? process.argv.slice(2) : [
  'search in all movies in videos , and show me all their date and arranges them from new ones to old ones',
  'show me the newest movie in my movies folder',
  'top 5 biggest files in downloads',
  'list my downloads from oldest to newest',
  'show pdfs in documents',
  'what is taking space in my downloads',
  'how many files of each type are on my desktop',
  'how many videos per month in videos',
  'find duplicate files in downloads',
  'show zip files in downloads older than 6 months',
  'show screenshots from this month',
  'which apps use the most memory', 'biggest installed programs', 'how much space is left on my drives', 'list startup apps', 'show wifi networks near me',
];
for (const t of asks) {
  const it = parseIntent(t);
  console.log(`\n» ${t}\n  → ${it.action} ${JSON.stringify(it.params)}`);
  if (!A[it.action] || !['browse_files', 'file_summary', 'find_duplicates', 'running_apps', 'installed_apps', 'drives', 'startup_apps', 'wifi_networks'].includes(it.action)) { console.log('  (not a file table)'); continue; }
  const r = await A[it.action](it.params);
  if (r.status !== 'done') { console.log(`  ✗ ${r.reason}`); continue; }
  console.log(`  ${r.message}`);
  if (r.stats) console.log('  stats: ' + r.stats.map((x) => `${x.label}=${x.value}`).join(', '));
  if (r.table) { console.log(`  ${r.table.columns.join(' | ')}`); for (const row of r.table.rows.slice(0, 4)) console.log(`  ${row.join(' | ')}`); if (r.table.rows.length > 4) console.log(`  … ${r.table.rows.length - 4} more rows`); }
}
