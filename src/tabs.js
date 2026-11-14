// Main-window tabs: Memory · About you · Notes · Settings. Everything is read from / written to the app DB.
import { batName } from './memory.js';
import { PRESETS, getAccent, setAccent } from './accent.js';
import { ANIM, setAnim } from './anim.js';
const $ = (s) => document.getElementById(s);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const btn = (text, onclick, cls = 'btn') => { const b = el('button', cls, text); b.onclick = onclick; return b; };
const ago = (ts) => {
  const s = (Date.now() - ts) / 1000;
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
};
const section = (legend, ...kids) => {
  const b = el('div', 'box');
  b.append(el('span', 'legend', legend), ...kids);
  return b;
};

async function memoryTab(root) {
  const st = await window.api.db('todayStats');
  const rows = await window.api.db('listMemory');
  const list = el('div', 'tbl');
  list.append(Object.assign(el('div', 'tr th'), { innerHTML: '<span>task</span><span>command</span><span>uses</span><span>last used</span><span></span>' }));
  for (const m of rows) {
    const tr = el('div', `tr${m.ok > 0 ? '' : ' broken'}`);
    const cmd = el('textarea', 'edit');
    cmd.value = m.cmds.join('\n');
    cmd.rows = Math.min(4, m.cmds.length);
    const name = el('div', 'name', m.task);
    name.append(el('small', '', `${m.ok > 0 ? 'works' : 'broken · will not be reused'} · ${batName(m)}`));
    const act = el('span', 'act');
    act.append(
      btn('save', async () => { await window.api.db('updateMemory', m.id, cmd.value.split('\n').map((s) => s.trim()).filter(Boolean)); render('memory'); }),
      btn('✕', async () => { await window.api.db('deleteMemory', m.id); render('memory'); }, 'btn x'),
    );
    tr.append(name, cmd, el('span', 'num', `${m.uses}`), el('span', 'muted', ago(m.last_used)), act);
    list.append(tr);
  }
  if (!rows.length) list.append(el('div', 'empty', 'Nothing yet. Every task that fully works gets remembered here and reused when the AI is offline.'));
  const stats = el('div', 'stats');
  stats.innerHTML = `<span>today</span> <b>${st.tasks}</b> tasks · <b>${st.steps}</b> steps · <b class="ok">${st.ok}</b> worked`;
  const folder = btn('open bats folder', () => window.api.openBats());
  stats.append(folder);
  root.append(stats, section(`command memory · ${rows.length}`, list));
}

async function aboutTab(root) {
  const items = await window.api.db('listProfile');
  const P = { learning: true, ...(await window.api.db('getSetting', 'prefs', {})) };
  const head = el('div', 'stats');
  const lt = el('label', 'check');
  const cb = Object.assign(el('input'), { type: 'checkbox', checked: P.learning });
  cb.onchange = async () => { await window.api.db('setSetting', 'prefs', { ...(await window.api.db('getSetting', 'prefs', {})), learning: cb.checked }); };
  lt.append(cb, ' learn about me from my tasks');
  head.append(lt);
  root.append(head);

  const add = el('form', 'addrow');
  const kind = el('select');
  for (const k of ['interest', 'trait', 'fact']) kind.append(Object.assign(el('option', '', k), { value: k }));
  const txt = Object.assign(el('input', 'field'), { placeholder: 'add something about you, e.g. "I edit videos in CapCut"' });
  add.append(kind, txt, btn('add', null));
  add.onsubmit = async (e) => { e.preventDefault(); if (txt.value.trim()) { await window.api.db('addProfile', kind.value, txt.value); render('about'); } };
  root.append(add);

  for (const k of ['interest', 'trait', 'fact']) {
    const group = items.filter((p) => p.kind === k);
    const ul = el('div', 'items');
    for (const p of group) {
      const row = el('div', 'item');
      const inp = Object.assign(el('input', 'field'), { value: p.text });
      inp.onchange = () => window.api.db('updateProfile', p.id, p.kind, inp.value);
      row.append(el('span', 'dot'), inp, btn('✕', async () => { await window.api.db('deleteProfile', p.id); render('about'); }, 'btn x'));
      ul.append(row);
    }
    if (!group.length) ul.append(el('div', 'empty', 'nothing learned yet'));
    root.append(section(`${k === 'interest' ? 'interests' : k === 'trait' ? 'personality' : 'facts'} · ${group.length}`, ul));
  }
}

