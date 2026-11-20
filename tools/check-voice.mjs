// Development only (npm start's prestart): are the offline voice files in voice/? They are kept out of git (~200 MB).
// Missing -> ask once to download them (tools/fetch-voice.mjs). Saying no still starts the app: it then uses the
// Windows voice and online speech-to-text.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'voice-manifest.json'), 'utf8'));
const missing = Object.keys(manifest).filter((f) => !fs.existsSync(path.join(ROOT, 'voice', f)));
if (!missing.length) process.exit(0);

const mb = (Object.values(manifest).reduce((n, f) => n + f.size, 0) / 1e6).toFixed(0);
console.log(`\nOffline voice files are missing from voice/ (${missing.length} of ${Object.keys(manifest).length} files, e.g. ${missing[0]}).`);
console.log(`Without them Genisys uses the Windows voice and online speech-to-text. Download: about ${mb} MB.`);
if (!process.stdin.isTTY) { console.log('Run: node tools/fetch-voice.mjs\n'); process.exit(0); }
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const yes = /^y/i.test((await rl.question('Download them now? (y/N) ')).trim());
rl.close();
if (yes) spawnSync(process.execPath, [path.join(ROOT, 'tools', 'fetch-voice.mjs')], { stdio: 'inherit' });
else console.log('Skipped. Later: node tools/fetch-voice.mjs\n');
