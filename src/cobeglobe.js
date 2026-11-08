// Pulsing 3D globe (the "cobe" library) shown while the agent is on the internet. Ported from the GlobePulse React component.
// Loaded on demand; if the package is missing, the caller falls back to the old ASCII globe.
const CITIES = [[51.51, -0.13], [40.71, -74.01], [35.68, 139.65], [-33.87, 151.21], [-1.29, 36.82], [19.43, -99.13], [28.61, 77.21], [-23.55, -46.63], [55.75, 37.62], [1.35, 103.82]];

export async function mountGlobe(host, size = 120) {
  const { default: createGlobe } = await import('cobe');
  const markers = [...CITIES].sort(() => Math.random() - 0.5).slice(0, 5).map((location, i) => ({ id: `gp${Date.now() % 1e6}-${i}`, location, delay: i * 0.45 }));
  const wrap = document.createElement('div');
  wrap.className = 'cglobe';
  wrap.style.width = wrap.style.height = `${size}px`;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;opacity:0;transition:opacity 1s ease;border-radius:50%;touch-action:none';
  wrap.append(canvas);
  for (const m of markers) {
    const d = document.createElement('div');
    d.className = 'cg-mark';
    d.style.cssText = `position:absolute;position-anchor:--cobe-${m.id};bottom:anchor(center);left:anchor(center);translate:-50% 50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;pointer-events:none;opacity:var(--cobe-visible-${m.id},0);filter:blur(calc((1 - var(--cobe-visible-${m.id},0)) * 8px));transition:opacity .4s,filter .4s`;
    d.innerHTML = `<span class="cg-ring" style="animation-delay:${m.delay}s"></span><span class="cg-ring" style="animation-delay:${m.delay + 0.5}s"></span><span class="cg-dot"></span>`;
    wrap.append(d);
  }
  host.append(wrap);
  const w = size;
  const globe = createGlobe(canvas, {
    devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2), width: w, height: w,
    phi: 0, theta: 0.2, dark: 1, diffuse: 1.5, mapSamples: 9000, mapBrightness: 10,
    baseColor: [0.5, 0.5, 0.5], markerColor: [0.2, 0.8, 0.9], glowColor: [0.05, 0.05, 0.05], markerElevation: 0,
    markers: markers.map((m) => ({ location: m.location, size: 0.03, id: m.id })),
    arcs: [], arcColor: [0.3, 0.85, 0.95], arcWidth: 0.5, arcHeight: 0.25, opacity: 0.8,
  });
  let phi = 0, raf = 0;
  const loop = () => { phi += 0.012; globe.update({ phi, theta: 0.2 }); raf = requestAnimationFrame(loop); };
  loop();
  setTimeout(() => { canvas.style.opacity = '1'; });
  return () => { cancelAnimationFrame(raf); try { globe.destroy(); } catch {} wrap.remove(); };
}
