// Dot-grid background (idea from Magic UI "Dot Pattern"): a faint grid, plus dots that appear, drift across
// the grid on their own, and fade away, endlessly. One canvas behind the window; idles when unfocused.
export function mountDots() {
  const c = document.createElement('canvas');
  c.id = 'dots';
  document.body.prepend(c);
  const ctx = c.getContext('2d');
  const GAP = 20;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];
  let w = 0, h = 0, grid = [], movers = [], raf = 0, last = 0, frame = 0, rgb = '255,255,255', glow = '255,255,255';
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rnd = (a, b) => a + Math.random() * (b - a);

  const colors = () => {
    rgb = document.documentElement.dataset.theme !== 'light' ? '255,255,255' : '20,20,20';
    const a = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const m = /^#([0-9a-f]{6})$/i.exec(a);
    glow = m ? [16, 8, 0].map((s) => (parseInt(m[1], 16) >> s) & 255).join(',') : rgb;
  };
  const spawn = (m = {}) => {
    const d = DIRS[(Math.random() * DIRS.length) | 0], sp = rnd(7, 18);
    m.x = (Math.random() * (w / GAP | 0)) * GAP + GAP / 2;
    m.y = (Math.random() * (h / GAP | 0)) * GAP + GAP / 2;
    m.vx = d[0] * sp; m.vy = d[1] * sp;
    m.age = 0; m.life = rnd(4, 9); m.r = rnd(1.1, 2.1); m.hot = Math.random() < 0.35;
    return m;
  };
  const build = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = innerWidth; h = innerHeight;
    c.width = w * dpr; c.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    grid = [];
    for (let y = GAP / 2; y < h; y += GAP) for (let x = GAP / 2; x < w; x += GAP) grid.push({ x, y, p: Math.random() * 6.283, s: 0.2 + Math.random() * 0.5 });
    const n = Math.max(24, Math.round((w * h) / 4200));
    movers = Array.from({ length: n }, () => { const m = spawn(); m.age = Math.random() * m.life; return m; });
    draw(0, 0);
  };
  const draw = (t, dt) => {
    if (!(frame++ % 90)) colors();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = `rgba(${rgb},0.075)`;
    for (const d of grid) { // the grid itself breathes very slightly
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t * 0.0008 * d.s + d.p);
      ctx.fillRect(d.x - 0.8, d.y - 0.8, 1.6, 1.6);
    }
    ctx.globalAlpha = 1;
    for (const m of movers) {
      m.age += dt; m.x += m.vx * dt; m.y += m.vy * dt;
      if (m.age >= m.life || m.x < -10 || m.y < -10 || m.x > w + 10 || m.y > h + 10) { spawn(m); continue; }
      const k = Math.sin((m.age / m.life) * Math.PI); // fade in, then out
      ctx.fillStyle = `rgba(${m.hot ? glow : rgb},${(m.hot ? 0.55 : 0.28) * k})`;
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 6.283); ctx.fill();
    }
  };
  const loop = (t) => {
    raf = requestAnimationFrame(loop);
    if (t - last < 40 || document.hidden || !document.hasFocus()) return; // ~25fps, idle when unfocused
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    draw(t, dt);
  };
  build();
  addEventListener('resize', build);
  if (!still) raf = requestAnimationFrame((t) => { last = t; loop(t); });
  return () => { cancelAnimationFrame(raf); c.remove(); };
}
