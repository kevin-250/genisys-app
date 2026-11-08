// Matching for remembered commands: "open my Downloads folder" ≈ "open downloads".
const STOP = new Set('a an the my me i to in on of for and or please pls can you could would just now this that it is be with from'.split(' '));

export const keyOf = (task) =>
  [...new Set(task.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)))].sort().join(' ');

// Jaccard overlap of the two word sets, 0..1.
export function score(a, b) {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

export const MATCH = 0.6;

// Saved .bat file name for a memory row: <task-slug>-<id>.bat
export const batName = (m) => `${m.task.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task'}-${m.id}.bat`;

// Spotify search links need %20 for spaces; a "+" is searched literally ("my+dear+element").
export const fixCmd = (c) => c
  .replace(/spotify:search:([^"\r\n&]*)/gi, (m, q) => `spotify:search:${q.trim().replace(/[+\s]+/g, '%20')}`)
  .replace(/(open\.spotify\.com\/search\/)([^"\s&?]*)/gi, (m, a, q) => a + q.replace(/\+/g, '%20'));
