// Stage 10: numbers from timing.log. Used by tools/stats.mjs and the Settings > Speed panel.
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const med = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fmt = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);

export function parseLog(text) {
  return String(text || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

export function groupBy(rows, keyFn) {
  const g = new Map();
  for (const r of rows) { const k = keyFn(r); if (k == null || k === '') continue; if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
  return [...g].map(([key, rs]) => ({ key, n: rs.length, ok: rs.filter((r) => r.ok).length, rate: rs.filter((r) => r.ok).length / rs.length, avgMs: avg(rs.map((r) => r.totalMs || 0)), medMs: med(rs.map((r) => r.totalMs || 0)), calls: avg(rs.map((r) => r.modelCalls || 0)) }))
    .sort((a, b) => b.n - a.n);
}

// "old" mode vs "new" mode, matched by command text (same command typed in both modes).
export function compareModes(rows) {
  const byText = new Map();
  for (const r of rows) {
    const t = String(r.text || '').toLowerCase().trim(); if (!t) continue;
    const m = (r.mode || 'old') === 'new' ? 'new' : 'old';
    if (!byText.has(t)) byText.set(t, { old: [], new: [] });
    byText.get(t)[m].push(r.totalMs || 0);
  }
  return [...byText].filter(([, v]) => v.old.length && v.new.length).map(([text, v]) => ({ text, oldMs: avg(v.old), newMs: avg(v.new), speedup: avg(v.old) / (avg(v.new) || 1) }));
}

export function formatStats(rows) {
  if (!rows.length) return 'No commands logged yet. Run some commands, then look here again.';
  const L = [];
  const table = (title, g) => {
    if (!g.length) return;
    L.push(title, `  ${'name'.padEnd(26)}${'runs'.padStart(5)}${'ok'.padStart(7)}${'avg'.padStart(9)}${'median'.padStart(9)}${'AI calls'.padStart(10)}`);
    for (const x of g) L.push(`  ${String(x.key).slice(0, 25).padEnd(26)}${String(x.n).padStart(5)}${`${Math.round(x.rate * 100)}%`.padStart(7)}${fmt(x.avgMs).padStart(9)}${fmt(x.medMs).padStart(9)}${x.calls.toFixed(1).padStart(10)}`);
    L.push('');
  };
  table('By route (cache / fast / router / script / saved / old)', groupBy(rows, (r) => r.route || 'old'));
  table('By mode (old flow vs new flow)', groupBy(rows, (r) => r.mode || 'old'));
  table('By action', groupBy(rows, (r) => r.action));
  table('By provider (AI calls)', groupBy(rows.flatMap((r) => (r.ai || []).map((c) => ({ provider: c.provider || 'openrouter', ok: c.ok, totalMs: c.ms, modelCalls: 1 }))), (r) => r.provider));
  const cmp = compareModes(rows);
  if (cmp.length) {
    L.push('Same command, old vs new', `  ${'command'.padEnd(34)}${'old'.padStart(9)}${'new'.padStart(9)}${'faster'.padStart(9)}`);
    for (const c of cmp) L.push(`  ${c.text.slice(0, 33).padEnd(34)}${fmt(c.oldMs).padStart(9)}${fmt(c.newMs).padStart(9)}${`${c.speedup.toFixed(1)}x`.padStart(9)}`);
    L.push('');
  }
  const failed = rows.filter((r) => !r.ok && !r.asked).length;
  L.push(`${rows.length} commands logged, ${failed} failed.`);
  return L.join('\n');
}
