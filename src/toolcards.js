// Cards for the everyday tools (timer, stopwatch, alarms, world clock, coin, dice, notes, music…).
// Style: a small card, huge condensed digits that ROLL when they change (like Number Flow), a round red play/pause
// button whose icon swaps with a blur-and-scale animation, and a round × reset. Plain DOM, no framework: the font is
// Windows' built-in Bahnschrift (condensed), so nothing is downloaded. Buttons call the same tool again
// (window.api.fast) and the card redraws itself from the answer. Every text is set with textContent, never as HTML.

const RED = '#ff3828';
const CSS = `
.tcw { position: relative; width: 100%; margin: 18px 0 6px; transition: opacity .25s, transform .25s; }
.tcw.gone { opacity: 0; transform: scale(.96); }
.tc-cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; max-width: 420px; margin-top: 10px; text-align: center; font: 500 12px var(--ui); }
.tc-cal .tc-cw { color: var(--muted); font-size: 10px; font-weight: 600; letter-spacing: .6px; padding-bottom: 4px; }
.tc-cal .tc-cd { position: relative; padding: 7px 0; border-radius: 9px; font-variant-numeric: tabular-nums; }
.tc-cal .tc-cd.out { opacity: .3; }
.tc-cal .tc-cd.today { background: ${RED}; color: #fff; font-weight: 700; }
.tc-cal .tc-cd.has::after { content: ''; position: absolute; left: 50%; bottom: 3px; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: ${RED}; }
.tc-cal .tc-cd.today.has::after { background: #fff; }
.tc-calnav { max-width: 420px; display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.tc-calnav b { flex: 1; font: 700 18px var(--ui); }
.tc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; align-items: start; }
.tc-grid > .tc, .tc-grid > .tc-list { margin: 0; }
.tc-small { padding: 10px 12px 12px; border-radius: 14px; }
.tc-small .tc-num { font-size: 44px; } .tc-small .tc-num.md { font-size: 36px; } .tc-small .tc-item .tc-num { font-size: 28px; }
.tc-small .tc-title { font-size: 18px; } .tc-small .tc-round { width: 32px; height: 32px; } .tc-small .tc-ctrl { margin-top: 8px; }
.tc-small .tc-notes { max-height: 160px; } .tc-small .tc-coin { width: 70px; height: 70px; }
.tc { position: relative; margin: 0; padding: 14px 18px 16px; width: 100%; box-sizing: border-box; border: 1px solid var(--line2); border-radius: 18px;
  background: var(--code); font-family: var(--ui); color: var(--text); overflow: hidden; animation: tc-in .5s cubic-bezier(.2,.8,.2,1) both; }
@keyframes tc-in { from { opacity: 0; transform: translateY(8px) scale(.97); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
.tc-hov { position: absolute; z-index: 2; top: -15px; right: 12px; display: flex; gap: 6px; opacity: 0; transform: translateY(4px) scale(.9); pointer-events: none;
  transition: opacity .18s, transform .22s cubic-bezier(.3,1.4,.5,1); }
.tcw:hover .tc-hov, .tcw:focus-within .tc-hov { opacity: 1; transform: none; pointer-events: auto; }
.tc-hb { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 1px solid var(--line2); border-radius: 50%; background: var(--card);
  color: var(--text); box-shadow: 0 4px 12px -4px rgba(0,0,0,.35); cursor: pointer; transition: transform .12s, background .15s, color .15s; }
.tc-hb:hover { background: ${RED}; border-color: ${RED}; color: #fff; } .tc-hb:active { transform: scale(.9); }
.tc-hb svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.tc-h { display: flex; align-items: center; gap: 7px; color: var(--muted); font: 600 10px var(--ui); letter-spacing: 1.2px; text-transform: uppercase; opacity: .8; }
.tc-h svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.tc-h .tc-badge { margin-left: auto; padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--text); font-size: 9px; letter-spacing: .6px; }
.tc-num { display: flex; justify-content: center; align-items: center; margin: 6px 0 4px; font-family: Bahnschrift, 'Bebas Neue', 'Arial Narrow', Impact, sans-serif;
  font-stretch: condensed; font-weight: 600; font-size: 76px; line-height: 1; letter-spacing: -1px; font-variant-numeric: tabular-nums; }
.tc-num.md { font-size: 56px; } .tc-num.sm { font-size: 40px; }
.tc-num .d { position: relative; display: inline-block; height: 1em; overflow: hidden; width: .56em; text-align: center;
  -webkit-mask-image: linear-gradient(transparent, #000 18%, #000 82%, transparent); mask-image: linear-gradient(transparent, #000 18%, #000 82%, transparent); }
.tc-num .d > span { position: absolute; left: 0; right: 0; top: 0; display: flex; flex-direction: column; transition: transform .55s cubic-bezier(.3,1.35,.5,1); }
.tc-num .d > span > b { height: 1em; font-weight: inherit; }
.tc-num .d, .tc-num .s { -webkit-user-select: none; user-select: none; }
.tc-copy { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.tc-num .s { display: inline-block; width: .3em; height: 1em; line-height: .9em; text-align: center; opacity: .9; }
.tc-num .u { align-self: flex-end; margin-left: .12em; font-size: .38em; letter-spacing: 0; opacity: .5; }
.tc-sub { text-align: center; color: var(--muted); font-size: 12px; }
.tc-ctrl { display: flex; justify-content: center; gap: 10px; margin-top: 12px; }
.tc-round { display: grid; place-items: center; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 50%; cursor: pointer; transition: transform .12s, background .2s, box-shadow .2s; }
.tc-round:active { transform: scale(.9); }
.tc-round.go { background: ${RED}; color: #f5f4f3; box-shadow: 0 6px 18px -6px ${RED}; }
.tc-round.go:hover { box-shadow: 0 8px 22px -6px ${RED}; }
.tc-round.ghost { background: var(--accent-soft); color: ${RED}; }
.tc-round.ghost:hover { background: var(--line2); }
.tc-round:disabled { opacity: .4; cursor: default; }
.tc-round svg { width: 16px; height: 16px; fill: currentColor; transition: opacity .1s, transform .1s, filter .1s; }
.tc-round svg.swap { opacity: 0; transform: scale(.5); filter: blur(4px); }
.tc-round .x { fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; width: 18px; height: 18px; }
.tc-bar { height: 3px; margin-top: 10px; border-radius: 3px; background: var(--accent-soft); overflow: hidden; }
.tc-bar i { display: block; height: 100%; width: 100%; background: ${RED}; transform-origin: left; transition: transform 1s linear; }
.tc.done .tc-num { color: ${RED}; animation: tc-pulse .9s ease-in-out 4; }
.tc.done .tc-bar i { background: var(--green, #22c55e); }
.tc.off { opacity: .5; filter: saturate(.3); transition: opacity .35s, filter .35s; }
.tc.paused .tc-num { opacity: .55; animation: tc-blink 1.6s ease-in-out infinite; }
@keyframes tc-pulse { 50% { transform: scale(1.07); } }
@keyframes tc-blink { 50% { opacity: .25; } }
.tc-list { display: grid; gap: 8px; margin-top: 8px; }
.tc-item { display: flex; align-items: center; gap: 12px; padding: 6px 4px 6px 10px; border-radius: 12px; background: var(--card); animation: tc-in .4s both; }
.tc-item .tc-num { margin: 0; font-size: 40px; justify-content: flex-start; }
.tc-item .meta { display: grid; gap: 2px; font-size: 12px; color: var(--muted); }
.tc-item .meta b { color: var(--text); font-weight: 600; }
.tc-sw { position: relative; flex: none; width: 40px; height: 24px; margin-left: auto; margin-right: 6px; border-radius: 999px; background: ${RED}; cursor: pointer; border: 0; transition: background .25s; }
.tc-sw::after { content: ''; position: absolute; top: 3px; left: 19px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: left .25s cubic-bezier(.3,1.4,.5,1); }
.tc-sw.no { background: var(--line2); } .tc-sw.no::after { left: 3px; }
.tc-clock { display: flex; align-items: center; gap: 14px; margin-top: 6px; }
.tc-clock svg { width: 78px; height: 78px; flex: none; }
.tc-clock .face { fill: var(--card); stroke: var(--line2); stroke-width: 1.5; }
.tc-clock .tick { stroke: var(--muted); stroke-width: 1.5; stroke-linecap: round; }
.tc-clock .hand { stroke: var(--text); stroke-linecap: round; transform-origin: 50px 50px; transition: transform .45s cubic-bezier(.4,2.2,.6,1); }
.tc-clock .sec { stroke: ${RED}; stroke-width: 1.2; }
.tc-clock .tc-num { margin: 0; justify-content: flex-start; }
.tc-coin { width: 96px; height: 96px; margin: 8px auto 2px; perspective: 500px; }
.tc-coin .c { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; animation: tc-flip 1.5s cubic-bezier(.2,.7,.2,1) both; }
.tc-coin .f { position: absolute; inset: 0; display: grid; place-items: center; border-radius: 50%; backface-visibility: hidden;
  font: 600 22px Bahnschrift, Impact, sans-serif; font-stretch: condensed; letter-spacing: 1px;
  background: radial-gradient(circle at 35% 30%, #ffd9a8, #f08c2a 60%, #b65a10); color: #5a2a05; box-shadow: inset 0 0 0 5px rgba(90,42,5,.22), 0 10px 24px -10px rgba(0,0,0,.5); }
.tc-coin .f.b { transform: rotateY(180deg); }
@keyframes tc-flip { from { transform: rotateY(0) translateY(0); } 45% { transform: rotateY(var(--spin-mid)) translateY(-26px); } to { transform: rotateY(var(--spin)); } }
.tc-dice { display: flex; justify-content: center; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
.tc-die { width: 52px; height: 52px; display: grid; grid-template: repeat(3, 1fr) / repeat(3, 1fr); padding: 8px; border-radius: 12px; background: #f5f4f3;
  box-shadow: inset 0 -3px 0 rgba(0,0,0,.12), 0 6px 14px -8px rgba(0,0,0,.5); animation: tc-roll .75s cubic-bezier(.3,1.4,.5,1) both; }
.tc-die i { width: 8px; height: 8px; margin: auto; border-radius: 50%; background: #1b1917; opacity: 0; }
.tc-die i.on { opacity: 1; } .tc-die.one i.on { background: ${RED}; width: 11px; height: 11px; }
@keyframes tc-roll { from { transform: rotate(-260deg) scale(.3) translateY(-30px); opacity: 0; } to { transform: none; opacity: 1; } }
.tc-eq { display: flex; align-items: flex-end; justify-content: center; gap: 4px; height: 44px; margin: 10px 0 4px; }
.tc-eq i { width: 6px; border-radius: 3px; background: ${RED}; animation: tc-eq 1s ease-in-out infinite; }
.tc-eq i:nth-child(2n) { animation-duration: .8s; } .tc-eq i:nth-child(3n) { animation-duration: 1.25s; }
.tc.off .tc-eq i { animation-play-state: paused; }
@keyframes tc-eq { 0%, 100% { height: 18%; } 50% { height: 100%; } }
.tc-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-align: center; font: 600 26px Bahnschrift, Impact, sans-serif; font-stretch: condensed; letter-spacing: .2px; text-transform: capitalize; }
.tc-notes { display: grid; gap: 6px; max-height: 230px; margin-top: 10px; overflow: auto; }
.tc-note { padding: 8px 10px; border-left: 3px solid var(--line2); border-radius: 8px; background: var(--card); font-size: 13px; animation: tc-in .35s both; }
.tc-note.new { border-left-color: ${RED}; }
.tc-note { display: flex; align-items: center; gap: 10px; transition: opacity .2s, transform .2s; }
.tc-note.gone { opacity: 0; transform: translateX(16px); }
.tc-note .tc-nb { flex: 1; min-width: 0; display: grid; gap: 1px; } .tc-note .tc-nb span { overflow-wrap: anywhere; }
.tc-note small { color: var(--muted); font-size: 11px; }
.tc-note.done .tc-nb span { text-decoration: line-through; opacity: .5; }
.tc-tick { flex: none; display: grid; place-items: center; width: 20px; height: 20px; padding: 0; border: 1.5px solid var(--muted); border-radius: 6px; background: none; color: transparent; cursor: pointer; transition: background .15s, border-color .15s; }
.tc-tick svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.tc-note.done .tc-tick { background: ${RED}; border-color: ${RED}; color: #fff; }
.tc-round.sm { width: 28px; height: 28px; opacity: .55; } .tc-round.sm:hover { opacity: 1; } .tc-round.sm .x { width: 14px; height: 14px; }
.tc-add { display: flex; gap: 8px; margin-top: 10px; }
.tc-add input { flex: 1; min-width: 0; padding: 9px 12px; border: 1px solid var(--line2); border-radius: 999px; background: var(--card); color: var(--text); font: 13px var(--ui); outline: none; }
.tc-add input:focus { border-color: ${RED}; }
.tc-warn { margin-top: 8px; padding: 7px 10px; border-radius: 10px; background: rgba(255,56,40,.1); color: ${RED}; font-size: 12px; font-weight: 600; text-align: center; }
.tc-btn { padding: 7px 14px; border: 0; border-radius: 999px; background: var(--accent-soft); color: var(--text); font: 600 12px var(--ui); cursor: pointer; transition: background .15s, transform .1s; }
.tc-btn:hover { background: var(--line2); } .tc-btn:active { transform: scale(.96); }
@media (prefers-reduced-motion: reduce) { .tc, .tc *, .tc-item, .tc-note { animation: none !important; transition: none !important; } }
`;
let styled = false;
export const style = () => { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = CSS; document.head.append(s); };
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; };
const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
const ICON = {
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/>',
  watch: '<circle cx="12" cy="13" r="8"/><path d="M12 13V9M10 2h4M19 5l-1.5 1.5"/>',
  alarm: '<circle cx="12" cy="13" r="7"/><path d="M12 10v3l2 1M4 4 2 6M20 4l2 2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M12 8v8"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h.01M15 15h.01M15 9h.01M9 15h.01"/>',
  note: '<path d="M5 4h10l4 4v12H5z"/><path d="M9 12h6M9 16h4"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
};
// the play / pause / × shapes, same as the reference design
const PLAY = '<path d="M0.9375 13.2422C1.25 13.2422 1.51562 13.1172 1.82812 12.9375L10.9375 7.67188C11.5859 7.28906 11.8125 7.03906 11.8125 6.625C11.8125 6.21094 11.5859 5.96094 10.9375 5.58594L1.82812 0.3125C1.51562 0.132812 1.25 0.015625 0.9375 0.015625C0.359375 0.015625 0 0.453125 0 1.13281V12.1172C0 12.7969 0.359375 13.2422 0.9375 13.2422Z"/>';
const PAUSE = '<path d="M1.03906 12.7266H2.82031C3.5 12.7266 3.85938 12.3672 3.85938 11.6797V1.03906C3.85938 0.328125 3.5 0 2.82031 0H1.03906C0.359375 0 0 0.359375 0 1.03906V11.6797C0 12.3672 0.359375 12.7266 1.03906 12.7266ZM6.71875 12.7266H8.49219C9.17969 12.7266 9.53125 12.3672 9.53125 11.6797V1.03906C9.53125 0.328125 9.17969 0 8.49219 0H6.71875C6.03125 0 5.67188 0.359375 5.67188 1.03906V11.6797C5.67188 12.3672 6.03125 12.7266 6.71875 12.7266Z"/>';

