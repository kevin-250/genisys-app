// Floating tool card: a small always-on-top window at the bottom-right of the screen that shows the live tool
// (timer, stopwatch, music…) while the user is in another app, and rings there when a timer or alarm goes off.
// Hover: open Genisys / close. It never takes focus away from what the user is doing.
import { applyAccent } from './accent.js';
import { toolCardFor, ringCard, stopRings, setRingOptions, syncTimers, onActive } from './toolcards.js';

const theme = (() => { try { return localStorage.getItem('theme'); } catch { return null; } })() || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
document.documentElement.dataset.theme = theme;
applyAccent();
document.body.replaceChildren();
document.body.className = 'm-tool';
const root = document.createElement('div');
root.id = 'toolroot';
document.body.append(root);

const opts = {
  onOpen: () => { stopRings(); window.api.toolOpenApp(); },
  onClose: () => { stopRings(); window.api.toolHide(); },
};
setRingOptions(opts);

let shownKey = '';
window.api.onToolShow?.((m) => {
  if (!m) return;
  if (m.ring) { root.replaceChildren(ringCard(m.ring, { onSnooze: () => window.api.fast('alarm', { op: 'set', at: Date.now() + 9 * 60e3 }, true) })); shownKey = 'ring'; }
  else if (m.card) {
    const key = JSON.stringify(m.card);
    if (key === shownKey) return; // same thing: keep the live card (no flicker, no restart)
    if (shownKey === 'ring' && root.querySelector('.ringing')) return; // never replace a ringing alarm
    const node = toolCardFor(m.card, opts);
    if (node) { node.querySelectorAll('.tc').forEach((c) => c.classList.add('tc-small')); root.replaceChildren(node); shownKey = key; } // compact: it floats over other apps
  }
});
window.api.onToolStop?.(() => stopRings());
window.api.onClockChanged?.(() => syncTimers());
// the shown timer / stopwatch ended (done, cancelled, reset): this little window goes away by itself, unless it rings
onActive((d) => { if (!d) setTimeout(() => { if (!root.querySelector('.ringing, .tc.paused')) { shownKey = ''; window.api.toolHide(); } }, 2500); }); // a paused timer stays

// the window follows the card's height
new ResizeObserver(() => window.api.toolSize?.(Math.ceil(root.getBoundingClientRect().height) + 34)).observe(root);
window.api.toolReady?.();
