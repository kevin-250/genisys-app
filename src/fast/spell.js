// Typo fixing for commands: "remider me tomorow to cal mom", "set a timmer for 5 minuets", "show me callender", "hellohiwhat time is it".
// Only words Genisys LISTENS for are targets (the command vocabulary below + names it knows), so names, song titles, Kinyarwanda,
// file names and note text are never "corrected" into something else. intent.js keeps a fix only when it is understood better.
// Pure code, no I/O: the same input always gives the same output.
import { editDist } from '../fuzzy.js';

// The words the parsers react to. Order = how common they are in commands (earlier wins a tie).
const COMMAND_WORDS = `
set timer timers alarm alarms reminder reminders remind stopwatch countdown cancel stop pause resume continue delete remove clear
show open close play search find what whats when where which how many much time today tomorrow tonight morning afternoon evening
minute minutes second seconds hour hours week weeks month months year years day days next last every daily weekly
note notes list shopping grocery groceries todo calendar weather umbrella rain forecast temperature music song songs video videos
movie movies volume mute unmute louder quieter brightness screenshot shutdown restart sleep lock battery memory using running
create make folder file files document documents desktop downloads pictures photos picture write read rename move copy send message
email whatsapp spotify youtube google chrome edge firefox explorer settings notepad calculator word excel powerpoint outlook teams
called named wake please could would should start begin finish reset snooze turn on off up down again previous skip shuffle repeat
coin flip dice roll random number calculate percent tip discount until christmas birthday weekend world new york london paris tokyo
tell give check add put take call text open launch visit watch listen speak translate define meaning spell convert brief briefing
overview everything another other first second third about with without from into inside latest newest oldest biggest smallest
monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december
hello thanks thank good night bye goodbye yes no okay sure right left kigali rwanda nairobi kampala
date dark light mode wifi bluetooth camera screen disturb some this that there your have been long many pick between convert dollars
music song sound loud speaker headphones mic microphone notification notifications update install uninstall app apps
times plus minus divided multiplied over squared root half double name named rename computer laptop count setup upcoming coming
chill relaxing gospel playlist album artist radio podcast film films episode series season trailer
free space disk storage drive square root will rain sunny cold hot weather from
`;
// Common real words that sit one typo away from a command word: never "correct" these (tea is not "team", rent is not "sent").
const REAL = `
tea team mom dad rent sent bread break tent test text best rest list lost last fast past cast vast cost post host most must mist
call cell ball tall wall fall hall mall bill pill fill will till kill lime line mine nine fine wine dine time tile tide side wide
ride hide note node nose rose dose hose more made male mail sail tail fail rail pail paint plant plans plane place
song sing ring king wing thing long along belong word work world worm farm warm ward card hard yard wood good food
mood moon soon noon note show shoe slow snow know now new news few dew sew saw raw law paw day way say pay may lay bay ray hay
mouse house horse alarm alert alter after other otter offer timer tiger tighter mute mate cute cure pure sure lure rule mule
stop shop step stem stew star start stare store story stork storm short sport spot slot plot shot hot not got lot dot
open oven over ever even seven eleven eve cloud could would should shout about above
the and for are but not you all any can had her was one our out get has him his man old see two who boy did its let put say she
too use cup car bus job fun big bad red sun sea air art yet ago bed box cat dog egg eye far fit fix fly got gym hat ice key kid law
leg lie low map mix net nor oil own pen pet pie pot run sad sat sit six sky son ten tie tip toe top toy try war wet win won zoo
pls plz thx btw lol omg idk tho cos bro sis mum pop doc bag pan pin cap tap lap nap gap rap sap dip hip lip rip sip zip jam ham
remainder playlist something everyone anything nothing without within cannot into onto notebook timetable everyday
`;
const VOCAB = new Map(); // word -> rank (lower = more common)
for (const w of COMMAND_WORDS.split(/\s+/).filter(Boolean)) if (!VOCAB.has(w)) VOCAB.set(w, VOCAB.size);
const KEEP = new Set(REAL.split(/\s+/).filter(Boolean));