async function notesTab(root) {
  const notes = (await window.api.db('listNotes')).filter((n) => n.kind !== 'code'); // old developer-only notes
  const list = el('div', 'items');
  for (const n of notes) {
    const row = el('div', `item note${n.seen ? '' : ' unseen'}`);
    const b = el('span', `badge ${n.kind === 'problem' ? 'b-err' : n.kind === 'idea' ? 'b-wait' : n.kind === 'model' ? 'b-done' : 'b-run'}`, n.kind);
    const t = el('span', 'ntext', n.text);
    row.append(b, t, el('span', 'muted', ago(n.ts)), btn('✕', async () => { await window.api.db('deleteNote', n.id); render('notes'); }, 'btn x'));
    list.append(row);
  }
  if (!notes.length) list.append(el('div', 'empty', 'No notes. New versions, problems, new free models and ideas show up here.'));
  const bar = el('div', 'stats');
  const upd = el('span', 'muted');
  const install = btn('Download and install', async () => {
    install.disabled = true; install.textContent = 'downloading…';
    upd.textContent = 'Genisys will close, update and open again by itself.';
    try { await window.api.installUpdate(); } catch { install.disabled = false; install.textContent = 'Download and install'; upd.textContent = "Couldn't download the update. Check your internet and try again."; }
  });
  install.hidden = true;
  bar.append(btn('Check for updates', async (e) => {
    e.target.disabled = true; e.target.textContent = 'checking…'; upd.textContent = ''; install.hidden = true;
    try {
      const r = await window.api.checkUpdates();
      if (r.dev) upd.textContent = 'Updates work in the installed app.';
      else if (r.newer) { upd.textContent = `Version ${r.latest} is available (you have ${r.current}).`; install.hidden = false; }
      else upd.textContent = `You have the latest version (${r.current}).`;
    } catch { upd.textContent = "Couldn't reach the update server. Check your internet and try again."; }
    e.target.disabled = false; e.target.textContent = 'Check for updates';
  }), upd, install);
  root.append(bar, section(`notes · ${notes.length}`, list));
  await window.api.db('markNotesSeen');
  refreshCount();
}

