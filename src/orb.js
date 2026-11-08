// Live orb: an evenly lit WebGL sphere with two capsule eyes that follow the pointer and glance around when it rests.
// Ported from the "live-orb" React component to plain JS. White on dark themes, black on light ones.
// Lighter than the original: frames are only drawn while the window is focused and visible, and small orbs run at ~30 fps.
const WHITE = { color: '#F4F4F5', eye: '#09090B' };
const BLACK = { color: '#18181B', eye: '#F4F4F5' };
const IDLE_MS = 3000;
const REST_LOOK = { x: 0, y: 0.08 };

const VERT = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;
const FRAG = `
precision highp float;
uniform vec2 u_resolution;
uniform vec2 u_look;
uniform float u_blink;
uniform vec3 u_body;
uniform vec3 u_eye;
vec3 orient(vec3 p, vec2 look) {
  float yaw = look.x * 0.92;
  float pitch = -look.y * 0.78;
  float cy = cos(yaw), sy = sin(yaw), cp = cos(pitch), sp = sin(pitch);
  vec3 q = vec3(p.x, p.y * cp - p.z * sp, p.y * sp + p.z * cp);
  return vec3(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy);
}
float eyeMask(vec3 n, vec3 e, vec3 right, vec3 up, float halfH, float rad) {
  float facing = dot(n, e);
  float x = dot(n, right) - dot(e, right);
  float y = dot(n, up) - dot(e, up);
  y -= clamp(y, -halfH, halfH);
  float d = length(vec2(x, y)) - rad;
  float fill = 1.0 - smoothstep(-0.01, 0.01, d);
  return fill * smoothstep(0.12, 0.32, facing);
}
void main() {
  vec2 uv = (gl_FragCoord.xy / u_resolution.xy) * 2.0 - 1.0;
  uv.x *= u_resolution.x / max(u_resolution.y, 1.0);
  vec2 p = uv / 0.94;
  float r2 = dot(p, p);
  float edge = 1.0 - smoothstep(0.985, 1.012, sqrt(max(r2, 0.0)));
  if (edge <= 0.001) { gl_FragColor = vec4(0.0); return; }
  vec3 n = normalize(vec3(p, sqrt(max(1.0 - r2, 0.0))));
  vec2 look = u_look;
  float lm = length(look);
  if (lm > 1.0) look /= lm;
  vec3 right = orient(vec3(1.0, 0.0, 0.0), look);
  vec3 up = orient(vec3(0.0, 1.0, 0.0), look);
  vec3 eL = orient(normalize(vec3(-0.32, 0.08, 1.0)), look);
  vec3 eR = orient(normalize(vec3(0.32, 0.08, 1.0)), look);
  float halfH = mix(0.128, 0.012, u_blink);
  float rad = mix(0.054, 0.062, u_blink);
  float eyes = max(eyeMask(n, eL, right, up, halfH, rad), eyeMask(n, eR, right, up, halfH, rad));
  gl_FragColor = vec4(clamp(mix(u_body, u_eye, clamp(eyes, 0.0, 1.0)), 0.0, 1.0), edge);
}
`;

const isDark = () => document.documentElement.dataset.theme !== 'light';
function rgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
  return s;
}

