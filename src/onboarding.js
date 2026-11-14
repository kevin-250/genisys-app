// First-run setup, shown once over the main window: account (email) → name → theme → settings → done.
// Answers are saved locally and the account is created on the website backend (cloud.js in the main process).
import './onboarding.css';
import logoUrl from '../assets/icon.svg';

const THEMES = [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']];
const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const sysDark = matchMedia('(prefers-color-scheme: dark)');
const applyTheme = (t) => {
  try { localStorage.setItem('theme', t); } catch {}
  document.documentElement.dataset.theme = t === 'system' ? (sysDark.matches ? 'dark' : 'light') : t;
};

export function startOnboarding() {
  const d = { email: '', name: '', theme: 'light', sendErrors: true, shareChats: false, autostart: true, sent: true };
  let step = 0, busy = false;

  const root = document.createElement('div');
  root.className = 'ob';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'ob-title');
  root.innerHTML = `
    <div class="ob-drag">
      <span class="ob-ctl">
        <button type="button" data-w="min" aria-label="Minimize"><svg viewBox="0 0 10 10"><path d="M1.5 5h7"/></svg></button>
        <button type="button" data-w="close" aria-label="Close"><svg viewBox="0 0 10 10"><path d="m2 2 6 6m0-6-6 6"/></svg></button>
      </span>
    </div>
    <div class="ob-card">
      <div class="ob-progress" aria-hidden="true">${'<i></i>'.repeat(4)}</div>
      <div class="ob-stage"></div>
      <div class="ob-foot">
        <button type="button" class="ob-btn ob-back">Back</button>
        <span class="ob-count" aria-live="polite"></span>
        <button type="button" class="ob-btn ob-next">Next</button>
      </div>
    </div>`;
  document.body.append(root);
  const $ = (s) => root.querySelector(s);
  const stage = $('.ob-stage'), back = $('.ob-back'), next = $('.ob-next');
  root.querySelectorAll('[data-w]').forEach((b) => { b.onclick = () => window.api.win(b.dataset.w); });

  const head = (kicker, title, sub) => `${kicker ? `<p class="ob-kicker">${kicker}</p>` : ''}<h1 id="ob-title">${title}</h1><p class="ob-sub">${sub}</p>`;

  const STEPS = [
    { // 1 · account
      html: () => `<img class="ob-logo" src="${logoUrl}" alt="" />${head('Welcome to Genisys', 'Create your account', 'Just your email. No password, no spam. It lets me count who uses Genisys and reply when you send a report. Basic PC specs (Windows version, CPU, RAM) are shared too, so it runs well on your PC.')}
        <label class="ob-label" for="ob-email">Email</label>
        <input id="ob-email" class="ob-input" type="email" autocomplete="email" placeholder="you@example.com" value="${esc(d.email)}" />
        <p class="ob-err" id="ob-email-err" hidden>That doesn't look like an email address yet.</p>`,
      bind: () => { const i = $('#ob-email'); i.oninput = () => { d.email = i.value; $('#ob-email-err').hidden = true; sync(); }; return i; },
      valid: () => emailOk(d.email),
      invalid: () => { $('#ob-email-err').hidden = false; $('#ob-email').focus(); },
    },
    { // 2 · name
      html: () => `${head('', 'What should Genisys call you?', 'It uses your name when it talks to you. You can skip this.')}
        <label class="ob-label" for="ob-name">Your name</label>
        <input id="ob-name" class="ob-input" type="text" autocomplete="given-name" maxlength="60" placeholder="e.g. Kevin" value="${esc(d.name)}" />`,
      bind: () => { const i = $('#ob-name'); i.oninput = () => { d.name = i.value; sync(); }; return i; },
      label: () => (d.name.trim() ? 'Next' : 'Skip'),
    },
    { // 3 · theme
      html: () => `${head('', 'Pick your look', 'You can switch any time with ◐ in the title bar.')}
        <div class="ob-themes" role="radiogroup" aria-label="Theme">${THEMES.map(([v, l]) => `
          <button type="button" role="radio" class="ob-theme t-${v}" data-v="${v}" aria-checked="${d.theme === v}">
            <span class="ob-prev" aria-hidden="true"><i></i><b></b><b></b><b></b></span><span>${l}${v === 'light' ? ' <small>default</small>' : ''}</span>
          </button>`).join('')}</div>`,
      bind: () => {
        const opts = [...root.querySelectorAll('.ob-theme')];
        const pick = (v) => { d.theme = v; applyTheme(v); opts.forEach((o) => o.setAttribute('aria-checked', o.dataset.v === v)); };
        opts.forEach((o, k) => {
          o.onclick = () => pick(o.dataset.v);
          o.onkeydown = (e) => { // arrow keys move through the radio group
            const m = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
            if (m) { e.preventDefault(); const n = opts[(k + m + opts.length) % opts.length]; pick(n.dataset.v); n.focus(); }
          };
        });
        return opts.find((o) => o.dataset.v === d.theme);
      },
    },
    { // 4 · settings
      html: () => `${head('', 'Quick settings', 'Change them later in Settings.')}
        ${[['sendErrors', 'Send error reports', 'When something breaks, send the error message and app version so it gets fixed. Your user folder and name are removed first.'],
           ['shareChats', 'Share conversations', 'Send what you ask and what Genisys answers so it learns what to get better at. No files or passwords; your folder and name are removed.'],
           ['autostart', 'Start with Windows', 'Genisys waits quietly in the background, so Alt+Space works right after you sign in.']].map(([k, t, s]) => `
          <div class="ob-switch-row">
            <span><b id="ob-l-${k}">${t}</b><small>${s}</small></span>
            <button type="button" role="switch" class="ob-switch" data-k="${k}" aria-checked="${d[k]}" aria-labelledby="ob-l-${k}"><i></i></button>
          </div>`).join('')}`,
      bind: () => {
        const sw = [...root.querySelectorAll('.ob-switch')];
        sw.forEach((s) => { s.onclick = () => { d[s.dataset.k] = !d[s.dataset.k]; s.setAttribute('aria-checked', d[s.dataset.k]); }; });
        return sw[0];
      },
      label: () => 'Finish',
      finish: async () => {
        const name = d.name.trim();
        const r = await window.api.cloud('register', { email: d.email, name, theme: d.theme, sendErrors: d.sendErrors, shareChats: d.shareChats }).catch(() => ({ sent: false }));
        d.sent = r.sent;
        await window.api.autostart(d.autostart).catch(() => {});
        if (name) await window.api.db('addProfile', 'fact', `My name is ${name}`).catch(() => {});
      },
    },
    { // done
      html: () => `<img class="ob-logo big" src="${logoUrl}" alt="" />${head('', `You're all set${d.name.trim() ? `, ${esc(d.name.trim())}` : ''}!`, 'Type what you want and Genisys does it. A few keys worth knowing:')}
        <ul class="ob-keys">
          <li><span><kbd>Alt</kbd><kbd>Space</kbd></span>Command bar over any app</li>
          <li><span><kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>N</kbd></span>New agent window</li>
          <li><span><kbd>/</kbd></span>Actions like /agent 3 and /browser</li>
          <li><span><kbd>F1</kbd></span>All shortcuts and help</li>
        </ul>
        ${d.sent ? '' : '<p class="ob-note">You seem to be offline, so your account will be created the next time Genisys starts with internet.</p>'}`,
      bind: () => next,
      label: () => 'Start using Genisys',
    },
  ];
  const DONE = STEPS.length - 1;

  function sync() {
    const s = STEPS[step];
    next.textContent = busy ? 'Saving…' : s.label?.() ?? 'Next';
    next.disabled = busy;
    next.classList.toggle('dim', !!s.valid && !s.valid());
    back.style.visibility = step === 0 || step === DONE || busy ? 'hidden' : 'visible';
    $('.ob-count').textContent = step === DONE ? '' : `Step ${step + 1} of ${DONE}`;
    root.querySelectorAll('.ob-progress i').forEach((b, k) => b.classList.toggle('on', k <= step));
  }

  function show(to, dir) {
    step = to;
    stage.className = `ob-stage ${dir > 0 ? 'in-next' : 'in-back'}`;
    stage.innerHTML = STEPS[step].html();
    void stage.offsetWidth; // restart the slide-in animation
    const first = STEPS[step].bind();
    sync();
    first?.focus();
  }

  async function goNext() {
    const s = STEPS[step];
    if (busy) return;
    if (s.valid && !s.valid()) { s.invalid?.(); return; }
    if (step === DONE) { // close the setup and hand over to the app
      root.classList.add('out');
      setTimeout(() => { root.remove(); document.getElementById('input')?.focus(); }, 300);
      return;
    }
    if (s.finish) { busy = true; sync(); await s.finish(); busy = false; }
    show(step + 1, 1);
  }

  next.onclick = goNext;
  back.onclick = () => { if (step > 0 && !busy) show(step - 1, -1); };
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); goNext(); }
    if (e.key === 'Tab') { // keep focus inside the setup
      const f = [...root.querySelectorAll('button, input')].filter((x) => !x.disabled && x.offsetParent !== null && getComputedStyle(x).visibility !== 'hidden');
      const [a, z] = [f[0], f[f.length - 1]];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
  });
  applyTheme(d.theme);
  show(0, 1);
}