// QWERTY neighbours: a slip onto the next key is the most common typo, so it wins ties ("timwr" -> timer, not "times").
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const POS = {}; ROWS.forEach((r, y) => [...r].forEach((c, x) => { POS[c] = [x + y * 0.5, y]; }));
const near = (a, b) => { const p = POS[a], q = POS[b]; return !!p && !!q && Math.abs(p[0] - q[0]) <= 1.5 && Math.abs(p[1] - q[1]) <= 1; };
// How "human" a one-edit typo is: same-length with a neighbouring key or a swap = 0 (best), otherwise 1.
function slip(t, w) {
  if (t.length !== w.length) return 1;
  const diff = [...t].map((c, i) => (c === w[i] ? -1 : i)).filter((i) => i >= 0);
  if (diff.length === 1) return near(t[diff[0]], w[diff[0]]) ? 0 : 1;
  if (diff.length === 2 && diff[1] === diff[0] + 1 && t[diff[0]] === w[diff[1]] && t[diff[1]] === w[diff[0]]) return 0;
  return 1;
}
const allowed = (len) => (len <= 3 ? 0 : len <= 6 ? 1 : 2); // short words: too many real words are one letter apart

// One word -> its likely fixes, best first ([] = leave it). extra: more known targets (app names, list names, contacts…).
export function fixWords(token, extra) {
  const t = token.toLowerCase();
  if (!/^[a-z]+$/.test(t) || VOCAB.has(t) || KEEP.has(t) || extra?.has(t)) return [];
  // a real word made from a known one ("rwandan", "named", "playing", "reminded"): not a typo
  // (long suffixes only: "timeer", "coinn", "musicd" ARE typos)
  const stem = /^(.{4,}?)(an|ian|ese|ish|ed|ing|ly|al)$/.exec(t);
  if (stem && stem[1].slice(-1) !== stem[2][0] && (VOCAB.has(stem[1]) || KEEP.has(stem[1]) || VOCAB.has(`${stem[1]}e`))) return [];
  if (/an$/.test(t) && VOCAB.has(t.slice(0, -1))) return []; // "rwandan", "kenyan": people of a place
  const squeezed = t.replace(/(.)\1{2,}/g, '$1$1'); // "tiiimer" -> "tiimer", "pleaseee" -> "pleasee"
  if (squeezed !== t) for (const s of [squeezed, squeezed.replace(/(.)\1/g, '$1')]) if (VOCAB.has(s)) return [s];
  // 3 letters: only a dropped letter of a 4-letter command word, same first letter ("sop" -> stop, "wak" -> wake)
  if (t.length === 3) {
    return [...VOCAB.keys()].filter((w) => w.length === 4 && w[0] === t[0] && [0, 1, 2, 3].some((i) => w.slice(0, i) + w.slice(i + 1) === t))
      .sort((x, y) => VOCAB.get(x) - VOCAB.get(y)).slice(0, 2);
  }
  const max = allowed(t.length);
  if (!max) return [];
  const found = [];
  const consider = (w) => {
    if (Math.abs(w.length - t.length) > max || (w[0] !== t[0] && !(t[1] === w[0] && t[0] === w[1]))) return; // a typo rarely hits the FIRST letter
    const d = editDist(t, w, max);
    if (d <= max) found.push({ w, score: d * 10 + slip(t, w) * 3 + Math.min(VOCAB.get(w) ?? 400, 400) / 200 });
  };
  for (const w of VOCAB.keys()) consider(w);
  if (extra) for (const w of extra) if (/^[a-z]{4,}$/.test(w) && !VOCAB.has(w)) consider(w);
  found.sort((a, b) => a.score - b.score);
  // only fixes as good as the best one (one edit beats two): "timed" -> timer / time, both kept for the parser to choose
  return found.filter((f) => f.score < found[0].score + 5).slice(0, 3).map((f) => f.w);
}
export const fixWord = (token, extra) => fixWords(token, extra)[0] || null;

// "remindme", "hellohiwhat", "setalarm": glued words split into known words (2 or 3 parts, every part known).
export function splitGlued(token, extra) {
  const t = token.toLowerCase();
  if (t.length < 7 || !/^[a-z]+$/.test(t) || VOCAB.has(t) || KEEP.has(t) || extra?.has(t)) return null;
  const known = (w) => VOCAB.has(w) || KEEP.has(w) || SMALL.has(w) || extra?.has(w);
  for (let i = 2; i <= t.length - 2; i++) {
    const a = t.slice(0, i), b = t.slice(i);
    if (known(a) && known(b)) return `${a} ${b}`;
  }
  for (let i = 2; i < t.length - 3; i++) for (let j = i + 2; j <= t.length - 2; j++) {
    const a = t.slice(0, i), b = t.slice(i, j), c = t.slice(j);
    if (known(a) && known(b) && known(c)) return `${a} ${b} ${c}`;
  }
  return null;
}
const SMALL = new Set('a an i me my the to at in on of for is it be do go up hi we us so or and all any can set get put'.split(' '));

