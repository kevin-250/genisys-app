// Everyday assistant requests the code understands without the AI: time in a city, reminders, playing music,
// sending something to a contact in a chat app. Pure parsers (tested in assist.test.mjs); the actions live in actions.js.

const zones = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return []; } })();
// A few names people say that are not the city in the zone id.
const ZONE_ALIAS = {
  'new york': 'America/New_York', nyc: 'America/New_York', usa: 'America/New_York', 'washington': 'America/New_York', boston: 'America/New_York', miami: 'America/New_York',
  'los angeles': 'America/Los_Angeles', la: 'America/Los_Angeles', california: 'America/Los_Angeles', 'san francisco': 'America/Los_Angeles', seattle: 'America/Los_Angeles',
  texas: 'America/Chicago', houston: 'America/Chicago', dallas: 'America/Chicago', canada: 'America/Toronto',
  uk: 'Europe/London', england: 'Europe/London', france: 'Europe/Paris', germany: 'Europe/Berlin', belgium: 'Europe/Brussels', spain: 'Europe/Madrid', italy: 'Europe/Rome',
  rwanda: 'Africa/Kigali', kenya: 'Africa/Nairobi', uganda: 'Africa/Kampala', tanzania: 'Africa/Dar_es_Salaam', nigeria: 'Africa/Lagos', ghana: 'Africa/Accra',
  'south africa': 'Africa/Johannesburg', egypt: 'Africa/Cairo', congo: 'Africa/Kinshasa', drc: 'Africa/Lubumbashi', goma: 'Africa/Lubumbashi', burundi: 'Africa/Bujumbura',
  india: 'Asia/Kolkata', delhi: 'Asia/Kolkata', mumbai: 'Asia/Kolkata', china: 'Asia/Shanghai', beijing: 'Asia/Shanghai', japan: 'Asia/Tokyo', korea: 'Asia/Seoul',
  dubai: 'Asia/Dubai', uae: 'Asia/Dubai', 'saudi arabia': 'Asia/Riyadh', australia: 'Australia/Sydney', brazil: 'America/Sao_Paulo', mexico: 'America/Mexico_City',
};
export function zoneOf(place) {
  const p = String(place || '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!p) return null;
  if (ZONE_ALIAS[p]) return ZONE_ALIAS[p];
  const want = p.replace(/ /g, '_');
  const hit = zones.find((z) => z.toLowerCase().split('/').pop() === want);
  if (hit) return hit;
  // "usa california", "america/los angeles" (the AI's spelling), "kigali rwanda": the place is often the last words
  const w = p.split(' ');
  for (let i = 1; i < w.length; i++) { const z = zoneOf(w.slice(i).join(' ')); if (z) return z; }
  return w.length > 1 ? zoneOf(w[0]) : null;
}
// "what time is it in new york" / "time in tokyo" / "what's the time in rwanda" -> { place }
export function parseTimeIn(text) {
  const m = /^\s*(?:what(?:'s| is)?\s+(?:the\s+)?time\s+(?:is\s+it\s+)?(?:now\s+)?|time\s+|current\s+time\s+)(?:right\s+now\s+)?in\s+([a-z .'-]{2,40}?)\s*(?:right\s+now|now)?\s*\??\s*$/i.exec(String(text || ''));
  return m && zoneOf(m[1]) ? { place: m[1].trim() } : null;
}
export function timeIn(place, now = new Date()) {
  const zone = zoneOf(place);
  if (!zone) return null;
  const f = (tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const off = (tz) => { const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(now).find((x) => x.type === 'timeZoneName')?.value || 'GMT'; const m = /GMT([+-]\d+)?(?::(\d+))?/.exec(s); return m && m[1] ? Number(m[1]) + Math.sign(Number(m[1])) * (Number(m[2] || 0) / 60) : 0; };
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const diff = off(zone) - off(here);
  const rel = diff === 0 ? 'same time as here' : `${Math.abs(diff)} hour${Math.abs(diff) === 1 ? '' : 's'} ${diff > 0 ? 'ahead of' : 'behind'} you`;
  return { zone, text: `It's ${f(zone)} in ${place.replace(/\b\w/g, (c) => c.toUpperCase())} (${rel}; your time: ${f(here)}).` };
}

// "remind me in 10 minutes to call mom" / "remind me at 18:30 to pray" / "set a reminder for 2 hours: drink water"
const UNIT = { s: 1 / 60, sec: 1 / 60, secs: 1 / 60, second: 1 / 60, seconds: 1 / 60, m: 1, min: 1, mins: 1, minute: 1, minutes: 1, h: 60, hr: 60, hrs: 60, hour: 60, hours: 60 };
const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, half: 0.5 };
export function parseReminder(text, now = new Date()) {
  const t = String(text || '').trim().replace(/[.!]+$/, '');
  const head = /^(?:please\s+)?(?:remind\s+me|set\s+(?:a\s+)?reminder|reminder)\b\s*/i.exec(t);
  if (!head) return null;
  let rest = t.slice(head[0].length);
  let at = null, what = '';
  const rel = /\b(?:in|for|after)\s+(\d+(?:\.\d+)?|a|an|one|two|three|four|five|ten|fifteen|twenty|thirty|half)\s*(?:an?\s+)?(s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?)\b/i.exec(rest);
  // "at 5", "at 5:30 pm", and as people say it out loud: "for 5 pm", "for 6:30" (a clock time, so never "for 5 minutes")
  const abs = /\bat\s+(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm)?\b/i.exec(rest)
    || /\bfor\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(rest) || /\bfor\s+(\d{1,2}):(\d{2})()\b/.exec(rest);
  if (rel) {
    const n = NUMW[rel[1].toLowerCase()] ?? Number(rel[1]);
    at = Math.round(now.getTime() + n * UNIT[rel[2].toLowerCase()] * 60000);
    rest = rest.replace(rel[0], ' ');
  } else if (abs) {
    let h = Number(abs[1]); const mi = Number(abs[2] || 0), ap = (abs[3] || '').toLowerCase();
    if (h > 23 || mi > 59) return null;
    if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
    const d = new Date(now); d.setHours(h, mi, 0, 0); if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    // "tomorrow at 9": the next day (after midnight, before 4 am, "tomorrow" still means the coming morning = today's date)
    if (/\btomorrow\b/i.test(rest) && d.toDateString() === now.toDateString() && now.getHours() >= 4) d.setDate(d.getDate() + 1);
    at = d.getTime();
    rest = rest.replace(abs[0], ' ');
  } else return null;
  // the words of the reminder: without the day words, and "to" / "that" only as whole words (never the "to" of "tomorrow")
  what = rest.replace(/\b(?:tomorrow|today|tonight)\b/gi, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:to|that|about)\b\s*|^[:-]\s*/i, '').replace(/\s+(?:to|that|about)$/i, '').trim();
  return { at, text: what || 'Reminder' };
}