function shell(kind, title, badge) {
  style();
  const c = el('div', `tc k-${kind}`); // k-: never the same name as a part (.tc-coin is the coin itself)
  const h = el('div', 'tc-h');
  h.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[kind] || ICON.star}</svg>`;
  h.append(el('span', '', title));
  if (badge != null) h.append(el('span', 'tc-badge', badge));
  c.append(h);
  return c;
}

// ---- Rolling digits (Number Flow style): every digit is a 0-9 strip that slides to its value.
function roller(size = '', unit = '') {
  const box = el('div', `tc-num${size ? ` ${size}` : ''}`);
  box.setAttribute('role', 'timer');
  let cells = [], last = '';
  const unitEl = unit ? el('span', 'u', unit) : null;
  const copy = el('span', 'tc-copy');
  const build = (text) => {
    box.replaceChildren(copy); cells = []; // copy: the real value, so a copied chat says 23:10, not 0123456789
    for (const ch of text) {
      if (/\d/.test(ch)) {
        const d = el('span', 'd'), strip = el('span');
        d.setAttribute('aria-hidden', 'true'); // the box carries the real value as its label
        for (let i = 0; i <= 9; i++) strip.append(el('b', '', i));
        d.append(strip); box.append(d); cells.push(strip);
      } else { box.append(el('span', 's', ch)); cells.push(null); }
    }
    if (unitEl) box.append(unitEl);
  };
  const set = (v) => {
    const text = String(v);
    if (text === last) return;
    if (text.length !== last.length || text.replace(/\d/g, '0') !== last.replace(/\d/g, '0')) build(text);
    last = text;
    [...text].forEach((ch, i) => { if (cells[i]) cells[i].style.transform = `translateY(-${Number(ch)}em)`; });
    box.setAttribute('aria-label', text + (unit ? ` ${unit}` : '')); copy.textContent = text; // the unit is its own (copyable) span
  };
  return { node: box, set };
}
// count up to a number with the roll (random number, days until…)
// setTimeout, not requestAnimationFrame: rAF never runs while the window is in the background, and the number stayed empty
const countTo = (r, to, ms = 900) => { const t0 = performance.now(); const step = () => { const k = Math.min(1, (performance.now() - t0) / ms); r.set(Math.round(to * (1 - (1 - k) ** 3))); if (k < 1) setTimeout(step, 16); }; step(); };

const pad = (n) => String(Math.floor(n)).padStart(2, '0');
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(s / 3600); return h ? `${h}:${pad((s % 3600) / 60)}:${pad(s % 60)}` : `${pad(s / 60)}:${pad(s % 60)}`; };
const hm = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
const dayOf = (ms) => { const d = new Date(ms).toDateString(); return d === new Date().toDateString() ? 'Today' : d === new Date(Date.now() + 864e5).toDateString() ? 'Tomorrow' : new Date(ms).toLocaleDateString(); };
const call = (action, params) => window.api.fast(action, params, true);
// a live loop that stops by itself once the card has left the page
const live = (card, fn, ms = 250) => { fn(); const id = setInterval(() => { if (card.isConnected) card.dataset.mounted = '1'; else if (card.dataset.mounted) { clearInterval(id); return; } fn(); }, ms); return () => clearInterval(id); };

// the round red play/pause: the icon swaps with a quick blur + scale, like the reference
function playPause(paused, onClick) {
  const b = el('button', 'tc-round go'); b.type = 'button';
  const paint = (p) => { b.setAttribute('aria-label', p ? 'Resume' : 'Pause'); b.innerHTML = `<svg viewBox="${p ? '0 0 12 14' : '0 0 10 13'}" class="swap" aria-hidden="true">${p ? PLAY : PAUSE}</svg>`; setTimeout(() => b.firstChild?.classList.remove('swap'), 16); }; // setTimeout, not rAF: rAF never runs while the window is hidden
  paint(paused);
  b.onclick = async () => { b.disabled = true; const p = await onClick(); b.disabled = false; if (typeof p === 'boolean') paint(p); };
  return { node: b, paint };
}
// icon-only round buttons (lucide-style strokes); the label is the tooltip and what screen readers say
const IB = {
  prev: '<path d="M19 20 9 12l10-8z"/><path d="M5 19V5"/>',
  next: '<path d="m5 4 10 8-10 8z"/><path d="M19 5v14"/>',
  again: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M8 16H3v5"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  snooze: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
};
const ib = (icon, label, onClick, cls = 'ghost') => { const b = el('button', `tc-round ${cls}`); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.innerHTML = `<svg viewBox="0 0 24 24" class="x" aria-hidden="true">${IB[icon]}</svg>`; b.onclick = onClick; return b; };
const xButton = (label, onClick) => { const b = el('button', 'tc-round ghost'); b.type = 'button'; b.setAttribute('aria-label', label); b.innerHTML = '<svg viewBox="0 0 24 24" class="x" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'; b.onclick = onClick; return b; };

// ---- Timer: huge rolling mm:ss, a thin bar that empties, red pause/resume, × cancels.
function timerCard(d) {
  const items = d.items || [d];
  if (items.length > 1) { const box = el('div', 'tc-list'); if (d.warn) box.append(el('div', 'tc-warn', d.warn)); for (const t of items) box.append(timerCard(t)); return box; }
  const t = items[0];
  const card = shell('timer', t.label ? `${t.label} timer` : 'Timer', null);
  const num = roller();
  const sub = el('div', 'tc-sub', `rings at ${hm(t.ends)}`);
  const bar = el('div', 'tc-bar'), fill = el('i'); bar.append(fill);
  // The timer itself lives in main (one store for the chat, the floating card and typed commands); this card mirrors it.
  let st = { id: t.id, ends: t.ends, total: t.total, paused: !!t.paused, left: t.ends - Date.now(), gone: false };
  const tick = () => {
    const left = st.paused ? st.left : st.ends - Date.now();
    num.set(mmss(left));
    fill.style.transform = `scaleX(${Math.max(0, left) / (st.total * 1000)})`;
    if (!st.paused && !st.gone && left <= 0 && !card.classList.contains('done')) { card.classList.add('done'); sub.textContent = t.label ? `${t.label}: time's up` : "Time's up"; pp.node.disabled = x.disabled = true; active(card, null); }
  };
  const live1 = () => active(card, { type: 'timer', id: st.id, ends: st.ends, total: st.total, label: t.label });
  const show = () => { card.classList.toggle('paused', st.paused); sub.textContent = st.gone ? 'cancelled' : st.paused ? 'paused' : `rings at ${hm(st.ends)}`; pp.paint(st.paused); if (st.paused || st.gone) active(card, null); else live1(); };
  // the store says what happened to this timer (paused / resumed / cancelled somewhere else): follow it
  const apply = (item) => {
    if (card.classList.contains('done')) return;
    if (!item) { if (!st.gone && st.ends - Date.now() > 1500) { st.gone = true; stop(); card.classList.add('off'); pp.node.disabled = x.disabled = true; show(); } return; }
    st = { ...st, paused: !!item.paused, ends: item.ends, left: item.ends - Date.now(), total: item.total || st.total };
    show();
  };
  const pp = playPause(st.paused, async () => {
    if (card.classList.contains('done') || st.gone) return undefined;
    const r = await call('timer', { op: st.paused ? 'resume' : 'pause', ...(st.id ? { id: st.id } : {}) });
    if (r?.card) apply(r.card); // the card from the store has the exact time left
    return st.paused;
  });
  const x = xButton('Cancel timer', async () => { x.disabled = true; pp.node.disabled = true; await call('timer', { op: 'cancel', ...(st.id ? { id: st.id } : {}) }); apply(null); st.gone = true; show(); });
  const ctrl = el('div', 'tc-ctrl'); ctrl.append(pp.node, x);
  card.append(num.node, sub, bar, ctrl);
  if (d.warn) card.append(el('div', 'tc-warn', d.warn));
  if (d.also?.length) card.append(el('div', 'tc-sub', `Also: ${d.also.map((o) => `${o.label || 'timer'} (${o.paused ? 'paused' : hm(o.ends)})`).join(', ')}`));
  const stop = live(card, tick, 200);
  card._close = () => active(card, null); // card closed with ×: the timer goes on, but it no longer floats
  if (st.id) timerCards.set(card, { id: st.id, apply });
  show();
  return card;
}
// every timer card on the page, refreshed together when the store changes (main sends 'clock-changed')
const timerCards = new Map();
export async function syncTimers() {
  for (const [c] of timerCards) if (!c.isConnected && c.dataset.mounted) timerCards.delete(c);
  if (!timerCards.size) return;
  const r = await call('timer', { op: 'status' }).catch(() => null);
  const items = r?.card?.items || [];
  for (const [, v] of timerCards) v.apply(items.find((i) => i.id === v.id) || null);
}

