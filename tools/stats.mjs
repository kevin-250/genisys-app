// Stage 10: success rate and average time per route / action / provider, and old flow vs new flow.
// Usage:  node tools/stats.mjs [path-to-timing.log]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseLog, formatStats } from '../src/fast/stats.js';

const file = process.argv[2] || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Executor', 'timing.log');
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const rotated = file.replace(/\.log$/, '.old.log');
const text = (rotated !== file ? read(rotated) : '') + read(file);
if (!text) { console.log(`No timing log at ${file}. Run some commands in Genisys first.`); process.exit(0); }
console.log('\n' + formatStats(parseLog(text)) + '\n');
