// Siri-style everyday tools: timers, alarms, stopwatch, notes, quick answers. Same shape as Siri: one verb plus the
// details pulled out of the sentence, a one-line confirmation, and follow-ups ("cancel it", "how long left").
// Pure parsers, tested in siri.test.mjs; the actions are in actions.js, the clocks in main.js.

const NUM = String.raw`(\d+(?:\.\d+)?|half\s+an?|an?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty five|forty|sixty|half)`;
const NUMV = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty five': 45, sixty: 60, half: 0.5, 'half a': 0.5, 'half an': 0.5 };
const numOf = (s) => NUMV[String(s).toLowerCase().replace(/\s+/g, ' ')] ?? Number(s);
const SECS = (u) => (/^h/i.test(u) ? 3600 : /^m/i.test(u) ? 60 : 1);

// "10 minutes", "1 hour 30 minutes", "90 seconds", "an hour and a half" -> seconds
export function durationOf(text) {
  const s = String(text);
  let total = 0, hit = false;
  // "1 upcoming minute", "3 more minutes": a filler word between the number and the unit is fine
  const re = new RegExp(String.raw`\b${NUM}\s*-?\s*(?:(?:more|upcoming|next|extra|coming|whole|full)\s+)?(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b`, 'gi');
  for (const m of s.matchAll(re)) {
    if (!/\d/.test(m[1]) && !/\s/.test(m[0].slice(m[1].length))) continue; // "am" is not "a m(inute)": word numbers need a space
    total += numOf(m[1]) * SECS(m[2]); hit = true;
  }
  const half = /(hours?|minutes?)\s+and\s+a\s+half/i.exec(s);
  if (hit && half) total += SECS(half[1]) / 2;
  return hit && total > 0 ? Math.round(total) : null;
}