// ---- Stopwatch: rolling mm:ss plus hundredths, red start/stop, × resets.
function stopwatchCard(d) {
  const card = shell('watch', 'Stopwatch', d.running ? 'running' : 'stopped');
  const num = roller('md');
  const cs = el('div', 'tc-sub');
  let st = { running: !!d.running, base: d.ms || 0, since: Date.now() };
  const paint = () => { const ms = st.base + (st.running ? Date.now() - st.since : 0); num.set(mmss(ms - 999 < 0 ? 0 : Math.floor(ms / 1000) * 1000)); cs.textContent = `.${pad((ms % 1000) / 10)}`; card.querySelector('.tc-badge').textContent = st.running ? 'running' : 'stopped'; };
  const set = (r, running) => { st = { running, base: r?.ms ?? st.base, since: Date.now() }; paint(); active(card, running ? { type: 'stopwatch' } : null); };
  // the real stopwatch lives in main: read it now (a card shown later, or in the floating window, is never stale)
  call('stopwatch', { op: 'status' }).then((r) => { if (r?.card) { set(r.card, r.card.running); pp.paint(!r.card.running); } }).catch(() => {});
  let pp = null;
  pp = playPause(!st.running, async () => { const r = await call('stopwatch', { op: st.running ? 'stop' : 'start' }); set(r.card, !st.running); return !st.running; });
  const x = xButton('Reset stopwatch', async () => { const r = await call('stopwatch', { op: 'reset' }); set(r.card, false); pp.paint(true); });
  const ctrl = el('div', 'tc-ctrl'); ctrl.append(pp.node, x);
  card.append(num.node, cs, ctrl);
  live(card, paint, 60);
  card._close = () => active(card, null);
  return card;
}

