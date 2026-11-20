// Real-app voice check over CDP. Start the app with a fake mic that plays one WAV, then run this:
//   npm start -- --remote-debugging-port=9333 --use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=test/audio/timer.wav
//   node tools/voice-e2e.mjs timer        (main window: mic button -> speak -> Enter)
//   node tools/voice-e2e.mjs timer runner (the Alt+Space runner window, which must already be open)
import fs from 'node:fs';

const [name = 'timer', where = 'main'] = process.argv.slice(2);
const wav = `test/audio/${name}.wav`;
const seconds = (fs.statSync(wav).size - 44) / 96000; // 48 kHz, 16-bit mono
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
const page = targets.find((t) => t.type === 'page' && t.url.includes(`mode=${where}`));
if (!page) { console.error(`no ${where} window; open:`, targets.map((t) => t.url)); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); pending.delete(d.id); });
const js = (expr) => new Promise((res, rej) => {
  const n = ++id;
  pending.set(n, (d) => (d.result?.exceptionDetails ? rej(new Error(d.result.exceptionDetails.exception?.description || 'js error')) : res(d.result?.result?.value)));
  ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
});

const state = () => js(`({ voice: !!document.querySelector('.foot.voice'), think: !!document.querySelector('.foot.vthink'),
  busy: document.getElementById('form').classList.contains('busy'), width: document.querySelector('.card')?.getBoundingClientRect().width | 0,
  user: [...document.querySelectorAll('.row.user .txt')].pop()?.textContent || '', cards: document.querySelectorAll('.tc').length,
  out: [...document.querySelectorAll('.row.out .txt, .row.ai .txt, .row.err .txt, .row.ask .txt')].pop()?.textContent || '',
  hint: document.getElementById('input').placeholder, spoken: window.__spoken || [], speaking: speechSynthesis.speaking || document.documentElement.hasAttribute('data-speaking'), vlog: (window.__vlog || []).slice(-1) })`);

for (let i = 0; i < 60 && !(await js(`document.readyState === 'complete' && typeof document.getElementById('mic')?.onclick === 'function'`)); i++) await sleep(500);
await sleep(1500); // the page settles (fonts, first paint) before the mic is started
const t0 = Date.now();
await js(`window.__spoken = []; ${where === 'main' ? "document.getElementById('mic').click();" : ''} true`);
await sleep(600);
const listening = await state();
console.log('listening:', { voice: listening.voice, width: listening.width });
await sleep(Math.max(500, seconds * 1000 - 400)); // the fake mic loops the WAV: stop before it starts again
await js(`document.getElementById('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })), true`);
const tEnter = Date.now();
let s, sent = 0, spokeAt = 0;
for (let i = 0; i < 120; i++) {
  await sleep(250);
  s = await state();
  if (!sent && s.busy) sent = Date.now();
  if (s.spoken.length && !spokeAt) spokeAt = Date.now();
  if (spokeAt && !s.busy && (!process.argv.includes('--esc') || s.speaking)) break; // --esc: wait until the voice is really playing
  if (!s.voice && !s.busy && !s.spoken.length && i > 40) break;
}
console.log(JSON.stringify({ ...s, msEnterToSent: sent ? sent - tEnter : null, msEnterToSpoken: spokeAt ? spokeAt - tEnter : null, totalMs: Date.now() - t0 }, null, 1));
if (process.argv.includes('--esc')) { // barge-out: Esc while speaking
  await js(`window.dispatchEvent(new Event('x')); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), true`);
  await sleep(300);
  console.log('after Esc speaking =', (await state()).speaking);
}
ws.close();