// "play some chill music" / "play afrobeats" / "play burna boy on spotify" / "put on some music" -> { query, app? }
const PLAYERS = /\s+(?:on|in|with|using)\s+(spotify|youtube music|youtube|vlc|aimp|potplayer|groove|media player|windows media player|apple music|itunes|deezer|boomplay|audiomack|soundcloud)\s*$/i;
export function parsePlay(text) {
  let t = String(text || '').trim().replace(/[.!]+$/, '');
  const m = /^(?:please\s+)?(?:play|put\s+on|listen\s+to|i\s+want\s+to\s+listen\s+to)\s+(.+)$/i.exec(t);
  if (!m) return null;
  let q = m[1], app = null;
  const a = PLAYERS.exec(q); if (a) { app = a[1].toLowerCase(); q = q.slice(0, a.index); }
  // only music requests: a film or a named file is the media/file path's job
  if (/\b(movie|film|episode|season|series|video|\.mp4|\.mkv|\.avi)\b/i.test(q)) return null;
  const music = /\b(music|songs?|tracks?|playlist|album|beats?|afro\w*|gospel|jazz|rap|hip ?hop|r&b|rnb|reggae|lofi|lo-fi|chill|relax\w*|amapiano|bongo|rumba|zouk|classical|rock|pop)\b/i.test(q);
  const stream = app && !/^(vlc|aimp|potplayer|groove|media player|windows media player)$/.test(app);
  if (!music && !stream) return null; // "play trigger ep 1 in vlc" is a file to open, not music
  if (/^(?:the|that|this|same|next|previous|last)\s/i.test(q.trim())) return null; // "play the last song": a reference, the AI knows what it means
  q = q.replace(/^(?:some|a\s+bit\s+of|me\s+some|me|my)\s+/i, '').replace(/\b(?:music|songs?)\b/i, (w) => w).trim();
  const generic = /^(?:some\s+)?(?:music|songs?|my\s+music|a\s+song|something)$/i.test(q);
  return { query: generic ? '' : q.replace(/\s+(?:music|songs?)$/i, '').trim(), app };
}