// ---- Alarms and reminders: big rolling HH:MM per alarm, day + note, a switch that turns alarms off.
function alarmsCard(d) {
  const items = (d.items || []).slice().sort((a, b) => a.at - b.at);
  const one = items.length === 1;
  const card = shell(one && items[0].kind === 'reminder' ? 'bell' : 'alarm', one ? (items[0].kind === 'reminder' ? 'Reminder' : 'Alarm') : 'Alarms & reminders', items.length > 1 ? items.length : null);
  if (!items.length) { card.append(el('div', 'tc-sub', 'Nothing set. Try "wake me up at 6".')); return card; }
  const box = el('div', 'tc-list');
  for (const it of items) {
    const row = el('div', 'tc-item');
    const n = roller(); n.set(hm(it.at));
    const meta = el('div', 'meta'); const when = el('span');
    meta.append(el('b', '', dayOf(it.at)), when);
    if (it.text && !/^(alarm|reminder)$/i.test(it.text)) meta.append(el('span', '', it.text));
    row.append(n.node, meta);
    if (it.kind !== 'reminder') {
      const sw = el('button', 'tc-sw'); sw.type = 'button'; sw.setAttribute('aria-label', 'Alarm on'); sw.setAttribute('role', 'switch'); sw.setAttribute('aria-checked', 'true');
      sw.onclick = async () => {
        const on = sw.classList.contains('no');
        // this alarm only: off = cancel it by id, on = set it again (and remember its new id)
        if (on) { const r = await call('alarm', { op: 'set', at: it.at > Date.now() ? it.at : it.at + 864e5, ...(it.text && it.text !== 'Alarm' ? { label: it.text } : {}) }); it.id = r?.card?.items?.find((x) => Math.abs(x.at - it.at) < 1000 || Math.abs(x.at - it.at - 864e5) < 1000)?.id || it.id; }
        else if (it.id) await call('alarm', { op: 'cancel', id: it.id });
        sw.classList.toggle('no', !on); sw.setAttribute('aria-checked', String(on)); row.style.opacity = on ? '' : '.5';
      };
      row.append(sw);
    }
    box.append(row);
    live(card, () => { const m = Math.max(0, it.at - Date.now()); when.textContent = m ? `in ${m >= 3600e3 ? `${Math.floor(m / 3600e3)}h ` : ''}${Math.ceil((m % 3600e3) / 60e3)}m` : 'now'; }, 15000);
  }
  card.append(box);
  if (d.warn) card.append(el('div', 'tc-warn', d.warn));
  if (d.also?.length) card.append(el('div', 'tc-sub', `Your other alarms: ${d.also.slice(0, 6).map((o) => `${hm(o.at)} ${dayOf(o.at).toLowerCase()}${o.text && !/^alarm$/i.test(o.text) ? ` (${o.text})` : ''}`).join(', ')}${d.also.length > 6 ? ` +${d.also.length - 6} more` : ''}`));
  return card;
}

