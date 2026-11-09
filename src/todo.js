// Floating "plan" widget: a small always-on-top card at the bottom-right of the screen showing the agent's to-do list.
import { applyAccent } from './accent.js';
import logoUrl from '../assets/icon.svg';

const theme = (() => { try { return localStorage.getItem('theme'); } catch { return null; } })() || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
document.documentElement.dataset.theme = theme;
applyAccent();
document.body.replaceChildren();
document.body.className = 'm-todo';
document.body.innerHTML = `
  <div class="td">
    <div class="td-head"><img src="${logoUrl}" alt=""><b class="td-title">Plan</b><span class="td-count"></span><button class="td-x" title="Hide">✕</button></div>
    <div class="td-task"></div>
    <div class="td-bar"><i></i></div>
    <ul class="td-list"></ul>
    <div class="td-foot"></div>
  </div>`;
const $ = (s) => document.querySelector(s);
$('.td-x').onclick = () => window.api.todoClose();

// Incremental render: rows are reused so nothing flickers; plan steps are folders whose actions open and close with a slide.
const rows = [], userOpen = new Map();
function render(st) {
  if (!st) return;
  const items = st.items || [];
  const done = items.filter((i) => i.state === 'done').length;
  $('.td-task').textContent = st.title || '';
  $('.td-count').textContent = `${done}/${items.length}`;
  $('.td-bar i').style.width = `${items.length ? (st.finished && !st.stopped ? 100 : (done / items.length) * 100) : 0}%`;
  const ul = $('.td-list');
  while (rows.length > items.length) rows.pop().li.remove();
  items.forEach((it, n) => {
    let r = rows[n];
    if (!r) {
      const li = document.createElement('li');
      li.innerHTML = '<div class="td-row"><i class="ic"></i><span class="tt"></span><span class="tn"></span></div><div class="td-kids"><ul></ul></div>';
      li.style.animationDelay = `${n * 40}ms`;
      li.querySelector('.td-row').onclick = () => { const o = !li.classList.contains('open'); userOpen.set(n, o); li.classList.toggle('open', o); };
      ul.append(li);
      r = rows[n] = { li, ul: li.querySelector('ul'), kids: [] };
    }
    r.li.className = `${it.state}${(userOpen.has(n) ? userOpen.get(n) : it.state === 'now') ? ' open' : ''}${it.kids?.length ? ' has-kids' : ''}`;
    r.li.querySelector('.tt').textContent = it.text;
    r.li.querySelector('.tn').textContent = it.kids?.length || '';
    const kids = it.kids || [];
    while (r.kids.length > kids.length) r.kids.pop().remove();
    kids.forEach((k, i) => {
      let kl = r.kids[i];
      if (!kl) { kl = document.createElement('li'); kl.innerHTML = '<i class="ic"></i><span></span>'; r.ul.append(kl); r.kids[i] = kl; }
      kl.className = k.state;
      kl.lastChild.textContent = k.text;
    });
  });
  const foot = $('.td-foot');
  foot.className = `td-foot ${st.finished ? (st.stopped ? 'stopped' : 'ok') : 'run'}`;
  foot.textContent = st.finished ? (st.stopped ? 'Stopped' : st.failed ? 'Finished with problems' : 'All done') : 'Working…';
  requestAnimationFrame(() => window.api.todoSize(Math.ceil($('.td').scrollHeight) + 16)); // window fits the card: no scrollbar, no empty space
}
window.api.onTodo((st) => render(st));
window.api.todoInit().then(render);