async function settingsTab(root) {
  const P = { personality: 'chill', custom: '', emoji: true, learning: true, deep: false, maxSteps: 20, ...(await window.api.db('getSetting', 'prefs', {})) };
  const cfg = await window.api.config();
  const models = cfg.models;
  const autostart = await window.api.db('getSetting', 'autostart', true);
  const f = el('form', 'settings');
  f.innerHTML = `
    <section class="sg"><h3>Model</h3>
      <p class="desc">Tried top to bottom; the next one takes over when the first is busy. ${cfg.keyCount} API key${cfg.keyCount === 1 ? '' : 's'}, managed in <b>Keys</b>. Active now: <b>${cfg.model.replace(/:free$/, '')}</b>.</p>
      <textarea name="models" hidden></textarea>
      <div class="pick"></div>
    </section>
    <section class="sg"><h3>Personality and tone</h3>
      <div class="srow"><div><b>Base style and tone</b><span>How Genisys talks to you. It never changes what it can do.</span></div>
        <select name="personality"><option value="chill">Chill</option><option value="genz">Gen Z</option><option value="pro">Professional</option></select></div>
      <div class="srow"><div><b>Emojis</b><span>Let replies use emojis.</span></div><label class="tg"><input type="checkbox" name="emoji"><i></i></label></div>
      <div class="srow col"><div><b>Your own instructions</b><span>Optional, applied to every reply.</span></div>
        <textarea name="custom" class="edit" rows="2" placeholder='e.g. "call me Kev, explain like I am 15"'></textarea></div>
    </section>
    <section class="sg"><h3>Characteristics</h3>
      <div class="slider"><div class="sl-h"><b>Effort per task</b><span class="sl-v"></span></div>
        <input type="range" name="maxSteps" min="3" max="50" step="1">
        <div class="sl-l"><span>Less</span><span>Default</span><span>More</span></div></div>
      <div class="srow"><div><b>Think harder</b><span>Slower, but smarter on tricky tasks.</span></div><label class="tg"><input type="checkbox" name="deep"><i></i></label></div>
    </section>
    <section class="sg"><h3>Animations</h3>
      <p class="desc">Choose which effects you see. Changes apply right away, except the orb and globe, which apply to the next window or task.</p>
      <div class="srow"><div><b>Answer focus effect</b><span>Words appear one by one and come into focus (shadcn text-generate effect).</span></div>
        <select data-anim="focus"><option value="special">Special occasions</option><option value="always">Every answer</option><option value="off">Never</option></select></div>
      <div class="srow"><div><b>Underline key words</b><span>Underline the important words after the effect plays.</span></div><label class="tg"><input type="checkbox" data-anim="underline"><i></i></label></div>
      <div class="srow"><div><b>Moving dot background</b><span>Dots that drift and fade behind the window.</span></div><label class="tg"><input type="checkbox" data-anim="dots"><i></i></label></div>
      <div class="srow"><div><b>Live orb</b><span>The orb on the welcome screen and next to "working".</span></div><label class="tg"><input type="checkbox" data-anim="orb"><i></i></label></div>
      <div class="srow"><div><b>Globe while searching the web</b><span>Off shows a simple text spinner instead.</span></div><label class="tg"><input type="checkbox" data-anim="globe"><i></i></label></div>
    </section>
    <section class="sg"><h3>Accent color</h3>
      <p class="desc">Applies to every window right away.</p>
      <div class="swatches"></div>
    </section>
    <section class="sg"><h3>Speed</h3>
      <p class="desc">Fast mode understands simple commands (open, search, play) in code and runs them in under a second with no AI. It remembers what worked, asks one short AI question only when needed, and falls back to the original flow if it is unsure. Off = the original flow. Start a command with ! to force the full AI.</p>
      <div class="srow"><div><b>Fast mode</b><span>Applies to the next command in every window.</span></div><label class="tg"><input type="checkbox" name="speed"><i></i></label></div>
      <div class="srow"><div><b>Command cache</b><span id="cache-note">…</span></div><button type="button" class="btn" id="cache-clear">Clear</button></div>
      <div class="srow"><div><b>File index</b><span id="index-note">…</span></div><span><button type="button" class="btn" id="index-rescan">Rescan</button> <button type="button" class="btn" id="paths-open">My paths</button></span></div>
      <div id="scripts-good"></div>
      <pre class="desc" id="speed-stats" style="white-space:pre-wrap;font-size:12px;max-height:280px;overflow:auto;margin-top:10px"></pre>
    </section>
    <section class="sg"><h3>App</h3>
      <div class="srow"><div><b>Version</b><span>Genisys ${cfg.version}. New versions and what changed show up in Notes.</span></div></div>
      <div class="srow"><div><b>Start with Windows</b><span>Opens Genisys quietly when you sign in. <em id="as-note"></em></span></div><label class="tg"><input type="checkbox" name="autostart"><i></i></label></div>
      <div class="srow"><div><b>Automatic updates</b><span>Genisys checks every few minutes, downloads new versions by itself and installs them while you are not using it.</span></div><label class="tg"><input type="checkbox" name="autoUpdate"><i></i></label></div>
      <div class="srow"><div><b>Send error reports</b><span>When something breaks, the error message and app version go to the developer. Your user folder and name are removed first.</span></div><label class="tg"><input type="checkbox" name="sendErrors"><i></i></label></div>
      <div class="srow"><div><b>Share conversations</b><span>Send what you ask and what Genisys answers (no files, no passwords) so the app learns which requests to get better at. Your user folder and name are removed first. Off by default.</span></div><label class="tg"><input type="checkbox" name="shareChats"><i></i></label></div>
    </section>
    <div class="savebar"><button class="btn primary">Save settings</button> <span id="saved" class="muted"></span></div>`;
  f.querySelectorAll('[data-anim]').forEach((c) => {
    const k = c.dataset.anim;
    if (c.type === 'checkbox') { c.checked = !!ANIM[k]; c.onchange = () => setAnim(k, c.checked); }
    else { c.value = ANIM[k]; c.onchange = () => setAnim(k, c.value); }
  });
  const slider = f.querySelector('input[type=range]');
  const paintSlider = () => {
    f.querySelector('.sl-v').textContent = `${slider.value} steps`;
    slider.style.setProperty('--p', `${((slider.value - 3) / 47) * 100}%`);
  };
  slider.oninput = paintSlider;
  const sw = f.querySelector('.swatches');
  const paintSw = () => {
    const cur = getAccent();
    sw.replaceChildren();
    for (const [name, c] of PRESETS) {
      const b = el('button', `sw${(c || null) === (cur || null) ? ' on' : ''}`);
      b.type = 'button'; b.title = name === 'white' ? 'white (default)' : name;
      b.style.setProperty('--c', c || '#f4f4f5');
      b.onclick = () => { setAccent(c); paintSw(); };
      sw.append(b);
    }
    const pick = el('input'); pick.type = 'color'; pick.title = 'custom color';
    pick.value = cur || '#f4f4f5';
    pick.oninput = () => setAccent(pick.value);
    pick.onchange = paintSw;
    sw.append(pick);
  };
  paintSw();
  f.models.value = models.join('\n');
  f.deep.checked = P.deep;
  f.maxSteps.value = P.maxSteps;
  paintSlider();
  f.personality.value = P.personality;
  f.emoji.checked = P.emoji;
  f.custom.value = P.custom;
  f.autostart.checked = autostart;
  f.sendErrors.checked = await window.api.db('getSetting', 'sendErrors', false);
  f.shareChats.checked = (await window.api.db('getSetting', 'shareChats', false)) === true;
  f.autoUpdate.checked = (await window.api.db('getSetting', 'autoUpdate', true)) !== false;
  f.speed.checked = (await window.api.db('getSetting', 'speedMode', 'new')) === 'new';
  const paintSpeed = async () => {
    const n = await window.api.db('cacheCount');
    const ix = await window.api.indexInfo();
    f.querySelector('#cache-note').textContent = `${n} saved command${n === 1 ? '' : 's'} (never destructive ones)`;
    f.querySelector('#index-note').textContent = ix.ready ? `${ix.count.toLocaleString()} items, scanned ${ago(ix.scannedAt)}${ix.busy ? ', scanning…' : ''}` : ix.busy ? 'scanning your folders…' : 'not built yet (starts 15 s after launch)';
    f.querySelector('#speed-stats').textContent = await window.api.speedStats();
    const good = await window.api.db('scriptsGood');
    const box = f.querySelector('#scripts-good');
    box.replaceChildren();
    if (good.length) {
      box.append(el('p', 'desc', 'AI-written scripts that worked 2+ times. Copy one into a new actions/<name>/ folder (see docs/ADD_AN_ACTION.md) to make it instant:'));
      for (const g of good) {
        const row = el('div', 'srow');
        row.append(el('div', '', `${g.command} · ${g.ok_runs}/${g.runs} ok`), btn('copy script', async () => { await navigator.clipboard.writeText(g.script); }));
        box.append(row);
      }
    }
  };
  paintSpeed();
  f.querySelector('#cache-clear').onclick = async () => { await window.api.db('cacheClear'); paintSpeed(); };
  f.querySelector('#index-rescan').onclick = async () => { await window.api.indexRescan(); f.querySelector('#index-note').textContent = 'scanning your folders…'; };
  f.querySelector('#paths-open').onclick = () => window.api.openMyPaths();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const list = f.models.value.split('\n').map((s) => s.trim()).filter(Boolean);
    await window.api.db('setSetting', 'models', list.length ? list : null);
    await window.api.db('setSetting', 'prefs', {
      ...(await window.api.db('getSetting', 'prefs', {})),
      personality: f.personality.value, emoji: f.emoji.checked, custom: f.custom.value.trim(),
      deep: f.deep.checked, maxSteps: Math.max(3, Math.min(50, Number(f.maxSteps.value) || 20)),
    });
    await window.api.db('setSetting', 'speedMode', f.speed.checked ? 'new' : 'old');
    await window.api.db('setSetting', 'sendErrors', f.sendErrors.checked);
    await window.api.db('setSetting', 'shareChats', f.shareChats.checked);
    await window.api.db('setSetting', 'autoUpdate', f.autoUpdate.checked);
    const packaged = await window.api.autostart(f.autostart.checked);
    $('as-note').textContent = packaged ? '' : 'Applies in the installed app only.';
    $('saved').textContent = 'saved ✓ applies to the next task in every window';
  };
  root.append(f);
  modelPicker(f);
}