// ---- World clock: analog face with live hands next to big rolling HH:MM, and the difference to here.
function clockCard(d) {
  const card = shell('globe', d.place || 'World clock');
  const face = sv('svg', { viewBox: '0 0 100 100' });
  face.append(sv('circle', { class: 'face', cx: 50, cy: 50, r: 46 }));
  for (let i = 0; i < 12; i++) { const a = (i * 30 * Math.PI) / 180; face.append(sv('line', { class: 'tick', x1: 50 + 38 * Math.sin(a), y1: 50 - 38 * Math.cos(a), x2: 50 + 42 * Math.sin(a), y2: 50 - 42 * Math.cos(a) })); }
  const hH = sv('line', { class: 'hand', x1: 50, y1: 50, x2: 50, y2: 27, 'stroke-width': 4 });
  const mH = sv('line', { class: 'hand', x1: 50, y1: 50, x2: 50, y2: 16, 'stroke-width': 2.5 });
  const sH = sv('line', { class: 'hand sec', x1: 50, y1: 56, x2: 50, y2: 12 });
  face.append(hH, mH, sH, sv('circle', { cx: 50, cy: 50, r: 2.5, fill: RED }));
  const num = roller('md');
  const right = el('div'); right.append(num.node, el('div', 'tc-sub', d.note || ''));
  right.lastChild.style.textAlign = 'left';
  const row = el('div', 'tc-clock'); row.append(face, right);
  card.append(row);
  live(card, () => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: d.zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    const h = Number(p.hour) % 12, m = Number(p.minute), s = Number(p.second);
    num.set(`${p.hour}:${p.minute}`);
    hH.style.transform = `rotate(${h * 30 + m / 2}deg)`; mH.style.transform = `rotate(${m * 6}deg)`; sH.style.transform = `rotate(${s * 6}deg)`;
  }, 1000);
  return card;
}

// ---- Coin: a 3D flip that lands on the real result, then the word in the big font.
function coinCard(d) {
  const card = shell('coin', 'Coin flip');
  const heads = d.side === 'heads';
  const wrap = el('div', 'tc-coin'), c = el('div', 'c');
  c.style.setProperty('--spin', `${heads ? 1800 : 1980}deg`); c.style.setProperty('--spin-mid', `${heads ? 900 : 990}deg`);
  c.append(el('div', 'f', 'HEADS'), el('div', 'f b', 'TAILS')); wrap.append(c);
  const word = el('div', 'tc-title', ' '); setTimeout(() => { word.textContent = heads ? 'Heads' : 'Tails'; }, 1400);
  const ctrl = el('div', 'tc-ctrl'); ctrl.append(ib('again', 'Flip again', async () => { const r = await call('quick', { op: 'coin' }); if (r.card) card.replaceWith(coinCard(r.card)); }));
  card.append(wrap, word, ctrl);
  return card;
}

