// Downloads the offline voice files into voice/ (kept out of git: ~200 MB). `node tools/fetch-voice.mjs`
//   voice/piper    Piper 2023.11.14-2 for Windows (MIT), English pronunciation data only
//   voice/kristin  en_US-kristin-medium (public domain)     voice/joe  en_US-joe-medium (CC0)
//   voice/whisper  whisper.cpp b5454 CPU build (MIT) + ggml-base.en-q5_1 model
// Every file is checked against tools/voice-manifest.json (SHA-256); a mismatch stops the build.
// Uses only Node and Windows' own tar (it unpacks .zip too).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first'); // networks with a broken IPv6 route made Node's fetch fail (curl and browsers fall back)

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const VOICE = process.env.VOICE_DIR ? path.resolve(process.env.VOICE_DIR) : path.join(ROOT, 'voice'); // VOICE_DIR: try it somewhere else
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'voice-manifest.json'), 'utf8'));
const TEXT = /(^|\/)(MODEL_CARD|LICENSE(\.md)?)$/; // wording may change upstream: fetched, not hash-checked
const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'genisys-voice-'));

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const SYS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
// Windows' own curl: retries and resumes big files (Node's fetch kept dropping 60 MB downloads on a flaky connection)
async function get(url, file) {
  execFileSync(path.join(SYS, 'curl.exe'), ['-fsSL', '--retry', '8', '--retry-all-errors', '--retry-delay', '2', '-C', '-', '-o', file, url], { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log(`  ${path.basename(file)}  ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
  return file;
}
// Windows' own tar (bsdtar unpacks .zip); Git Bash's GNU tar would read "C:" as a remote host
const unzip = (zip, dir) => { fs.mkdirSync(dir, { recursive: true }); execFileSync(path.join(SYS, 'tar.exe'), ['-xf', zip, '-C', dir]); };
const put = (src, rel) => { const to = path.join(VOICE, rel); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.cpSync(src, to, { recursive: true }); };
// this Piper build rejects two-character sounds ("aɪ") in newer voice configs; its own phonemizer never makes them
const cleanConfig = (file) => { const j = JSON.parse(fs.readFileSync(file, 'utf8')); for (const k of Object.keys(j.phoneme_id_map)) if ([...k].length !== 1) delete j.phoneme_id_map[k]; fs.writeFileSync(file, JSON.stringify(j, null, 1)); };

try {
  console.log('Piper (22.5 MB)');
  const pz = await get('https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip', path.join(tmp, 'piper.zip'));
  unzip(pz, path.join(tmp, 'p'));
  for (const f of ['piper.exe', 'espeak-ng.dll', 'onnxruntime.dll', 'onnxruntime_providers_shared.dll', 'piper_phonemize.dll', 'espeak-ng-data']) put(path.join(tmp, 'p', 'piper', f), `piper/${f}`);
  for (const f of fs.readdirSync(path.join(VOICE, 'piper', 'espeak-ng-data'))) if (/_dict$/.test(f) && f !== 'en_dict') fs.rmSync(path.join(VOICE, 'piper', 'espeak-ng-data', f)); // English only
  await get('https://raw.githubusercontent.com/rhasspy/piper/master/LICENSE.md', path.join(VOICE, 'piper', 'LICENSE.md'));

  for (const v of ['kristin', 'joe']) {
    console.log(`Voice ${v} (~63 MB)`);
    fs.mkdirSync(path.join(VOICE, v), { recursive: true });
    await get(`${HF}/${v}/medium/en_US-${v}-medium.onnx`, path.join(VOICE, v, 'model.onnx'));
    await get(`${HF}/${v}/medium/en_US-${v}-medium.onnx.json`, path.join(VOICE, v, 'model.onnx.json'));
    cleanConfig(path.join(VOICE, v, 'model.onnx.json'));
    await get(`${HF}/${v}/medium/MODEL_CARD`, path.join(VOICE, v, 'MODEL_CARD'));
  }

  console.log('whisper.cpp (8.9 MB) + base.en q5 model (59.7 MB)');
  const wz = await get('https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip', path.join(tmp, 'whisper.zip'));
  unzip(wz, path.join(tmp, 'w'));
  const rel = path.join(tmp, 'w', 'Release');
  for (const f of fs.readdirSync(rel)) if (manifest[`whisper/${f}`]) put(path.join(rel, f), `whisper/${f}`); // only the files the app uses
  await get('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q5_1.bin', path.join(VOICE, 'whisper', 'model.bin'));
  await get('https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/LICENSE', path.join(VOICE, 'whisper', 'LICENSE'));

  // every file must be exactly the one the app was tested with
  const bad = [];
  for (const [rel2, want] of Object.entries(manifest)) {
    const f = path.join(VOICE, rel2);
    if (!fs.existsSync(f)) bad.push(`missing ${rel2}`);
    else if (!TEXT.test(rel2) && sha(f) !== want.sha256) bad.push(`checksum ${rel2}`);
  }
  if (bad.length) { console.error(`\nVoice files do not match tools/voice-manifest.json:\n  ${bad.slice(0, 20).join('\n  ')}`); process.exit(1); }
  console.log(`\nvoice/ ready: ${Object.keys(manifest).length} files checked.`);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
