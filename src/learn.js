// Learning about the user, the way a good personal assistant (or Claude's memory) does: from what the user SAYS, keep a
// short list of lasting things (who they are, preferences, people, places, routines, goals), and from what they DO,
// their habits. Pure helpers (tested in learn.test.mjs); main.js runs the model call and stores the result.

export const KINDS = ['fact', 'preference', 'interest', 'person', 'place', 'routine', 'goal'];

export const LEARN_SYSTEM = `You keep a small memory about the user of a PC assistant, like a thoughtful personal assistant would.
From the user's messages, write down LASTING things worth remembering:
- who they are: name, job or studies, where they live, languages they use
- preferences: apps they use for what, music and film taste, how they like answers, habits of work
- interests and goals
- people they mention, with how they relate (friend, mom, colleague) and how they reach them
- places that matter to them, routines (when they wake up, work, pray, go to the gym)
Rules:
- Only what the USER said or clearly showed again and again. Never invent. Never one-off tasks ("open chrome", "set a timer").
- Never passwords, codes, card or account numbers, or anything secret.
- Skip anything already in ALREADY KNOWN. If something they said CHANGES a known fact, write the new version.
- Short, specific, third person: "Watches series in PotPlayer", "Has a friend called Kevin, messages him on WhatsApp".
Output ONLY a JSON array, at most 6 items, [] when there is nothing new:
[{"kind":"fact|preference|interest|person|place|routine|goal","text":"..."}]`;

export function learnMessages(known, texts) {
  const k = known.length ? known.map((p) => `- ${p.kind}: ${p.text}`).join('\n') : '(nothing yet)';
  return [
    { role: 'system', content: LEARN_SYSTEM },
    { role: 'user', content: `ALREADY KNOWN:\n${k}\n\nTHE USER'S MESSAGES (oldest first):\n${texts.map((t) => `- ${String(t).slice(0, 300)}`).join('\n')}` },
  ];
}

const SECRET = /\b(password|passcode|pin\b|otp|card number|cvv|iban|account number|api key|token)\b|\b\d{12,19}\b/i;
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
// the model's answer -> [{ kind, text }] that are new, valid and safe to keep
export function parseLearned(raw, known = []) {
  let arr;
  try { const s = String(raw); arr = JSON.parse(s.slice(s.indexOf('['), s.lastIndexOf(']') + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const have = new Set(known.map((p) => norm(p.text)));
  const out = [];
  for (const m of arr.slice(0, 8)) {
    const text = String(m?.text || '').trim().replace(/\s+/g, ' ');
    const kind = KINDS.includes(m?.kind) ? m.kind : 'fact';
    if (text.length < 6 || text.length > 200 || SECRET.test(text) || have.has(norm(text))) continue;
    have.add(norm(text));
    out.push({ kind, text });
  }
  return out.slice(0, 6);
}

// What the user DOES, counted (no AI): apps opened most, music asked for, places, people messaged, usual alarm times.
// rows: { apps: [{name, uses}], music: [request], weather: [request], contacts: [request], alarms: [at ms] }
export function habitLines({ apps = [], music = [], weather = [], contacts = [], alarms = [] } = {}) {
  const top = (list, n = 3) => { const c = new Map(); for (const x of list) if (x) c.set(x, (c.get(x) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1]).slice(0, n).filter(([, k]) => k >= 2).map(([x]) => x); };
  const out = [];
  const a = apps.filter((x) => x.uses >= 3).slice(0, 6).map((x) => x.name);
  if (a.length) out.push(`Opens most: ${a.join(', ')}`);
  const mu = top(music.map((r) => (/query ([^,]+)/.exec(r) || [])[1]?.trim()));
  if (mu.length) out.push(`Music they ask for: ${mu.join(', ')}`);
  const pl = top(weather.map((r) => (/place ([^,]+)/.exec(r) || [])[1]?.trim()));
  if (pl.length) out.push(`Places they check the weather for: ${pl.join(', ')}`);
  const to = top(contacts.map((r) => (/to ([^,]+)/.exec(r) || [])[1]?.trim()), 4);
  if (to.length) out.push(`People they message: ${to.join(', ')}`);
  const hm = top(alarms.map((t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), 2);
  if (hm.length) out.push(`Usual alarm time: ${hm.join(' or ')}`);
  return out;
}
