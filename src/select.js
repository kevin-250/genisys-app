// Custom dropdowns for every <select> (and suggestion lists for <input list>), because Windows draws native ones as a
// white box that ignores the app's theme. The real <select> stays in the page, hidden, and keeps its value, name and
// change events, so forms and code that read or set it keep working. New selects are picked up automatically.
const enhanced = new WeakSet();
let open = null; // { menu, close }

const closeOpen = () => open?.close();
addEventListener('mousedown', (e) => { if (open && !open.menu.contains(e.target) && !open.owner.contains(e.target)) closeOpen(); }, true);
addEventListener('resize', closeOpen);
addEventListener('blur', closeOpen);

// Floating list under (or above, when there's no room) an anchor. items: [{ label, value, on, disabled }].
function showMenu(anchor, items, { onPick, onClose, owner = anchor, role = 'listbox' }) {
  closeOpen();
  const menu = document.createElement('div');
  menu.className = 'dd-menu'; menu.setAttribute('role', role);
  let sel = Math.max(0, items.findIndex((i) => i.on));
  const rows = items.map((it, i) => {
    const r = document.createElement('div');
    r.className = `dd-opt${it.on ? ' on' : ''}${it.disabled ? ' off' : ''}`; r.setAttribute('role', 'option'); r.setAttribute('aria-selected', !!it.on);
    r.innerHTML = '<span></span><i class="dd-check"></i>'; r.firstChild.textContent = it.label;
    r.onmousedown = (e) => { e.preventDefault(); if (!it.disabled) { close(); onPick(it); } };
    r.onmouseenter = () => { sel = i; mark(); };
    menu.append(r);
    return r;
  });
  if (!items.length) menu.append(Object.assign(document.createElement('div'), { className: 'dd-empty', textContent: 'No matches' }));
  const mark = () => rows.forEach((r, i) => r.classList.toggle('hl', i === sel));
  document.body.append(menu);
  const place = () => {
    const a = anchor.getBoundingClientRect();
    menu.style.minWidth = `${a.width}px`;
    const h = Math.min(menu.scrollHeight, 300), below = innerHeight - a.bottom - 8;
    menu.style.maxHeight = `${Math.max(120, Math.min(300, below >= h || below >= a.top ? below : a.top - 8))}px`;
    menu.style.left = `${Math.max(4, Math.min(a.left, innerWidth - menu.offsetWidth - 4))}px`;
    menu.style.top = below >= h || below >= a.top ? `${a.bottom + 4}px` : `${a.top - 4 - Math.min(h, a.top - 8)}px`;
  };
  place(); mark(); rows[sel]?.scrollIntoView({ block: 'nearest' });
  function close() { if (open?.menu !== menu) return; menu.remove(); open = null; onClose?.(); }
  open = {
    menu, owner, close,
    key(e) { // returns true when handled
      const k = e.key;
      if (k === 'ArrowDown' || k === 'ArrowUp') { sel = (sel + (k === 'ArrowDown' ? 1 : rows.length - 1)) % Math.max(1, rows.length); mark(); rows[sel]?.scrollIntoView({ block: 'nearest' }); return true; }
      if (k === 'Home' || k === 'End') { sel = k === 'Home' ? 0 : rows.length - 1; mark(); rows[sel]?.scrollIntoView({ block: 'nearest' }); return true; }
      if ((k === 'Enter' || k === 'Tab') && rows[sel]) { if (k === 'Enter') e.preventDefault(); const it = items[sel]; close(); if (!it.disabled) onPick(it); return k === 'Enter'; }
      if (k === 'Escape') { close(); return true; }
      return false;
    },
    typeAhead(ch) { const i = items.findIndex((it, j) => j > sel && it.label.toLowerCase().startsWith(ch)) ; const k = i >= 0 ? i : items.findIndex((it) => it.label.toLowerCase().startsWith(ch)); if (k >= 0) { sel = k; mark(); rows[sel].scrollIntoView({ block: 'nearest' }); } },
    pickCurrent() { const it = items[sel]; close(); if (it && !it.disabled) onPick(it); },
  };
  return open;
}

