// `npm test`: runs every test in one command with Node's built-in test runner (no new dependency).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (!/node_modules|\.vite|out/.test(e.name)) walk(f); } else if (/\.test\.mjs$/.test(e.name)) files.push(f); } };
walk(path.join(root, 'src'));
walk(path.join(root, 'tools'));
let skip = [];
try { await import('node:sqlite'); } catch { skip = files.filter((f) => /db\.test\.mjs$/.test(f)); console.log('(skipping db.test.mjs: this Node has no node:sqlite. Run it with Electron\'s Node, see the file header)'); }
const r = spawnSync(process.execPath, ['--test', ...files.filter((f) => !skip.includes(f))], { stdio: 'inherit' });
process.exit(r.status ?? 1);