async function keysTab(root) {
  await ownAISection(root);
  const head = el('p', 'muted', 'Keys are tried top to bottom. When one hits its free daily limit it rests until 00:00 UTC and the next one takes over. Keys stay on this PC in config.json; only a masked form is shown here.');
  const list = el('div', 'items');
  root.append(section('openrouter keys', head, list));
  list.append(el('div', 'empty', 'checking each key…'));
  const keys = await window.api.keys('list');
  list.replaceChildren();
  keys.forEach((k, i) => {
    const row = el('div', 'key-row');
    const name = el('span', '', `${i + 1}. ${k.masked}`);
    const meter = el('span', 'muted');
    if (k.usage) {
      const m = el('div', 'meter');
      const fill = el('i');
      fill.style.width = `${Math.max(0, 100 - (k.usage.used / k.usage.limit) * 100)}%`;
      m.append(fill);
      meter.append(`${k.usage.limit - k.usage.used} / ${k.usage.limit} left today`, m);
    } else meter.textContent = 'usage unknown';
    const state = k.resting
      ? el('span', 'badge b-err', `resting until ${new Date(k.resting).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
      : el('span', 'badge b-done', i === keys.findIndex((x) => !x.resting) ? 'in use' : 'ready');
    if (k.reason && k.resting) state.title = k.reason;
    const act = el('span', 'act');
    if (k.resting) act.append(btn('wake', async () => { await window.api.keys('wake', k.id); render('keys'); }));
    if (i > 0) act.append(btn('↑', async () => { await window.api.keys('up', k.id); render('keys'); }));
    act.append(btn('✕', async () => { if (confirm(`Remove key ${k.masked}?`)) { await window.api.keys('remove', k.id); render('keys'); } }, 'btn x'));
    row.append(name, meter, state, act);
    list.append(row);
  });
  if (!keys.length) list.append(el('div', 'empty', 'No keys yet. Get a free one at openrouter.ai/keys.'));

  const add = el('form', 'addrow');
  const inp = Object.assign(el('input', 'field'), { placeholder: 'paste a new key: sk-or-v1-…', type: 'password', autocomplete: 'off' });
  const msg = el('span', 'muted');
  add.append(inp, btn('add key', null, 'btn primary'));
  add.onsubmit = async (e) => {
    e.preventDefault();
    try { await window.api.keys('add', inp.value); render('keys'); } catch (err) { msg.textContent = err.message.replace(/^Error invoking remote method 'keys': (Error: )?/, ''); }
  };
  root.append(section('add key', add, msg));

  // Fast providers (Stage 5). Keys live in config.json on this PC (or the GROQ_API_KEY / CEREBRAS_API_KEY env vars), never in the project.
  const provs = await window.api.pkeys('list');
  const pl = el('div', 'items');
  for (const p of provs) {
    const head = el('div', 'key-row');
    head.append(el('b', '', p.id), el('span', 'muted', p.models.join(', ')), p.fromEnv ? el('span', 'badge b-done', 'env var set') : el('span'));
    pl.append(head);
    for (const k of p.keys) {
      const row = el('div', 'key-row');
      row.append(el('span', '', k.masked), el('span', 'muted', ''), el('span', 'badge b-done', 'ready'), btn('✕', async () => { if (confirm(`Remove ${p.id} key ${k.masked}?`)) { await window.api.pkeys('remove', p.id, k.id); render('keys'); } }, 'btn x'));
      pl.append(row);
    }
  }
  const padd = el('form', 'addrow');
  const sel = el('select', 'field');
  for (const p of provs) sel.append(Object.assign(el('option', '', p.id), { value: p.id }));
  const pinp = Object.assign(el('input', 'field'), { placeholder: 'paste a Groq (gsk_…) or Cerebras (csk-…) key', type: 'password', autocomplete: 'off' });
  const pmsg = el('span', 'muted');
  padd.append(sel, pinp, btn('add key', null, 'btn primary'));
  padd.onsubmit = async (e) => {
    e.preventDefault();
    try { await window.api.pkeys('add', sel.value, pinp.value); render('keys'); } catch (err) { pmsg.textContent = err.message.replace(/^Error invoking remote method 'pkeys': (Error: )?/, ''); }
  };
  root.append(section('fast providers (optional)', el('p', 'muted', 'Used first when Fast mode is on (5 s per call, then the next one, then OpenRouter). Free keys: console.groq.com and cloud.cerebras.ai.'), pl, padd, pmsg));
}

// "Your own AI": the user's key for Claude, OpenAI, Gemini… and the model to use. Used first for every task;
// the free models take over if it fails. Keys stay in config.json on this PC; the page only sees a masked form.
async function ownAISection(root) {
  const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method '\w+': (Error: )?/, '');
  const st = await window.api.ownAI('state');
  const box = el('div', 'own');
  const now = el('div', 'own-now');
  const nowName = (a) => { const p = st.providers.find((x) => x.id === a?.provider); return a && p ? `${p.name} · ${a.model}` : 'Free models (Groq / OpenRouter)'; };
  now.innerHTML = '<span class="own-dot"></span><span class="own-l">Now using</span><b></b>';
  now.querySelector('b').textContent = nowName(st.active);
  now.classList.toggle('mine', !!st.active);
  if (st.active) now.append(btn('Use free models', async () => { await window.api.ownAI('use', {}); render('keys'); }, 'btn'));

  const form = el('form', 'own-f');
  const prov = el('select', 'field');
  for (const p of st.providers) prov.append(Object.assign(el('option', '', `${p.name}${p.masked ? '  ✓' : ''}`), { value: p.id }));
  prov.value = st.active?.provider || st.providers.find((p) => p.masked)?.id || 'anthropic';
  const keyRow = el('div', 'own-row');
  const key = Object.assign(el('input', 'field'), { type: 'password', autocomplete: 'off', spellcheck: false });
  const url = Object.assign(el('input', 'field'), { placeholder: 'service URL, e.g. http://localhost:11434/v1', spellcheck: false });
  const saveKey = btn('Save key', null, 'btn primary');
  const delKey = btn('Remove key', null, 'btn x');
  const getKey = el('a', 'own-get');
  keyRow.append(key, saveKey, delKey);
  const modelRow = el('div', 'own-row');
  const model = Object.assign(el('input', 'field'), { placeholder: 'model', spellcheck: false });
  const dl = el('datalist'); dl.id = 'own-models'; model.setAttribute('list', 'own-models');
  const test = btn('Test', null, 'btn');
  const use = btn('Use this model', null, 'btn primary');
  modelRow.append(model, dl, test, use);
  const msg = el('div', 'own-msg');
  const lbl = (t) => el('label', 'own-lbl', t);
  form.append(lbl('Provider'), prov, lbl('API key'), url, keyRow, getKey, lbl('Model'), modelRow, msg);
  const say = (t, ok) => { msg.textContent = t; msg.className = `own-msg${ok === true ? ' ok' : ok === false ? ' bad' : ''}`; };

  const fill = async () => {
    const p = st.providers.find((x) => x.id === prov.value);
    key.value = ''; key.placeholder = p.masked ? `saved: ${p.masked} (paste a new one to replace it)` : `paste your ${p.name} API key`;
    url.hidden = !p.custom; url.value = p.url || '';
    delKey.hidden = !p.masked;
    getKey.hidden = !p.keyUrl; getKey.textContent = p.keyUrl ? `Get a ${p.name} key ↗` : ''; getKey.href = '#';
    getKey.onclick = (e) => { e.preventDefault(); window.api.openPath(p.keyUrl); };
    model.value = st.active?.provider === p.id ? st.active.model : (p.models[0] || '');
    test.disabled = use.disabled = !p.masked;
    dl.replaceChildren(...p.models.map((m) => Object.assign(el('option'), { value: m })));
    say(p.masked ? 'Loading the models this key can use…' : 'Save a key to pick a model.');
    if (!p.masked) return;
    const list = await window.api.ownAI('models', { provider: p.id }).catch(() => p.models);
    if (prov.value !== p.id) return;
    dl.replaceChildren(...list.map((m) => Object.assign(el('option'), { value: m })));
    if (!model.value && list[0]) model.value = list[0];
    say(`${list.length} models available. Pick one or type its name, then Test.`);
  };
  prov.onchange = fill;
  form.onsubmit = async (e) => { // Enter in the key box = save it
    e.preventDefault();
    if (!key.value.trim()) return;
    try {
      await window.api.ownAI('setKey', { provider: prov.value, key: key.value, url: url.value });
      const p = st.providers.find((x) => x.id === prov.value);
      p.masked = `${key.value.trim().slice(0, 9)}…${key.value.trim().slice(-4)}`; p.url = url.value;
      prov.selectedOptions[0].textContent = `${p.name}  ✓`;
      await fill(); say('Key saved. Pick a model and press Test.', true);
    } catch (err) { say(errText(err), false); }
  };
  saveKey.type = 'submit';
  delKey.onclick = async () => { if (confirm('Remove this key from this PC?')) { await window.api.ownAI('removeKey', { provider: prov.value }); render('keys'); } };
  test.onclick = async () => {
    if (!model.value.trim()) return say('Pick a model first.', false);
    test.disabled = true; say('Testing…');
    const r = await window.api.ownAI('test', { provider: prov.value, model: model.value.trim() }).catch((err) => ({ ok: false, error: errText(err) }));
    test.disabled = false;
    say(r.ok ? `Works: answered in ${(r.ms / 1000).toFixed(1)}s.` : `Didn't work: ${r.error}`, r.ok);
  };
  use.onclick = async () => {
    if (!model.value.trim()) return say('Pick a model first.', false);
    try { await window.api.ownAI('use', { provider: prov.value, model: model.value.trim() }); render('keys'); } catch (err) { say(errText(err), false); }
  };
  box.append(now, el('p', 'muted', 'Use your own key for Claude, OpenAI, Gemini and more. Genisys uses that model first for every task; if it fails, the free models take over. Keys stay on this PC.'), form);
  root.append(section('your own AI', box));
  await fill();
}

// Free-model picker under the model list: biggest free models first, "add" appends to the list.
async function modelPicker(f) {
  const box = f.querySelector('.pick');
  box.innerHTML = `<div class="mp"><label class="mp-s"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input placeholder="Search models..." spellcheck="false"></label><div class="mp-list"><div class="mp-h">Loading free models...</div></div></div>`;
  const q = box.querySelector('input'), list = box.querySelector('.mp-list');
  let all = [];
  const cur = () => f.models.value.split('\n').map((s) => s.trim()).filter(Boolean);
  const put = (a) => { f.models.value = a.join('\n'); draw(); };
  const row = (id, meta, on, first) => {
    const r = el('div', `mp-r${on ? ' on' : ''}`);
    r.append(el('span', 'mp-n', id.replace(/:free$/, '')), el('span', 'mp-m', meta));
    if (on && !first) { const b = el('button', 'mp-up', 'Make first'); b.type = 'button'; b.onclick = (e) => { e.stopPropagation(); put([id, ...cur().filter((x) => x !== id)]); }; r.append(b); }
    r.append(el('span', 'mp-c', on ? '✓' : ''));
    r.onclick = () => put(on ? cur().filter((x) => x !== id) : [...cur(), id]);
    return r;
  };
  const draw = () => {
    const term = q.value.trim().toLowerCase(), sel = cur();
    list.replaceChildren();
    list.append(el('div', 'mp-h', 'In use, in order'));
    sel.forEach((id, i) => list.append(row(id, i === 0 ? 'first choice' : `backup ${i}`, true, i === 0)));
    if (!sel.length) list.append(el('div', 'mp-h dim', 'None selected. Pick at least one below.'));
    const rest = all.filter((m) => !sel.includes(m.id) && m.id.toLowerCase().includes(term));
    list.append(el('div', 'mp-h', all.length ? 'Free models' : 'Free models (offline, could not load the list)'));
    rest.slice(0, 60).forEach((m) => list.append(row(m.id, `${m.size ? `${m.size}B · ` : ''}${Math.round(m.ctx / 1000)}k`, false)));
  };
  q.oninput = draw;
  q.onkeydown = (e) => { if (e.key === 'Enter') e.preventDefault(); };
  draw();
  try { all = await window.api.freeModels(); } catch { all = []; }
  draw();
}

// Report: a message to the developer (idea, bug, question), sent to the website backend through the main process.
async function reportTab(root) {
  const { account } = await window.api.cloud('state');
  const f = el('form', 'report');
  f.innerHTML = `
    <p class="desc">Tell the developer what to improve, what broke, or what you wish Genisys could do. Every message gets read.</p>
    <div class="seg" role="radiogroup" aria-label="Kind of message">
      ${[['idea', 'Idea'], ['bug', 'Bug'], ['question', 'Question'], ['other', 'Other']].map(([v, l], i) =>
        `<label><input type="radio" name="type" value="${v}" ${i ? '' : 'checked'}><span>${l}</span></label>`).join('')}
    </div>
    <textarea name="message" class="edit" rows="7" maxlength="2000" placeholder="e.g. It would be great if /agent could also…" aria-label="Your message"></textarea>
    <div class="report-foot">
      ${account?.email ? '<label class="check"><input type="checkbox" name="includeEmail" checked> <span></span></label>' : '<span></span>'}
      <span class="muted" data-count>0 / 2000</span>
    </div>
    <div class="report-foot"><span class="muted" data-status role="status"></span><button class="btn primary" type="submit">Send</button></div>`;
  if (account?.email) f.querySelector('.check span').textContent = `include my email (${account.email}) so I can get a reply`;
  const msg = f.message, status = f.querySelector('[data-status]'), count = f.querySelector('[data-count]');
  const upd = () => { count.textContent = `${msg.value.length} / 2000`; try { sessionStorage.setItem('reportDraft', msg.value); } catch {} };
  try { msg.value = sessionStorage.getItem('reportDraft') || ''; } catch {}
  msg.oninput = upd; upd();
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (!msg.value.trim()) { status.textContent = 'Write something first.'; msg.focus(); return; }
    const send = f.querySelector('button[type=submit]');
    send.disabled = true; status.textContent = 'Sending…';
    try {
      await window.api.cloud('report', { type: f.type.value, message: msg.value.trim(), includeEmail: !!f.includeEmail?.checked });
      msg.value = ''; upd(); status.textContent = 'Sent. Thank you!';
    } catch {
      status.textContent = "Couldn't send. Check your internet and try again (your message is kept).";
    }
    send.disabled = false;
  };
  root.append(f);
  msg.focus();
}

// About Genisys: version, where every piece of app data lives (with sizes and Open buttons), the PC, the AI in use,
// the search index, and how to reach the developer. "Copy all" puts a plain-text summary on the clipboard for support.
const DEV_LINKS = [
  { name: 'X (Twitter)', handle: '@KevinKiz', url: 'https://x.com/KevinKiz', icon: '<path d="M4 4l16 16M20 4 4 20"/>' },
  { name: 'Instagram', handle: '@kevin___kiz', url: 'https://www.instagram.com/kevin___kiz/', icon: '<rect width="16" height="16" x="4" y="4" rx="5"/><circle cx="12" cy="12" r="3.5"/><path d="M16.5 7.5v.01"/>' },
];
async function appTab(root) {
  const i = await window.api.appInfo();
  const bytes = (n) => (n == null ? '—' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);
  const when = (t) => (t ? `${new Date(t).toLocaleString()} (${ago(t)})` : 'not yet');
  const kv = (rows) => {
    const d = el('div', 'ab-kv');
    for (const [k, v] of rows) { if (v === undefined || v === null || v === '') continue; d.append(el('span', 'ab-k', k), el('span', 'ab-v', String(v))); }
    return d;
  };

  const head = el('div', 'ab-head');
  head.innerHTML = '<img class="ab-logo" alt=""><div class="ab-id"><b>Genisys</b><span></span></div>';
  head.querySelector('img').src = document.querySelector('img.logo')?.src || './assets/icon.svg'; // same file the header already resolved
  head.querySelector('.ab-id span').textContent = `Version ${i.app.version}${i.app.packaged ? '' : ' (developer build)'}`;
  const upd = el('span', 'muted ab-upd');
  const chk = btn('Check for updates', async () => {
    chk.disabled = true; upd.textContent = 'Checking…';
    try { const r = await window.api.checkUpdates(); upd.textContent = r.dev ? 'Updates only apply to the installed app.' : r.latest && r.latest !== r.current ? `Genisys ${r.latest} is available. See Notes to install it.` : `You have the latest version (${r.current}).`; }
    catch { upd.textContent = "Couldn't check right now. Try again later."; }
    chk.disabled = false;
  });
  head.append(chk);
  root.append(head, upd);

  const dev = el('div', 'ab-dev');
  dev.append(el('p', 'muted', 'Made by Kevin. Questions, ideas or something broken? Message me, or use the Report tab.'));
  const links = el('div', 'ab-links');
  for (const l of DEV_LINKS) {
    const b = el('button', 'ab-link'); b.type = 'button'; b.title = l.url;
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${l.icon}</svg><span><b></b><small></small></span>`;
    b.querySelector('b').textContent = l.name; b.querySelector('small').textContent = l.handle;
    b.onclick = () => window.api.openPath(l.url);
    links.append(b);
  }
  dev.append(links);
  root.append(section('developer', dev));

  const files = el('div', 'ab-files');
  for (const f of i.data.files) {
    const r = el('div', `ab-file${f.exists ? '' : ' none'}`);
    r.append(el('span', 'ab-fn', f.name), el('span', 'ab-fs', f.exists ? bytes(f.size) : 'not created yet'));
    const what = el('span', 'ab-fw', f.what); what.title = f.path;
    r.append(what);
    if (f.exists) r.append(btn('Open', () => (/\.[a-z]+$/i.test(f.path) ? window.api.reveal(f.path) : window.api.openPath(f.path))));
    files.append(r);
  }
  const dataHead = el('div', 'ab-datah');
  dataHead.append(el('span', 'ab-v', i.data.folder), el('span', 'ab-k', `${bytes(i.data.total)} in total`), btn('Open folder', () => window.api.openPath(i.data.folder), 'btn primary'));
  root.append(section('app data', dataHead, files));

  root.append(section('this pc', kv([
    ['Windows', i.system.windows], ['Processor', `${i.system.cpu} · ${i.system.cores} threads`], ['Memory', `${bytes(i.system.ram)} (${bytes(i.system.freeRam)} free)`],
    ['Drives', i.system.drives], ['Computer', i.system.computer], ['User', i.system.user], ['Language', i.system.locale], ['Architecture', i.system.arch],
  ])));
  const fast = Object.entries(i.ai.fastKeys).map(([k, n]) => `${k}: ${n}`).join(', ');
  root.append(section('ai', kv([
    ['Model in use', i.ai.using], ['Your own keys', i.ai.ownKeys.join(', ') || 'none'], ['OpenRouter keys', i.ai.openrouterKeys], ['Fast provider keys', fast || 'none'],
    ['Speed mode', i.app.speedMode === 'new' ? 'Fast (code first, then AI)' : 'Classic (AI for everything)'],
  ])));
  root.append(section('search index', kv([
    ['Whole PC (/search)', `${i.index.pcEntries.toLocaleString()} files and folders · scanned ${when(i.index.pcScanned)}`],
    ['Your folders (AI)', `${i.index.userEntries.toLocaleString()} entries · scanned ${when(i.index.userScanned)}`],
    ['Microsoft Store apps', i.index.storeApps], ['Rescans', 'when Genisys starts, then every 5 minutes'],
  ])));
  root.append(section('saved by you', kv([
    ['Remembered commands', i.saved.memory], ['Things about you', i.saved.profile], ['Notes', i.saved.notes], ['Cached fast commands', i.saved.cached], ['Trusted scripts', i.saved.scripts],
  ])));
  root.append(section('app', kv([
    ['Version', i.app.version], ['Installed in', i.app.installDir], ['Program', i.app.exe],
    ['Starts with Windows', i.app.autostart ? (i.app.startsWithWindows === false && i.app.packaged ? 'on in Settings, but not registered with Windows yet' : 'yes') : 'no'],
    ['Automatic updates', i.app.autoUpdate ? 'on' : 'off'], ['Running since', when(i.app.startedAt)],
    ['Electron', i.app.electron], ['Chromium', i.app.chrome], ['Node.js', i.app.node], ['V8', i.app.v8],
  ])));

  // Plain text for support messages (no keys: only counts).
  const text = [
    `Genisys ${i.app.version}${i.app.packaged ? '' : ' (dev)'} · Electron ${i.app.electron} · Chromium ${i.app.chrome} · Node ${i.app.node}`,
    `Windows ${i.system.windows} ${i.system.arch} · ${i.system.cpu} · ${bytes(i.system.ram)} RAM · drives ${i.system.drives}`,
    `Installed in ${i.app.installDir} · starts with Windows: ${i.app.autostart ? 'yes' : 'no'} · auto-update: ${i.app.autoUpdate ? 'on' : 'off'}`,
    `AI: ${i.ai.using} · OpenRouter keys ${i.ai.openrouterKeys} · fast keys ${fast || 'none'}`,
    `Index: ${i.index.pcEntries} PC entries, ${i.index.userEntries} folder entries, ${i.index.storeApps} Store apps`,
    `App data ${i.data.folder} (${bytes(i.data.total)}):`, ...i.data.files.map((f) => `  ${f.name}: ${f.exists ? bytes(f.size) : 'none'}`),
  ].join('\n');
  const copyMsg = el('span', 'muted');
  const copy = btn('Copy all', async () => { try { await navigator.clipboard.writeText(text); copyMsg.textContent = 'Copied. Paste it into a message or the Report tab.'; } catch { copyMsg.textContent = "Couldn't copy."; } });
  const bar = el('div', 'ab-bar'); bar.append(copy, copyMsg);
  root.append(bar);
}

const TABS = { settings: settingsTab, keys: keysTab, memory: memoryTab, about: aboutTab, app: appTab, notes: notesTab, report: reportTab };
// Opens the settings panel on a page; "close" (or unknown) hides it.
export async function render(name) {
  const open = !!TABS[name];
  $('panel').classList.toggle('show', open);
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('on', s.id === `tab-${name}`));
  if (!open) { $('input').focus(); return; }
  const root = $(`tab-${name}`);
  root.replaceChildren();
  await TABS[name](root);
}
export const panelOpen = () => $('panel').classList.contains('show');

export async function refreshCount() {
  const n = await window.api.db('unseenNotes');
  $('notes-n').textContent = n || '';
}

// Main window: icons open the panel here. Agent windows: icons open it in the main window.
export function initTabs(isMain) {
  const open = (tab) => (isMain ? render(tab) : window.api.nav(tab));
  document.querySelectorAll('#tabs button[data-tab]').forEach((b) => { b.onclick = () => render(b.dataset.tab); });
  document.querySelectorAll('.ico[data-open]').forEach((b) => { b.onclick = () => open(b.dataset.open); });
  $('panel-x').onclick = () => render('close');
  $('panel').onclick = (e) => { if (e.target === $('panel')) render('close'); };
  if (isMain) window.api.onNav((tab) => render(tab));
  window.api.onNotesChanged(() => {
    refreshCount();
    if ($('tab-notes').classList.contains('on')) render('notes');
  });
  refreshCount();
}