// ---- Dice: real pips (the one is red), a tumble-in per die, the total rolls up.
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function diceCard(d) {
  const card = shell('dice', d.rolls.length > 1 ? `${d.rolls.length} dice` : 'Dice');
  const box = el('div', 'tc-dice');
  d.rolls.forEach((v, i) => { const die = el('div', `tc-die${v === 1 ? ' one' : ''}`); die.style.animationDelay = `${i * 90}ms`; for (let k = 0; k < 9; k++) die.append(el('i', PIPS[v].includes(k) ? 'on' : '')); box.append(die); });
  card.append(box);
  if (d.rolls.length > 1) { const n = roller('sm', 'total'); card.append(n.node); setTimeout(() => countTo(n, d.rolls.reduce((a, b) => a + b, 0), 500), 600); }
  const ctrl = el('div', 'tc-ctrl'); ctrl.append(ib('again', 'Roll again', async () => { const r = await call('quick', { op: 'dice', n: d.rolls.length }); if (r.card) card.replaceWith(diceCard(r.card)); }));
  card.append(ctrl);
  return card;
}

// ---- One big number that counts up (random number, days until…), or a big word.
function bigCard(d) {
  const card = shell(d.icon || 'star', d.title || '');
  const m = /^(-?\d+)(?:\s+(\D.*))?$/.exec(String(d.value)); // a whole number counts up; 1,234.5 or a word shows as it is
  if (m) { const n = roller('', m[2] || ''); card.append(n.node); countTo(n, Number(m[1])); } else card.append(el('div', 'tc-title', d.value));
  if (d.sub) card.append(el('div', 'tc-sub', d.sub));
  return card;
}

