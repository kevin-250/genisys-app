// Spinning ASCII globe (shown while an agent is on the internet).
// Land: coarse 64x32 equirectangular mask, rows = 5.625° of latitude from 90°N, cols = 5.625° of longitude from 180°W.
const LAND = {
  1: [[23, 28]], 2: [[13, 20], [22, 29], [45, 58]],
  3: [[2, 8], [9, 20], [22, 28], [33, 36], [38, 62]], 4: [[1, 21], [23, 27], [28, 29], [32, 37], [37, 63]],
  5: [[6, 21], [24, 25], [31, 31], [33, 62]], 6: [[8, 20], [31, 31], [32, 60]], 7: [[8, 19], [31, 56]],
  8: [[9, 19], [30, 56], [55, 56]], 9: [[10, 18], [30, 54], [55, 55]], 10: [[11, 17], [29, 54]],
  11: [[12, 16], [29, 42], [44, 47], [48, 53]], 12: [[13, 16], [29, 42], [45, 47], [49, 52]],
  13: [[15, 17], [29, 39], [45, 46], [49, 51]], 14: [[17, 21], [30, 39], [50, 51]], 15: [[17, 23], [33, 39], [50, 56]],
  16: [[17, 24], [34, 39], [51, 58]], 17: [[18, 25], [34, 39], [54, 57]], 18: [[18, 25], [34, 38], [40, 40], [52, 58]],
  19: [[19, 25], [34, 38], [40, 40], [52, 59]], 20: [[19, 24], [34, 37], [52, 59]], 21: [[19, 23], [35, 36], [52, 58]],
  22: [[19, 22], [55, 57], [61, 61]], 23: [[19, 21], [61, 62]], 24: [[19, 20]], 25: [[19, 19]],
  29: [[10, 50]], 30: [[0, 63]], 31: [[0, 63]],
};
const MASK = Array.from({ length: 32 }, (_, r) => {
  const row = new Array(64).fill(false);
  for (const [a, b] of LAND[r] || []) for (let c = a; c <= b; c++) row[c] = true;
  return row;
});
const SHADE = '.:-=+*#%@';

// One frame: w x h characters (chars are ~2x taller than wide, hence the x squeeze).
export function frame(w, h, rot) {
  let out = '';
  const lx = -0.5, ly = -0.4, lz = 0.77; // light from upper-left-front
  for (let j = 0; j < h; j++) {
    const y = (j + 0.5) / h * 2 - 1;
    for (let i = 0; i < w; i++) {
      const x = ((i + 0.5) / w * 2 - 1) * (w / h / 2);
      const r2 = x * x + y * y;
      if (r2 > 1) { out += ' '; continue; }
      const z = Math.sqrt(1 - r2);
      const lat = Math.asin(-y);
      const lon = Math.atan2(x, z) + rot;
      const col = (((Math.floor(((lon / Math.PI + 1) / 2) * 64) % 64) + 64) % 64);
      const row = Math.min(31, Math.max(0, Math.floor((0.5 - lat / Math.PI) * 32)));
      const light = Math.max(0, x * lx + y * ly + z * lz);
      out += MASK[row][col] ? SHADE[Math.min(SHADE.length - 1, 2 + Math.floor(light * 7))] : light > 0.35 ? '·' : ' ';
    }
    out += '\n';
  }
  return out;
}

// Mount a spinning globe in el; returns stop() which leaves the last frame in place.
export function spin(el, w = 34, h = 15) {
  let rot = 0;
  el.textContent = frame(w, h, rot);
  const t = setInterval(() => { rot += 0.12; el.textContent = frame(w, h, rot); }, 80);
  return () => clearInterval(t);
}