/** Returns { destroy() } or null when WebGL is unavailable (the CSS fallback face stays visible then). */
export function createLiveOrb(canvas) {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: false });
  if (!gl) return null;
  let vs, fs, program, buf, U = {}, lost = false, destroyed = false, raf = 0, onScreen = true;
  const look = { ...REST_LOOK }, target = { ...REST_LOOK }, glance = { ...REST_LOOK };
  let last = 0, clock = 0, nextBlink = 1800 + Math.random() * 2400, blinkAt = -1e4, nextGlance = 600 + Math.random() * 900, pointerAt = -Infinity, lastDraw = 0;

  const init = () => {
    vs = compile(gl, gl.VERTEX_SHADER, VERT); fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    program = gl.createProgram();
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
    gl.useProgram(program);
    buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const k of ['u_resolution', 'u_look', 'u_blink', 'u_body', 'u_eye']) U[k] = gl.getUniformLocation(program, k);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, canvas.width, canvas.height);
    return true;
  };
  if (!init()) return null;

  const resize = () => {
    const p = canvas.parentElement; if (!p) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(p.clientWidth * dpr)), h = Math.max(1, Math.floor(p.clientHeight * dpr));
    if (p.clientWidth <= 0 || (w === canvas.width && h === canvas.height)) return false;
    canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h);
    return true;
  };
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  const moving = () => onScreen && !mqReduce.matches && document.visibilityState !== 'hidden' && document.hasFocus();
  const wake = () => { if (raf || destroyed || lost) return; last = performance.now(); raf = requestAnimationFrame(tick); };
  const redraw = () => { if (destroyed || lost) return; cancelAnimationFrame(raf); raf = 0; last = performance.now(); lastDraw = 0; tick(last); };

  const onMove = (e) => {
    const r = canvas.parentElement?.getBoundingClientRect(); if (!r || r.width <= 0) return;
    target.x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2)));
    target.y = Math.max(-1, Math.min(1, (r.top + r.height / 2 - e.clientY) / (window.innerHeight / 2)));
    pointerAt = performance.now();
    if (onScreen) wake();
  };
  addEventListener('pointermove', onMove, { passive: true });

  function tick(now) {
    raf = 0;
    if (lost) return;
    const small = canvas.width < 120; // small orbs: ~30 fps is plenty
    if (small && now - lastDraw < 30 && moving()) { raf = requestAnimationFrame(tick); return; }
    lastDraw = now;
    const dt = Math.min(50, Math.max(0, now - last)); last = now;
    const live = moving(); if (live) clock += dt;
    const reduce = mqReduce.matches;
    const steering = now - pointerAt < IDLE_MS;
    if (!steering && live && clock >= nextGlance) {
      const back = Math.random() < 0.3;
      glance.x = back ? 0 : (Math.random() * 2 - 1) * 0.8; glance.y = back ? 0.08 : (Math.random() * 2 - 1) * 0.5;
      nextGlance = clock + 900 + Math.random() * 2100;
    }
    const goal = steering ? target : reduce ? REST_LOOK : glance;
    const ease = live ? (steering ? 0.16 : 0.1) : 1;
    look.x += (goal.x - look.x) * ease; look.y += (goal.y - look.y) * ease;
    if (!reduce && clock >= nextBlink) { blinkAt = clock; nextBlink = clock + 2200 + Math.random() * 3800; }
    const bt = (clock - blinkAt) / 1000;
    let b = 0;
    if (!reduce) { if (bt < 0.055) b = bt / 0.055; else if (bt < 0.1) b = 1; else if (bt < 0.18) b = 1 - (bt - 0.1) / 0.08; }
    const pal = isDark() ? WHITE : BLACK;
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.u_resolution, canvas.width, canvas.height);
    gl.uniform2f(U.u_look, look.x, look.y);
    gl.uniform1f(U.u_blink, b);
    gl.uniform3f(U.u_body, ...rgb(pal.color));
    gl.uniform3f(U.u_eye, ...rgb(pal.eye));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (live && !destroyed) raf = requestAnimationFrame(tick);
  }

  const ro = new ResizeObserver(() => { if (resize()) redraw(); });
  if (canvas.parentElement) ro.observe(canvas.parentElement);
  const io = new IntersectionObserver(([e]) => { onScreen = e?.isIntersecting ?? true; wake(); });
  io.observe(canvas);
  const onWake = () => wake();
  document.addEventListener('visibilitychange', onWake); addEventListener('focus', onWake);
  const mo = new MutationObserver(redraw); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const onLost = (e) => { e.preventDefault(); lost = true; cancelAnimationFrame(raf); raf = 0; canvas.style.visibility = 'hidden'; };
  const onRestored = () => { if (destroyed || !init()) return; lost = false; canvas.style.visibility = ''; wake(); };
  canvas.addEventListener('webglcontextlost', onLost); canvas.addEventListener('webglcontextrestored', onRestored);
  resize(); wake();

  return {
    destroy() {
      destroyed = true; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); mo.disconnect();
      document.removeEventListener('visibilitychange', onWake); removeEventListener('focus', onWake); removeEventListener('pointermove', onMove);
      canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored);
      gl.deleteProgram(program); gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteBuffer(buf);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