// ---- Notes (kept in Genisys): open ones first, the one just added marked red. Tick off, delete, or add one right here.
function notesCard(d) {
  const card = shell('note', d.title || 'Notes', '');
  const box = el('div', 'tc-notes');
  const when = (ts) => { const t = new Date(ts); return t.toDateString() === new Date().toDateString() ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : t.toLocaleDateString(); };
  const paint = (items, added) => {
    box.replaceChildren();
    card.querySelector('.tc-badge').textContent = `${items.filter((n) => !n.done).length} open`;
    items.forEach((n, i) => {
      const row = el('div', `tc-note${n.id === added ? ' new' : ''}${n.done ? ' done' : ''}`);
      row.style.animationDelay = `${i * 35}ms`;
      const tick = el('button', 'tc-tick'); tick.type = 'button'; tick.setAttribute('role', 'checkbox'); tick.setAttribute('aria-checked', String(n.done)); tick.setAttribute('aria-label', n.done ? 'Mark as not done' : 'Mark as done');
      tick.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${IB.check}</svg>`;
      tick.onclick = async () => { const r = await call('note', { op: n.done ? 'undo' : 'done', id: n.id }); if (r.card) paint(r.card.items); };
      const body = el('div', 'tc-nb'); body.append(el('span', '', n.text), el('small', '', when(n.ts)));
      const del = ib('trash', 'Delete note', async () => { row.classList.add('gone'); const r = await call('note', { op: 'delete', id: n.id }); setTimeout(() => r.card && paint(r.card.items), 200); });
      del.classList.add('sm');
      row.append(tick, body, del);
      box.append(row);
    });
    if (!items.length) box.append(el('div', 'tc-sub', d.list ? `Your ${d.list} list is empty. Add something below.` : 'No notes yet.'));
  };
  // add a note without leaving the card
  const form = el('form', 'tc-add');
  const inp = el('input'); inp.placeholder = 'Add a note…'; inp.setAttribute('aria-label', 'New note'); inp.maxLength = 500;
  form.append(inp, ib('plus', 'Add note', () => {}, 'go'));
  form.lastChild.type = 'submit';
  if (d.list) inp.placeholder = `Add to your ${d.list} list…`;
  form.onsubmit = async (e) => { e.preventDefault(); const t = inp.value.trim(); if (!t) return; inp.value = ''; const r = await call('note', { op: 'add', text: t, ...(d.list ? { list: d.list } : {}) }); if (r.card) paint(r.card.items, r.card.added); };
  card.append(box, form);
  paint(d.items || [], d.added);
  return card;
}

// ---- Music remote: what plays in Genisys's own player, shown elsewhere (the floating card) or another app's music.
// remote: the buttons drive the in-app player in the main window; otherwise the PC's media keys.
function musicCard(d) {
  const card = shell('music', 'Now playing', d.source || null);
  const eq = el('div', 'tc-eq'); for (let i = 0; i < 9; i++) { const b = el('i'); b.style.animationDelay = `${-i * 0.13}s`; eq.append(b); }
  const title = el('div', 'tc-title', d.title || 'Music'); if (d.remote) title.style.fontSize = '20px';
  card.append(eq, title, el('div', 'tc-sub', d.sub || ''));
  if (d.paused) card.classList.add('off');
  if (d.controls !== false) {
    // an app's own player (media action), Genisys's player (remote), else the PC's media keys
    const send = (cmd) => (d.mediaApp ? call('media', { op: { play_pause: 'toggle', next_track: 'next', previous_track: 'prev' }[cmd], ...(d.mediaApp === '_current' ? {} : { app: d.mediaApp }) }) : d.remote ? window.api.toolCmd?.(cmd) : call('pc', { do: cmd }));
    const ctrl = el('div', 'tc-ctrl');
    const prev = ib('prev', 'Previous song', () => send('previous_track'));
    const pp = playPause(!!d.paused, async () => { await send('play_pause'); return card.classList.toggle('off'); });
    const next = ib('next', 'Next song', () => send('next_track'));
    ctrl.append(prev, pp.node, next); card.append(ctrl);
  }
  return card;
}

// ---- Genisys's own music player: the user's songs play right here (HTML audio from the local media server).
let current = null; // the audio that is playing; a new player stops the old
function playerCard(d) {
  const card = shell('music', 'Now playing', `${d.tracks.length} songs`);
  const audio = new Audio(); audio.preload = 'auto';
  let i = 0;
  const eq = el('div', 'tc-eq'); for (let k = 0; k < 9; k++) { const b = el('i'); b.style.animationDelay = `${-k * 0.13}s`; eq.append(b); }
  const title = el('div', 'tc-title', ''), sub = el('div', 'tc-sub', '');
  const bar = el('div', 'tc-bar'), fill = el('i'); fill.style.transition = 'transform .25s linear'; fill.style.transform = 'scaleX(0)'; bar.append(fill); bar.style.cursor = 'pointer';
  bar.onclick = (e) => { if (audio.duration) audio.currentTime = ((e.clientX - bar.getBoundingClientRect().left) / bar.clientWidth) * audio.duration; };
  const time = el('div', 'tc-sub', '0:00 / 0:00');
  const fmt = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${pad(s % 60)}` : '0:00');
  const report = () => active(card, { type: 'music', remote: true, title: d.tracks[i]?.title || 'Music', sub: `${i + 1} of ${d.tracks.length} · Genisys`, paused: audio.paused });
  const load = (k) => { i = (k + d.tracks.length) % d.tracks.length; const t = d.tracks[i]; audio.src = t.url; title.textContent = t.title; sub.textContent = `${i + 1} of ${d.tracks.length}`; audio.play().catch(() => {}); };
  const pp = playPause(false, async () => { if (audio.paused) { if (current && current !== audio) current.pause(); current = audio; await audio.play().catch(() => {}); } else audio.pause(); return audio.paused; });
  audio.onplay = () => { card.classList.remove('off'); pp.paint(false); report(); };
  audio.onpause = () => { card.classList.add('off'); pp.paint(true); report(); };
  audio.ontimeupdate = () => { fill.style.transform = `scaleX(${audio.duration ? audio.currentTime / audio.duration : 0})`; time.textContent = `${fmt(audio.currentTime)} / ${fmt(audio.duration)}`; };
  audio.onended = () => load(i + 1);
  audio.addEventListener('next_track', () => load(i + 1));
  audio.addEventListener('previous_track', () => load(audio.currentTime > 3 ? i : i - 1));
  audio.addEventListener('close_player', () => { audio.pause(); audio.removeAttribute('src'); active(card, null); if (current === audio) current = null; });
  audio.onerror = () => { if (!audio.getAttribute('src')) return; sub.textContent = `can't play ${d.tracks[i].title}, skipping`; setTimeout(() => load(i + 1), 800); };
  const prev = ib('prev', 'Previous song', () => load(audio.currentTime > 3 ? i : i - 1));
  const next = ib('next', 'Next song', () => load(i + 1));
  const ctrl = el('div', 'tc-ctrl'); ctrl.append(prev, pp.node, next);
  title.style.fontSize = '20px'; card.append(eq, title, sub, bar, time, ctrl);
  card._close = () => audio.dispatchEvent(new CustomEvent('close_player'));
  if (current) current.pause();
  current = audio;
  load(0);
  // New chat (the card leaves the page): the music stops
  const watch = setInterval(() => { if (card.isConnected) card.dataset.mounted = '1'; else if (card.dataset.mounted) { card._close(); clearInterval(watch); } }, 1500);
  return card;
}
// pause / next / previous ("pause the music", the floating card's buttons) reach the in-app player first
export function playerControl(cmd, want) { // want: 'play' / 'pause' = only that (never toggles the wrong way), else toggle
  if (!current) return false;
  if (cmd === 'play_pause') { if (want === 'play' ? current.paused : want === 'pause' ? !current.paused : true) { if (current.paused) current.play().catch(() => {}); else current.pause(); } return true; }
  if (cmd === 'stop_media') { current.pause(); return true; }
  if (cmd === 'next_track' || cmd === 'previous_track') { current.dispatchEvent(new CustomEvent(cmd)); return true; }
  return false;
}

// voice: the in-app music drops to 20% while Genisys listens or speaks, then comes back
let ducked = null;
export function duck(on) {
  if (on && current && ducked == null) { ducked = current.volume; current.volume = ducked * 0.2; }
  else if (!on && ducked != null) { if (current) current.volume = ducked; ducked = null; }
}

// ---- Ringing: a timer or alarm went off. ONE ringer for the whole window: Stop (or closing the card) silences all.
let ctx = null;
const rings = new Set(); // stop functions of the tones that are sounding
function tone(stopAfter = 60000) {
  ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
  const master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination); // stop = cut this, even beeps already scheduled
  let alive = true, timer = 0;
  const beep = (t, f) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18); o.connect(g).connect(master); o.start(t); o.stop(t + 0.2); };
  const burst = () => { if (!alive) return; const t = ctx.currentTime + 0.05; [0, 0.22, 0.44, 0.66].forEach((dt, k) => beep(t + dt, k % 2 ? 1320 : 990)); timer = setTimeout(burst, 1500); };
  const stop = () => { alive = false; clearTimeout(timer); clearTimeout(end); try { master.gain.value = 0; master.disconnect(); } catch {} rings.delete(stop); };
  const end = setTimeout(stop, stopAfter);
  ctx.resume?.(); burst();
  rings.add(stop);
  return stop;
}
// silence every ringing tone and close every ringing card in this window
export function stopRings() {
  for (const s of [...rings]) s();
  for (const c of document.querySelectorAll('.tc.ringing')) { c.classList.remove('done', 'ringing'); c.classList.add('off'); c.querySelector('.tc-ctrl')?.remove(); }
}
export function ringCard(r, { onSnooze } = {}) {
  const kind = r.kind === 'alarm' ? 'alarm' : r.kind === 'timer' ? 'timer' : 'bell';
  const card = shell(kind, r.kind === 'alarm' ? 'Alarm' : r.kind === 'timer' ? "Time's up" : 'Reminder');
  card.classList.add('done', 'ringing');
  const n = roller(); n.set(hm(Date.now()));
  card.append(n.node, el('div', 'tc-sub', r.text || ''));
  if (r.kind !== 'reminder') tone();
  const ctrl = el('div', 'tc-ctrl');
  const s = ib('stop', 'Stop', () => stopRings(), 'go');
  ctrl.append(s);
  if (r.kind === 'alarm' && onSnooze) { const z = ib('snooze', 'Snooze 9 minutes', () => { stopRings(); onSnooze(); card.append(el('div', 'tc-sub', 'snoozed for 9 minutes')); }); ctrl.append(z); }
  card.append(ctrl);
  card._close = () => stopRings();
  return wrap(card, ringOpts);
}
let ringOpts = {};
export const setRingOptions = (o) => { ringOpts = o || {}; };