// Where the user's own words start (a name, a title): nothing after these is touched.
const CONTENT_AFTER = /^(?:called|named|titled|saying|says|text|message|type|write|search|google|lookup|predict|why)$/; // a web search's words go as typed (the site fixes them)

// A whole request -> the ways it may have been meant, best first: [fixed text, other readings…]. [text] when nothing needed fixing.
// Quotes, paths, URLs, numbers, capitalised words after the start (names, titles) and the user's own text
// (after "called", "remind me … to", "note that", "play" + an unknown word) are left exactly as typed.
// Speech-to-text hears a command word as other real words ("set a remind her", "set a time a for 5 minutes").
// Offered as one more reading: intent.js keeps it only when it is understood better than the words as heard.
const SOUNDS_LIKE = [[/\bremind (?:her|or)\b/gi, 'reminder'], [/\btime (?:a|er|r)\b(?= (?:for|called|named|of)\b)/gi, 'timer'],
  [/\b(?:a|the) time a\b/gi, 'a timer'], [/\bwhether\b(?= (?:in|for|today|tomorrow|tonight|like|forecast)\b)/gi, 'weather'],
  [/\ba lamb?\b(?= (?:at|for)\b)/gi, 'alarm'], [/\bset a lamb?\b/gi, 'set alarm']];
const soundsLike = (s) => SOUNDS_LIKE.reduce((t, [re, w]) => t.replace(re, () => w), s);

export function spellVariants(text, extra) {
  const v = typoVariants(text, extra), heard = soundsLike(String(text ?? ''));
  return heard === String(text ?? '') ? v : [...v, ...typoVariants(heard, extra).filter((x) => !v.includes(x))];
}

function typoVariants(text, extra) {
  const src = String(text ?? '');
  if (!src.trim()) return [src];
  const parts = src.split(/(\s+)/);
  const alts = []; // [index, other word]
  let content = false, label = false, quote = false, changed = false;
  for (let i = 0; i < parts.length; i += 2) {
    const raw = parts[i];
    if (!raw) continue;
    // a NAME ("called eggs") ends at "and" / "then": "…called eggs and a 4 minuet timer called rice" has more to fix
    if (label && /^(?:and|then)$/i.test(raw)) { content = false; label = false; continue; }
    if (/^["“]/.test(raw) && raw.length > 1) quote = true;
    const m = /^([^A-Za-z]*)([A-Za-z]+)((?:'[A-Za-z]{1,2})?[^A-Za-z]*)$/.exec(raw); // "wgat's" -> wgat + 's
    const skip = quote || content || !m || /[\\/@]|\w[:.]\w/.test(raw); // paths, urls, emails, 6:30, file.txt
    if (/["”]$/.test(raw)) quote = false;
    if (skip) continue;
    const word = m[2], lower = word.toLowerCase();
    if (i > 0 && /^[A-Z][a-z]/.test(word)) continue; // "Kevin", "Free Guy": a name
    const prev = String(parts[i - 2] || '').toLowerCase();
    // "play <title>": a word Genisys does not know right after play is the start of a title, not a typo
    if (prev === 'play' && !VOCAB.has(lower) && !fixWords(word, extra).length) { content = true; continue; }
    const cands = fixWords(word, extra);
    const fixed = cands[0] || splitGlued(word, extra);
    if (fixed) { parts[i] = m[1] + fixed + m[3]; changed = true; for (const c of cands.slice(1)) alts.push([i, m[1] + c + m[3]]); }
    const now = (fixed || lower).toLowerCase();
    if (/^(?:called|named|titled)$/.test(now) || (now === 'it' && /^(?:name|call)$/.test(prev))) content = label = true; // "name it workout"
    else if (CONTENT_AFTER.test(now) || (now === 'to' && /\bremind/i.test(parts.slice(0, i).join(''))) || (now === 'that' && /^notes?$/.test(prev))) content = true;
  }
  if (!changed) return [src];
  const best = parts.join('');
  return [best, ...alts.map(([i, w]) => { const p = parts.slice(); p[i] = w; return p.join(''); })];
}
export const fixSpelling = (text, extra) => spellVariants(text, extra)[0];
