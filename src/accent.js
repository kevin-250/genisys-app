// App accent color: default is white (charcoal in the light theme); the user can pick any color in Settings → color.
// Saved in localStorage so every window picks it up instantly (storage event).
const KEY = 'accent';
export const PRESETS = [['white', null], ['orange', '#ff8a3d'], ['amber', '#ffc247'], ['green', '#5bdc92'], ['blue', '#4aa3ff'], ['violet', '#9b7bff'], ['pink', '#ff6fb5'], ['red', '#ff6b6b']];
export const getAccent = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const ink = (hex) => { const n = parseInt(hex.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150 ? '#1b1917' : '#ffffff'; };
const PROPS = ['--accent', '--accent-ink', '--accent-soft', '--hl', '--tk-key'];
export function applyAccent(c = getAccent()) {
  const s = document.documentElement.style;
  if (!c) { PROPS.forEach((p) => s.removeProperty(p)); return; }
  s.setProperty('--accent', c);
  s.setProperty('--accent-ink', ink(c));
  s.setProperty('--accent-soft', `color-mix(in srgb, ${c} 14%, transparent)`);
  s.setProperty('--hl', `color-mix(in srgb, ${c} 8%, transparent)`);
  s.setProperty('--tk-key', c);
}
export function setAccent(c) {
  try { c ? localStorage.setItem(KEY, c) : localStorage.removeItem(KEY); } catch {}
  applyAccent(c || null);
}
addEventListener('storage', (e) => { if (e.key === KEY) applyAccent(); });