// ---- What is "live" right now (a running timer / stopwatch, music playing): the host shows it in the floating
// card when the user leaves the app. One hook, set by the host window.
let activeHook = null, activeCard = null;
export const onActive = (fn) => { activeHook = fn; };
function active(card, data) {
  if (data) activeCard = card; else if (activeCard !== card) return; // an old card going quiet never clears a newer one
  if (!data) activeCard = null;
  try { activeHook?.(data); } catch {}
}

// ---- Hover buttons: two small round icon buttons floating above the card's top-right corner, detached from it.
const HOV = {
  open: '<path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  close: '<path d="M7 7l10 10M17 7 7 17"/>',
};
function wrap(card, { onOpen, onClose, openLabel = 'Open Genisys' } = {}) {
  const w = el('div', 'tcw');
  const bar = el('div', 'tc-hov');
  const mk = (ic, label, fn) => { const b = el('button', 'tc-hb'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${HOV[ic]}</svg>`; b.onclick = (e) => { e.stopPropagation(); fn(); }; return b; };
  if (onOpen) bar.append(mk('open', openLabel, () => onOpen(card)));
  bar.append(mk('close', 'Close', () => { card._close?.(); if (onClose) onClose(card); else { w.classList.add('gone'); setTimeout(() => w.remove(), 260); } }));
  w.append(bar, card);
  return w;
}

// ---- Weather: the temperature big (rolling), what it is like, today's high / low and the chance of rain.
function weatherCard(d) {
  const card = shell('globe', d.place || 'Weather', d.label || null);
  const n = roller('', '°C'); n.set(String(d.temp));
  card.append(n.node, el('div', 'tc-title', d.desc || ''));
  const bits = [d.lo != null && d.hi != null ? `${d.lo}° – ${d.hi}°` : '', d.feels != null ? `feels like ${d.feels}°` : '', d.rain ? `${d.rain}% rain` : ''].filter(Boolean);
  card.append(el('div', 'tc-sub', bits.join(' · ')));
  if (d.tip) { const t = el('div', 'tc-sub', d.tip); t.style.fontWeight = '600'; card.append(t); } // "Yes, take an umbrella."
  if (d.next) card.append(el('div', 'tc-sub', d.next));
  return card;
}
// ---- Calendar: one month (Monday first), today in red, a dot on days with an alarm / reminder; arrows change month
function calendarCard(d) {
  const card = shell('alarm', 'Calendar', (d.items || []).length ? `${d.items.length} coming up` : null);
  const items = d.items || [];
  let y = Number(d.year), mo = Number(d.month);
  const nav = el('div', 'tc-calnav'), title = el('b'), grid = el('div', 'tc-cal'), list = el('div', 'tc-sub');
  const arrow = (dir, label) => { const b = el('button', 'tc-btn', dir < 0 ? '‹' : '›'); b.type = 'button'; b.setAttribute('aria-label', label); b.onclick = () => { mo += dir; if (mo < 0) { mo = 11; y--; } if (mo > 11) { mo = 0; y++; } draw(); }; return b; };
  nav.append(title, arrow(-1, 'Previous month'), arrow(1, 'Next month'));
  const key = (t) => new Date(t).toDateString();
  const marks = new Set(items.map((it) => key(it.at)));
  function draw() {
    title.textContent = new Date(y, mo, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    grid.textContent = '';
    for (const w of ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']) grid.append(el('div', 'tc-cw', w));
    const first = new Date(y, mo, 1), start = new Date(y, mo, 1 - ((first.getDay() + 6) % 7));
    for (let i = 0; i < 42; i++) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      if (i % 7 === 0 && i >= 28 && day.getMonth() !== mo) break; // whole weeks only: stop before a week that is all next month
      const c = el('div', 'tc-cd', String(day.getDate()));
      if (day.getMonth() !== mo) c.classList.add('out');
      if (key(day) === new Date().toDateString()) c.classList.add('today');
      if (marks.has(key(day))) { c.classList.add('has'); c.title = items.filter((it) => key(it.at) === key(day)).map((it) => `${hm(it.at)} ${it.text || it.kind}`).join('\n'); }
      grid.append(c);
    }
  }
  draw();
  list.textContent = items.length ? items.slice(0, 4).map((it) => `${new Date(it.at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })} ${hm(it.at)} · ${it.text && !/^(alarm|reminder)$/i.test(it.text) ? it.text : it.kind}`).join('\n') : 'Nothing scheduled. Try "remind me tomorrow at 9 to call mom".';
  list.style.cssText = 'white-space:pre-line;text-align:left;line-height:1.9;flex:1 1 180px;margin-top:58px';
  const month = el('div'); month.style.cssText = 'flex:0 1 420px;min-width:0';
  const row = el('div'); row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px 32px;align-items:flex-start';
  month.append(nav, grid); row.append(month, list); card.append(row);
  return card;
}
// ---- Briefing: a greeting, then one line per part of the day (only the parts that have something)
function briefCard(d) {
  const card = shell('star', d.title || 'Your day');
  const box = el('div', 'tc-notes');
  d.lines.forEach((l, i) => { const r = el('div', 'tc-note', l); r.style.animationDelay = `${i * 60}ms`; box.append(r); });
  card.append(box);
  return card;
}
// ---- Grid: several tools in one answer, as small cards side by side (they wrap on a narrow window)
function gridCard(d) {
  style();
  const g = el('div', 'tc-grid');
  for (const c of d.cards || []) { const make = KINDS[c?.type]; if (!make) continue; try { const n = make(c); n.classList?.add('tc-small'); g.append(n); } catch {} }
  return g;
}
const KINDS = { calendar: calendarCard, grid: gridCard, brief: briefCard, weather: weatherCard, player: playerCard, timer: timerCard, stopwatch: stopwatchCard, alarms: alarmsCard, clock: clockCard, coin: coinCard, dice: diceCard, big: bigCard, notes: notesCard, music: musicCard };
// card data from an action -> a DOM node (the card inside its hover wrapper), or null when this kind has no card.
// opts: { onOpen(card), onClose(card), openLabel } for the two hover buttons.
export function toolCardFor(card, opts = {}) {
  const make = KINDS[card?.type];
  if (!make) return null;
  try { return wrap(make(card), opts); } catch { return null; }
}