const clockAt = (h, mi, ap, now) => {
  h = Number(h); mi = Number(mi || 0); ap = String(ap || '').toLowerCase().replace(/\./g, '');
  if (h > 23 || mi > 59) return null;
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  const d = new Date(now); d.setHours(h, mi, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
};

// The name the user gave a timer or alarm, and the sentence without it (so a name like "set 2" never reads as a time):
// "… and name it workout", "called tea", "named gym", "label it pasta", "a workout timer", "timer for the rice"
const NOT_NAME = /^(a|an|the|my|one|new|another|second|quick|short|long|countdown|count|\d.*)$/;
// the name ends where the time part starts: "called eat at today 23:10", "named gym for 6 am", "called tea in 5 minutes"
const TIME_START = String.raw`(?=\s+(?:at|for|in|on|by|from|every|today|tonight|tomorrow|this|next|\d)\b|\s*$)`;
export function nameOf(t) {
  const end = /[,\s]+(?:and\s+)?(?:name|call|label|title)\s+(?:it|this|that|the\s+(?:timer|alarm))?\s*(?:as\s+)?["']?([a-z0-9][\w '-]{0,30}?)["']?\s*$/.exec(t);
  if (end) return { name: end[1].trim(), rest: t.slice(0, end.index).trim() };
  const mid = new RegExp(String.raw`[,\s]+(?:called|named|labell?ed|titled)\s+["']?([a-z][\w'-]*(?:\s+(?!at\b|for\b|in\b|on\b|by\b|from\b|every\b|today\b|tonight\b|tomorrow\b|this\b|next\b)[a-z][\w'-]*){0,3}?)["']?${TIME_START}`).exec(t);
  if (mid) return { name: mid[1].trim(), rest: (t.slice(0, mid.index) + t.slice(mid.index + mid[0].length)).replace(/\s+/g, ' ').trim() };
  const pre = /\b(?:a|an|the|my|new)\s+([a-z]+(?:\s[a-z]+)?)\s+(?:timer|alarm|countdown)\b/.exec(t);
  if (pre && !NOT_NAME.test(pre[1]) && !/\b(minute|second|hour|min|sec)s?\b/.test(pre[1])) return { name: pre[1], rest: t };
  return { name: '', rest: t };
}

// -> { action: 'timer'|'alarm'|'stopwatch', params } or null
// Common misspellings of the words the tools listen for ("stop that remider", "show me callender"). Whole words only;
// never "remainder" (a real math word).
const TYPOS = [[/\b(?:remider|remide|reminer|remindr|reminde|remindar|rimender|remaider)(s?)\b/gi, 'reminder$1'], [/\b(?:alram|alarn|allarm|alrm|alarme)(s?)\b/gi, 'alarm$1'],
  [/\b(?:timmer|timr|tymer)(s?)\b/gi, 'timer$1'], [/\b(?:callender|calender|calander|calandar|calendr|callendar)(s?)\b/gi, 'calendar$1'],
  [/\b(?:stopwach|stopwatc|stop wach)\b/gi, 'stopwatch'], [/\b(?:shoping|shoppin)\b/gi, 'shopping']];
export function fixTypos(text) { let s = String(text ?? ''); for (const [re, to] of TYPOS) s = s.replace(re, (_, pl = '') => to.split('$1').join(pl)); return s; }

// "cancel the water the plants reminder" / "cancel my reminder to pay rent" / "delete the alarm called gym" -> { label }
const CANCEL_VERB = '(?:cancel|delete|remove|clear|stop|turn off|dismiss|forget|drop)';
function cancelLabel(t, word, name) {
  if (name) return { label: name };
  const m = new RegExp(String.raw`\b${word}s?\s+(?:to|about|called|named)\s+(.+)$`).exec(t) || new RegExp(String.raw`\b${CANCEL_VERB}\s+(?:the|my)\s+(.+?)\s+${word}s?$`).exec(t);
  const v = m?.[1]?.trim();
  return v && !/^(?:that|this|it|all|every|both|next|last|first|(?:\d+|one|two)(?:st|nd|rd|th)?)$/.test(v) ? { label: v } : {};
}

export function parseClock(text, now = new Date()) {
  const full = fixTypos(String(text || '')).trim().toLowerCase().replace(/[.!?]+$/, '').replace(/^(?:hey\s+genisys[, ]+|please\s+|can you\s+|could you\s+)/, '');
  const { name, rest: t } = nameOf(full);
  if (/\bstop ?watch\b/.test(t)) {
    if (/\b(start|begin|run)\b/.test(t)) return { action: 'stopwatch', params: { op: 'start' } };
    if (/\b(stop|end|pause|finish)\b/.test(t)) return { action: 'stopwatch', params: { op: 'stop' } };
    if (/\b(reset|clear|cancel)\b/.test(t)) return { action: 'stopwatch', params: { op: 'reset' } };
    return { action: 'stopwatch', params: { op: 'status' } };
  }
  // "set a time for 2 minutes" (timer with its r missing) is a timer too
  if (/\btimers?\b/.test(t) || /\bcount ?down\b/.test(t) || (/^(?:set|start)\s+(?:a\s+|the\s+)?time\s+(?:for|of)\s+/.test(t) && durationOf(t))) {
    // "pause the rice timer" / "resume my timer" / "cancel the tea timer": that one by name, else all of them
    const which = (/\b(?:the|my)\s+([a-z][a-z ]{0,20}?)\s+timer\b/.exec(t) || [])[1];
    const by = which && !NOT_NAME.test(which) ? { label: which } : {};
    if (/\b(pause|hold|freeze)\b/.test(t)) return { action: 'timer', params: { op: 'pause', ...by } };
    if (/\b(resume|continue|unpause|restart|start again)\b/.test(t)) return { action: 'timer', params: { op: 'resume', ...by } };
    const every = !by.label && /\b(all|every|both)\b/.test(t) ? { all: 'yes' } : {}; // "cancel all timers": no "which one?"
    if (/\b(cancel|stop|delete|remove|clear|turn off)\b/.test(t)) return { action: 'timer', params: { op: 'cancel', ...by, ...every } };
    if (/\b(how (much|long)|time left|remaining|left on)\b/.test(t) || /^(?:my\s+)?timers?$/.test(t) || /\bwhat timers\b/.test(t)) return { action: 'timer', params: { op: 'status' } };
    const s = durationOf(t);
    if (!s) {
      // "timer for 5:50 pm" / "timer until 6 pm" / "timer for 5.50 today, pm": a countdown to that clock time, worked out
      // here from the PC clock (the AI got this wrong: it said 5:50 pm had passed at 17:49)
      const c = /\b(?:for|at|until|till|to)\s+(?:today\s+(?:at\s+)?)?(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?=[\s,]|$)/.exec(t);
      const ap = c ? (c[3] || (/\b(pm|tonight|evening|afternoon)\b/.test(t) ? 'pm' : /\b(am|morning)\b/.test(t) ? 'am' : '')) : '';
      if (!c || (!ap && !c[2])) return null; // "timer for 5" alone: minutes or a time? the AI asks
      const h = Number(c[1]), mi = Number(c[2] || 0);
      // no am/pm: the next one of the two (5:50 at 17:49 is in a minute, not tomorrow morning)
      const at = ap || h > 12 ? clockAt(h, mi, ap, now) : Math.min(clockAt(h, mi, 'am', now) ?? Infinity, clockAt(h, mi, 'pm', now) ?? Infinity);
      if (!Number.isFinite(at)) return null;
      const H = ap ? (ap.startsWith('p') && h < 12 ? h + 12 : ap.startsWith('a') && h === 12 ? 0 : h) : new Date(at).getHours();
      if (/\b(today|tonight)\b/.test(t) && new Date(at).toDateString() !== now.toDateString()) return { action: 'alarm', params: { op: 'ask', h: H, m: mi, past: 'yes', ...(name ? { label: name } : {}) } };
      return { action: 'timer', params: { op: 'set', seconds: Math.max(1, Math.round((at - now.getTime()) / 1000)), ...(name ? { label: name } : {}) } };
    }
    const rest = t.replace(new RegExp(String.raw`\b(?:for\s+)?${NUM}\s*-?\s*(?:(?:more|upcoming|next|extra|coming|whole|full)\s+)?(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b`, 'g'), ' ').replace(/\s+/g, ' ').trim();
    const lab = name || (/\bfor\s+(?:the\s+|my\s+)?([a-z][a-z ]{1,30})$/.exec(rest) || [])[1]?.trim() || '';
    return { action: 'timer', params: { op: 'set', seconds: s, ...(lab ? { label: lab } : {}) } };
  }
  if (/\balarms?\b|\bwake me( up)?\b/.test(t)) {
    if (/\b(cancel|delete|remove|turn off|stop|clear)\b/.test(t)) return { action: 'alarm', params: { op: 'cancel', ...cancelLabel(t, 'alarm', name) } };
    if (/\b(what|which|show|list|any)\b/.test(t) && !/\d/.test(t)) return { action: 'alarm', params: { op: 'list' } };
    // "alarm in / for 3 minutes": that is a countdown, so it is a timer (rings in 3 minutes, not tomorrow)
    const rel = durationOf(t);
    if (rel) return { action: 'timer', params: { op: 'set', seconds: rel, label: name || 'alarm' } };
    const m = /\b(\d{1,2})(?:[:.h](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?=\s|$)/.exec(t.replace(/\b(?:tomorrow|today|tonight)\b/g, ' '));
    if (!m) return null; // no time at all: the AI asks for one
    const lab = name ? [0, name] : /\bto\s+([a-z][a-z ]{2,30})$/.exec(t);
    const h = Number(m[1]), mi = Number(m[2] || 0);
    let ap = m[3] || (/\b(tonight|evening|night|afternoon|pm)\b/.test(t) ? 'pm' : /\b(morning|am)\b/.test(t) ? 'am' : '');
    // "7" alone: 7 in the morning or the evening, today or tomorrow? Ask, like a phone would, never guess.
    if (!ap && h >= 1 && h <= 12) return { action: 'alarm', params: { op: 'ask', h, m: mi, ...(/\btomorrow\b/.test(t) ? { day: 'tomorrow' } : /\btoday|tonight\b/.test(t) ? { day: 'today' } : {}), ...(lab ? { label: lab[1].trim() } : {}) } };
    let at = clockAt(h, mi, ap, now);
    if (!at) return null;
    // an explicit day wins over "the next one"
    if (/\btomorrow\b/.test(t) && new Date(at).toDateString() === now.toDateString()) at += 864e5;
    if (/\b(today|tonight)\b/.test(t) && new Date(at).toDateString() !== now.toDateString()) return { action: 'alarm', params: { op: 'ask', h: ap === 'pm' && h < 12 ? h + 12 : h, m: mi, past: 'yes', ...(lab ? { label: lab[1].trim() } : {}) } };
    return { action: 'alarm', params: { op: 'set', at, ...(lab ? { label: lab[1].trim() } : {}) } };
  }
  if (/\b(cancel|delete|remove|clear|stop|turn off|dismiss|forget|drop)\b.*\breminders?\b/.test(t)) return { action: 'alarm', params: { op: 'cancel', kind: 'reminder', ...(/\b(all|every|both)\b/.test(t) ? { all: 'yes' } : cancelLabel(t, 'reminder', name)) } };
  if (/\b(what|show|list|any)\b.*\breminders?\b|^(?:my\s+)?reminders$/.test(t)) return { action: 'alarm', params: { op: 'list' } };
  return null;
}

// "take a note buy milk" / "note: call the landlord" / "add eggs to my notes" / "show my notes" -> { op, text? }
// "shopping list", "grocery list", "to do list", "packing list"… -> the list's name
const LIST = String.raw`(shopping|grocery|groceries|to[\s-]?do|todo|packing|reading|watch|movie|wish|gift|work|homework|chores?)\s+list`;
const listName = (w) => { w = w.toLowerCase().replace(/[\s-]/g, ''); return w === 'grocery' || w === 'groceries' ? 'shopping' : w === 'todo' ? 'to-do' : w.replace(/s$/, '') === 'chore' ? 'chores' : w; };
export function parseNote(text) {
  const raw = String(text || '').trim().replace(/[.!]+$/, '');
  const t = raw.toLowerCase();
  // lists: "add eggs and milk to my shopping list", "what's on my shopping list", "remove eggs from my shopping list"
  const ladd = new RegExp(String.raw`^(?:please\s+)?(?:add|put|write)\s+(.+?)\s+(?:to|on|in)\s+(?:my|the)\s+${LIST}$`, 'i').exec(raw);
  if (ladd) return { op: 'add', text: ladd[1].trim(), list: listName(ladd[2]) };
  const lshow = new RegExp(String.raw`^(?:what(?:'s| is)\s+on|show(?:\s+me)?|read(?:\s+me)?|open|check)\s+(?:my|the)\s+${LIST}\??$|^(?:my|the)\s+${LIST}$`, 'i').exec(raw);
  if (lshow) return { op: 'show', list: listName(lshow[1] || lshow[2]) };
  const ldel = new RegExp(String.raw`^(?:remove|delete|take|cross)\s+(.+?)\s+(?:off|from|out of)\s+(?:my|the)\s+${LIST}$`, 'i').exec(raw);
  if (ldel) return { op: 'remove', text: ldel[1].trim(), list: listName(ldel[2]) };
  const lclear = new RegExp(String.raw`^(?:clear|empty|delete)\s+(?:my|the)\s+${LIST}$`, 'i').exec(raw);
  if (lclear) return { op: 'clear', list: listName(lclear[1]) };
  if (/^(?:show|read|open|what(?:'s| is| are)?(?: in)?)\s+(?:me\s+)?(?:my\s+)?(?:genisys\s+)?notes?$/.test(t) || /^(?:my\s+)?notes$/.test(t)) return { op: 'show' };
  const m = /^(?:please\s+)?(?:take|make|write|jot down|create|add)\s+(?:a\s+)?(?:quick\s+)?note(?:\s+(?:that|saying|to))?[:,]?\s+(.+)$/i.exec(raw)
    || /^note(?:\s+that)?[:,]?\s+(.+)$/i.exec(raw)
    || /^(?:add|put|write)\s+(.+?)\s+(?:to|in|on)\s+my\s+notes?$/i.exec(raw);
  return m ? { op: 'add', text: m[1].trim() } : null;
}

// coin, dice, random number, days until a date -> { op, ... } or null
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const HOLI = { christmas: [12, 25], 'new year': [1, 1], 'new years': [1, 1], 'valentines day': [2, 14], halloween: [10, 31] };
export function parseQuick(text, now = new Date()) {
  const t = String(text || '').trim().toLowerCase().replace(/[.!?]+$/, '').replace(/'/g, '');
  if (/\b(flip|toss)\b.*\bcoin\b|^heads or tails$/.test(t)) return { op: 'coin' };
  // "what month is it", "what year is it", "what's the date today", "what week is it": straight from the clock
  const wh = /^(?:what(?:s| is)?\s+)?(?:the\s+)?(?:current\s+)?(month|year|date|day|week(?:\s+number)?)(?:\s+(?:is\s+it|is\s+today|today|now|are\s+we\s+in|is\s+this))*\s*$/.exec(t);
  if (wh) return { op: 'when', what: wh[1].replace(/\s+number/, '') };
  const dice = /\broll\b.*?\b(?:a\s+)?(\d+\s+)?(?:dice|die)\b/.exec(t);
  if (dice) return { op: 'dice', n: Math.min(10, Number(dice[1] || 1)) };
  const rn = /\b(?:pick|choose|give me|random)\b.*\bnumber\b(?:.*?\b(?:between|from)\s+(-?\d+)\s+(?:and|to)\s+(-?\d+))?/.exec(t);
  if (rn) return { op: 'number', min: Number(rn[1] ?? 1), max: Number(rn[2] ?? 100) };
  const du = /^how many (?:days|weeks) (?:until|till|to|before) (?:the\s+)?(.+)$/.exec(t);
  if (du) {
    const what = du[1].replace(/^my\s+/, '').trim();
    let target = null;
    if (HOLI[what]) target = new Date(now.getFullYear(), HOLI[what][0] - 1, HOLI[what][1]);
    else {
      const m = new RegExp(String.raw`^(?:(\d{1,2})\s+(${MONTHS.join('|')})|(${MONTHS.join('|')})\s+(\d{1,2}))`).exec(what);
      if (m) target = new Date(now.getFullYear(), MONTHS.indexOf(m[2] || m[3]), Number(m[1] || m[4]));
    }
    if (target) {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (target < today) target.setFullYear(target.getFullYear() + 1);
      const iso = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
      return { op: 'days_until', what, date: iso };
    }
  }
  return null;
}
// ---- Overview: "show me all my alarms and timers", "what timers and reminders do i have", "my notes and shopping list"
// -> { parts: 'alarms,timers' } when it asks to SEE two or more kinds of things (one grid of small cards), else null
const KINDS_SEEN = [['timers', /\btimers?\b/], ['alarms', /\balarms?\b/], ['reminders', /\breminders?\b/], ['shopping', /\b(?:shopping|grocery)\s+list\b/], ['todo', /\bto[\s-]?do\s+list\b/], ['notes', /\bnotes\b/], ['stopwatch', /\bstop ?watch\b/]];
export function parseOverview(text) {
  const t = String(text || '').toLowerCase().replace(/[.!?]+$/, '');
  if (!/^(?:show|list|see|give|tell|what|which|check|display|open|read)\b|^(?:all|my|everything)\b|\b(?:do i have|have i got|i have)\b/.test(t)) return null;
  if (/\b(set|start|add|create|cancel|delete|remove|pause|resume|stop)\b/.test(t)) return null; // doing something, not looking
  const parts = KINDS_SEEN.filter(([, re]) => re.test(t)).map(([k]) => k);
  if (parts.includes('shopping') || parts.includes('todo')) { const i = parts.indexOf('notes'); if (i >= 0 && !/\bnotes\b(?!\s+list)/.test(t.replace(/\b(?:shopping|grocery|to[\s-]?do)\s+list\b/g, ''))) parts.splice(i, 1); }
  return parts.length >= 2 ? { parts: parts.join(',') } : null;
}

// ---- Media control of what is ALREADY open: "play current movie in potplayer", "pause the music", "resume spotify",
// "next song on vlc". -> { op: play|pause|toggle|next|prev, app? } or null. "play free guy in potplayer" (a title) is NOT
// this: that opens the file. With no app named, it is whatever is playing now.
export const PLAYER_APPS = { potplayer: 'potplayer', 'pot player': 'potplayer', vlc: 'vlc', spotify: 'spotify', youtube: 'browser', 'youtube music': 'browser',
  'media player': 'media player', 'windows media player': 'media player', groove: 'media player', aimp: 'aimp', netflix: 'netflix', chrome: 'browser', edge: 'browser', browser: 'browser', 'the browser': 'browser' };
export function parseMedia(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[.!?]+$/, '').replace(/^(?:please\s+|can you\s+|hey genisys[, ]+)/, '');
  const verb = /^(play|resume|continue|unpause|start playing|keep playing|pause|stop|hold|next|skip|previous|go back to the previous)\b\s*/.exec(t);
  if (!verb) return null;
  const op = /^(play|resume|continue|unpause|start playing|keep playing)$/.test(verb[1]) ? 'play' : /^(pause|stop|hold)$/.test(verb[1]) ? 'pause' : /^(next|skip)$/.test(verb[1]) ? 'next' : 'prev';
  let rest = t.slice(verb[0].length);
  let app = null;
  const a = new RegExp(String.raw`(?:^|\s)(?:in|on|with|using)?\s*(?:the\s+)?(${Object.keys(PLAYER_APPS).sort((x, y) => y.length - x.length).join('|')})(?:\s+app)?$`).exec(rest);
  if (a) { app = PLAYER_APPS[a[1]]; rest = rest.slice(0, a.index); }
  rest = rest.replace(/\b(?:the|my|this|that|current|currently|playing|paused|same|it|again|one|please)\b/g, ' ').replace(/\b(?:movie|film|video|song|music|track|episode|show|series|playback|media|audio|podcast)s?\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (op === 'next' || op === 'prev') rest = rest.replace(/\b(?:song|track|episode|video|one)\b/g, '').trim();
  if (rest) return null; // a title is left ("free guy"): that is opening a file, not controlling the player
  if (!app && !/\b(movie|film|video|song|music|track|episode|show|playback|media|audio|podcast|it)\b/.test(t) && op !== 'next' && op !== 'prev') return null;
  return { op, ...(app ? { app } : {}) };
}

// ---- Calculator: "15% of 2400", "25 times 4", "(3+4)*2", "square root of 81", "2 to the power of 10".
// A small recursive-descent parser (never eval). Anything with other words (units, currency) is not math: null.
export function calc(text) {
  let s = String(text || '').toLowerCase().trim().replace(/[?=!.]+$/, '')
    .replace(/^(?:what(?:'s|\s+is)|whats|how\s+much\s+is|calculate|compute|solve|work\s+out)\s+/, '')
    // "18% tip on 45000", "16% vat of 2000" = a percent of; "20% off 5000" = the price after the discount
    .replace(/(\d+(?:\.\d+)?)\s*(%|percent)\s*(?:a\s+)?(?:tip|tax|vat|service(?:\s+charge)?|commission|interest|discount)\s+(?:on|of|for)\s+/g, '$1 $2 of ')
    .replace(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s*off\s+(?:of\s+)?(\d[\d,]*(?:\.\d+)?)/g, (m, p, v) => { const n = v.replace(/,/g, ''); return `${n}-(${p}/100)*${n}`; });
  const words = s.replace(/\b(?:plus|minus|times|multiplied\s+by|divided\s+by|over|of|percent|squared|cubed|square\s+root\s+of|sqrt|to\s+the\s+power\s+of|x|mod|and)\b/g, ' ');
  if (/[a-z]/.test(words)) return null;
  s = s.replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/square\s+root\s+of|sqrt/g, '√').replace(/to\s+the\s+power\s+of/g, '^')
    .replace(/multiplied\s+by|times|×|\bx\b/g, '*').replace(/divided\s+by|\bover\b|÷/g, '/')
    .replace(/\bplus\b/g, '+').replace(/\bminus\b/g, '-').replace(/\bmod\b/g, '%%')
    .replace(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s*of\s*/g, '($1/100)*').replace(/(\d+(?:\.\d+)?)\s*(?:%|percent)/g, '($1/100)')
    .replace(/squared/g, '^2').replace(/cubed/g, '^3').replace(/\s+/g, '');
  const tok = s.match(/\d+(?:\.\d+)?|%%|[-+*/^()√]/g);
  if (!tok || tok.join('') !== s || !/\d/.test(s)) return null;
  let i = 0;
  const peek = () => tok[i], eat = () => tok[i++];
  const primary = () => { const t = eat(); if (t === '(') { const v = expr(); if (eat() !== ')') throw 0; return v; } if (/^\d/.test(t || '')) return Number(t); throw 0; };
  const unary = () => { if (peek() === '-') { eat(); return -unary(); } if (peek() === '+') { eat(); return unary(); } if (peek() === '√') { eat(); return Math.sqrt(unary()); } return primary(); };
  const power = () => { const b = unary(); if (peek() === '^') { eat(); return b ** power(); } return b; };
  const term = () => { let v = power(); while (['*', '/', '%%'].includes(peek())) { const o = eat(), r = power(); v = o === '*' ? v * r : o === '/' ? v / r : v % r; } return v; };
  const expr = () => { let v = term(); while (peek() === '+' || peek() === '-') { const o = eat(), r = term(); v = o === '+' ? v + r : v - r; } return v; };
  try { const v = expr(); if (i !== tok.length || !Number.isFinite(v)) return null; return Number(v.toPrecision(12)); } catch { return null; }
}

// Timers / alarms that ring at the same time (within a minute of each other): one warning line, or '' when none.
// items: [{ at, label?, text?, kind? }]
export function clashWarning(items, what = 'alarms') {
  const s = [...items].sort((a, b) => a.at - b.at);
  const groups = [];
  for (const it of s) { const g = groups[groups.length - 1]; if (g && it.at - g[g.length - 1].at < 60000) g.push(it); else groups.push([it]); }
  const bad = groups.filter((g) => g.length > 1);
  if (!bad.length) return '';
  const hm = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return bad.map((g) => `${g.length} ${what} ring at the same time (${hm(g[0].at)})`).join('; ') + '. Change one if that is not what you want.';
}
export const daysUntil = (iso, now = new Date()) => Math.round((new Date(`${iso}T00:00:00`) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
export const fmtSecs = (s) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return [h && `${h} hour${h === 1 ? '' : 's'}`, m && `${m} minute${m === 1 ? '' : 's'}`, x && `${x} second${x === 1 ? '' : 's'}`].filter(Boolean).join(' ') || '0 seconds';
};
