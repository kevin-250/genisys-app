// Animation preferences, shared by every window (localStorage) and applied live where possible.
const KEY = 'genisys-anim';
export const DEFAULTS = { focus: 'special', underline: true, dots: true, orb: true, globe: true };
export const ANIM = { ...DEFAULTS };
try { Object.assign(ANIM, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
export function setAnim(k, v) {
  ANIM[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(ANIM)); } catch {}
  dispatchEvent(new CustomEvent('anim-change', { detail: k }));
}
addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  try { Object.assign(ANIM, JSON.parse(e.newValue || '{}')); } catch {}
  dispatchEvent(new CustomEvent('anim-change'));
});