function enhanceSelect(s) {
  if (enhanced.has(s) || s.multiple || s.size > 1) return;
  enhanced.add(s);
  const b = document.createElement('button');
  b.type = 'button'; b.className = `dd ${s.className}`.trim(); b.setAttribute('aria-haspopup', 'listbox');
  b.innerHTML = '<span class="dd-l"></span><i class="dd-chev"></i>';
  s.classList.add('dd-native'); s.tabIndex = -1; s.setAttribute('aria-hidden', 'true');
  s.after(b);
  const label = () => { const o = s.options[s.selectedIndex]; b.firstChild.textContent = o ? o.textContent : ''; b.disabled = s.disabled; b.title = s.title || ''; };
  // Code that sets select.value (or swaps its options) must update the button too.
  const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(s, 'value', { get() { return proto.get.call(this); }, set(v) { proto.set.call(this, v); label(); }, configurable: true });
  new MutationObserver(label).observe(s, { childList: true, subtree: true, characterData: true, attributes: true });
  s.addEventListener('change', label);
  const openList = () => {
    if (open?.owner === b) return closeOpen();
    b.classList.add('open'); b.setAttribute('aria-expanded', 'true');
    showMenu(b, [...s.options].map((o) => ({ label: o.textContent, value: o.value, on: o.selected, disabled: o.disabled })), {
      onPick: (it) => { if (s.value !== it.value) { s.value = it.value; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); } b.focus(); },
      onClose: () => { b.classList.remove('open'); b.setAttribute('aria-expanded', 'false'); },
    });
  };
  b.onclick = openList;
  b.addEventListener('keydown', (e) => {
    if (open?.owner === b) { if (open.key(e)) { e.preventDefault(); e.stopPropagation(); } else if (e.key === ' ') { e.preventDefault(); open.pickCurrent(); } else if (e.key.length === 1) open.typeAhead(e.key.toLowerCase()); return; }
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openList(); }
  });
  label();
}

// <input list="…">: our own suggestion list (filtered as you type) instead of the browser's.
function enhanceInputList(inp) {
  if (enhanced.has(inp)) return;
  const id = inp.getAttribute('list');
  if (!id) return;
  enhanced.add(inp);
  inp.removeAttribute('list'); inp.dataset.list = id; inp.setAttribute('autocomplete', 'off'); inp.setAttribute('role', 'combobox');
  const opts = () => [...(document.getElementById(inp.dataset.list)?.options || [])].map((o) => o.value).filter(Boolean);
  const show = (all) => {
    const q = inp.value.trim().toLowerCase();
    const list = opts().filter((v) => all || !q || v.toLowerCase().includes(q)).slice(0, 60);
    if (!list.length && !all) return closeOpen();
    showMenu(inp, list.map((v) => ({ label: v, value: v, on: v === inp.value })), { owner: inp, onPick: (it) => { inp.value = it.value; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); } });
  };
  inp.addEventListener('focus', () => show(true));
  inp.addEventListener('click', () => { if (open?.owner !== inp) show(true); });
  inp.addEventListener('input', (e) => { if (e.isTrusted) show(false); });
  inp.addEventListener('keydown', (e) => {
    if (open?.owner === inp) { if (open.key(e)) { e.preventDefault(); e.stopPropagation(); } return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); show(true); }
  });
  inp.addEventListener('blur', () => setTimeout(() => { if (open?.owner === inp && !open.menu.matches(':hover')) closeOpen(); }, 120));
}

export function enhanceSelects(root = document) {
  root.querySelectorAll?.('select').forEach(enhanceSelect);
  root.querySelectorAll?.('input[list]').forEach(enhanceInputList);
}
// Everything now and everything added later (Settings pages are built on the fly).
export function autoEnhanceSelects() {
  enhanceSelects(document);
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.matches?.('select')) enhanceSelect(n); else if (n.matches?.('input[list]')) enhanceInputList(n); else enhanceSelects(n);
    }
  }).observe(document.body, { childList: true, subtree: true });
}
