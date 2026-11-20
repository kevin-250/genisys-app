// The live trace's API for app.js (start / plan / focus / step / detail / fail / out / reason / note / sources / stop…),
// kept from the old DOM version so the AI loop doesn't change. It holds a small model and redraws <Trace> on each change.
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MotionConfig } from 'motion/react';
import { Trace } from './Trace.jsx';

export function makeLive({ log, toEnd, onStop, onOpenLink }) {
  let m = null, root = null, host = null, cur = null, curGroup = null, ids = 0;
  // each card draws its own model, so a folded card from an earlier request still opens and closes
  // the model object itself (clicks change it in place) + a version so React redraws
  const painter = (r, model) => () => flushSync(() => r.render(<MotionConfig reducedMotion="user"><Trace m={model} v={(model.v = (model.v || 0) + 1)} /></MotionConfig>));
  const draw = () => m?.rerender();
  const kids = () => (curGroup ? curGroup.kids : m.steps);
  const finish = (s, ok = true) => { if (!s || s.state !== 'on') return; s.state = ok ? 'ok' : 'bad'; s.ms = Date.now() - s.t0; if (s.kind === 'act' && !ok) s.open = true; };
  const kindOf = (label) => (/^(thinking|understanding)/.test(label) ? 'think' : /^(browsing|checking the web|searching the web|reading)/i.test(label) ? 'web' : 'act');

  return {
    el: () => host,
    slot: () => host?.querySelector('.lorb'),
    start(task = '') {
      if (host && m?.phase === 'working') { root.unmount(); host.remove(); } // a card still open (router try): replaced
      host = document.createElement('div'); host.className = 'trace';
      log.append(host);
      root = createRoot(host);
      cur = null; curGroup = null;
      m = { task, phase: 'working', t0: Date.now(), t1: 0, open: true, label: '', steps: [], groups: [], onStop, onOpenLink };
      m.rerender = painter(root, m);
      draw(); toEnd();
    },
    // plan steps become the top level; later actions nest under the step being worked on
    plan(items) { if (!m) return; m.groups = items.map((text) => ({ text: String(text), state: 'todo', kids: [], open: false })); draw(); },
    focus(n) {
      if (!m?.groups.length) return;
      const idx = Number.isFinite(n) ? Math.max(1, Math.min(m.groups.length, n)) : m.groups.length + 1;
      m.groups.forEach((g, i) => { g.state = i + 1 < idx ? 'done' : i + 1 === idx ? 'now' : 'todo'; g.open = g.state === 'now'; });
      curGroup = m.groups[idx - 1] || null;
      draw();
    },
    // the current step is done; a new one starts
    step(label, detail = '') {
      if (!m) return;
      const kind = kindOf(label);
      // a "Thinking" step that ended at once with nothing in it is noise ("Thought 0.0s"): dropped
      if (cur?.kind === 'think' && Date.now() - cur.t0 < 1000 && !cur.reasons.length) { const k = kids(); k.splice(k.indexOf(cur), 1); cur = null; }
      finish(cur);
      const d = String(detail).split('\n')[0].slice(0, 90);
      cur = { id: ++ids, kind, label: kind === 'think' ? 'Thinking' : label.replace(/^./, (c) => c.toUpperCase()), detail: kind === 'think' ? '' : d,
        state: 'on', t0: Date.now(), ms: 0, outs: [], reasons: [], sources: [], open: true, rerender: m.rerender, text: `${label}${d ? ` ${d}` : ''}` };
      kids().push(cur);
      draw(); toEnd();
    },
    detail(t) { if (cur && cur.kind !== 'think') { cur.detail = String(t).slice(0, 90); draw(); } },
    fail() { finish(cur, false); cur = null; draw(); },
    // output under the current step: text or a DOM node (command output, file tree, globe…)
    out(node, open = true) {
      if (!cur) return null;
      cur.outs = [...cur.outs, node];
      if (cur.kind === 'act') cur.open = open || cur.open;
      draw(); toEnd();
      return node;
    },
    // web results as prompt-kit Source chips on the current web step
    sources(list) { if (cur) { cur.sources = (list || []).filter((x) => x?.url); draw(); toEnd(); } },
    // the model's reasoning goes inside its Thinking step (closed when done: the answer comes first)
    reason(t) { if (cur?.kind === 'think' && t) { cur.reasons = [...cur.reasons, String(t)]; draw(); return true; } return false; },
    // what the model said while it was still working ("Let me check…"): part of its thinking, not an answer
    note(t) {
      if (!m || !t) return;
      if (this.reason(t)) return;
      const host2 = kids();
      const last = [...host2].reverse().find((s) => s.kind === 'think');
      if (last) { last.reasons = [...last.reasons, String(t)]; draw(); }
    },
    // for the floating plan widget
    snapshot(upTo, end) {
      return (m?.groups || []).map((g, i) => ({
        text: g.text, state: i + 1 < upTo ? 'done' : i + 1 === upTo ? (end ? 'todo' : 'now') : 'todo',
        kids: g.kids.map((k) => ({ text: k.text, state: k.state === 'on' ? (end ? 'todo' : 'now') : k.state === 'bad' ? 'bad' : 'done' })),
      }));
    },
    hasPlan: () => !!m?.groups.length,
    // fold into the summary line; a turn with no real step (a chat answer) leaves no trace at all
    stop(ok = true, label = '') {
      if (!m) return;
      finish(cur, ok); cur = null;
      const all = [...m.steps, ...m.groups.flatMap((g) => g.kids)];
      if (!all.some((s) => s.kind !== 'think')) { root.unmount(); host.remove(); host = null; m = null; return; }
      m.phase = ok ? 'done' : 'bad'; m.t1 = Date.now(); m.open = false;
      if (label) m.label = `${label} ${all.filter((s) => s.kind !== 'think').length} steps`;
      draw();
      m = null; cur = null; curGroup = null; // the folded card stays in the chat; the next start() draws a new one
    },
  };
}