// Does this path really name what the user said? Every meaningful word they used must be in its name, and "file"
// never means a folder. Guards deletes / moves picked by a model ("genisys todo file" must not become a "todos" folder).
const FILLER = new Set('delete remove trash erase move copy rename the my that this a an file files folder folders document doc pdf to from into in on of and please it'.split(' '));
export function nameFits(text, p) {
  const name = String(p || '').split(/[\\/]/).filter(Boolean).pop() || '';
  if (!name) return false;
  if (/\bfile\b/i.test(text) && !/\.\w{1,6}$/.test(name)) return false; // a folder has no extension
  const flat = name.toLowerCase().replace(/\.\w{1,6}$/, '').replace(/[^a-z0-9]+/g, ' ');
  const words = String(text).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !FILLER.has(w));
  return words.length > 0 && words.every((w) => new RegExp(`\\b${w}\\b`).test(flat));
}

// "send that pdf to kevin on whatsapp" / "share it with mom via telegram" / "send hello to john on whatsapp" -> { app, to, ref?, text? }
const CHAT = /(whatsapp|telegram|signal|discord|slack)/i;
export function parseChatSend(text) {
  const t = String(text || '').trim().replace(/[.!]+$/, '');
  const m = /^(?:please\s+|go\s+to\s+\w+\s+and\s+|after\s+that\s+|then\s+|and\s+)?(?:send|share|forward)\s+(.+?)\s+(?:to|with)\s+(?:someone\s+called\s+|my\s+)?([a-z0-9][\w .'-]{0,40}?)\s+(?:on|in|via|through|using|over)\s+(whatsapp|telegram|signal|discord|slack)\s*$/i.exec(t);
  if (!m || !CHAT.test(m[3])) return null;
  const what = m[1].trim();
  const ref = /^(?:it|that|this|them|the\s+file|that\s+file|this\s+file|the\s+(?:pdf|doc|document|photo|picture|image|video)|that\s+\w+(?:\s+file)?|this\s+\w+(?:\s+file)?|the\s+\w+\s+(?:you|i)\s+(?:made|created|wrote))$/i.test(what) || /\b(?:file|pdf|document|doc|photo|picture)\b.*\b(?:you|i)\s+(?:made|created|wrote|saved)\b/i.test(what);
  if (!ref && /\b(?:cv|resume|pdf|files?|documents?|docs?|photos?|pictures?|images?|videos?|reports?|songs?)\b|\.\w{2,4}\b/i.test(what)) return null; // a file to find first: the AI does that
  return { app: m[3].toLowerCase(), to: m[2].trim(), ...(ref ? { ref: true } : { text: what.replace(/^["']|["']$/g, '') }) };
}
