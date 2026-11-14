// Plain words -> a file-table tool (browse_files / file_summary / find_duplicates), plus the time/size words they share.
// No imports: the page runs this (stage 2, zero AI calls) and main runs it through files.js.
export const KINDS = {
  video: 'mp4 mkv avi mov wmv webm m4v flv mpg mpeg ts 3gp',
  audio: 'mp3 flac wav m4a aac ogg wma opus',
  image: 'jpg jpeg png gif bmp webp heic tif tiff svg raw',
  document: 'pdf doc docx xls xlsx ppt pptx txt rtf odt ods odp csv md epub',
  archive: 'zip rar 7z tar gz iso',
  program: 'exe msi msix appx bat cmd',
  code: 'js ts py java c cpp cs go rs html css json php rb sh ps1',
};
const KIND_OF = Object.fromEntries(Object.entries(KINDS).flatMap(([k, v]) => v.split(' ').map((e) => [e, k])));
export const kindOf = (ext) => KIND_OF[ext] || 'other';

// ---- values a user (or the router) writes, turned into numbers
const UNITS = { b: 1, kb: 1024, k: 1024, mb: 1024 ** 2, m: 1024 ** 2, gb: 1024 ** 3, g: 1024 ** 3, tb: 1024 ** 4 };
export function parseSize(s) {
  const m = String(s || '').toLowerCase().match(/(\d+(?:\.\d+)?)\s*(tb|gb|mb|kb|g|m|k|b)?\b/);
  return m ? Math.round(parseFloat(m[1]) * UNITS[m[2] || 'mb']) : null;
}
// ">1gb", "over 500 mb", "under 10mb", "between 1gb and 4gb" -> { min, max } in bytes
export function parseSizeRule(s) {
  const t = String(s || '').toLowerCase();
  const b = t.match(/between\s+(.+?)\s+and\s+(.+)/) || t.match(/^(\d[\d.]*\s?[a-z]*)\s*(?:to|-)\s*(\d[\d.]*\s?[a-z]*)$/); // "between 1gb and 4gb", "100mb to 1gb"
  if (b) return { min: parseSize(b[1]), max: parseSize(b[2]) };
  const v = parseSize(t);
  if (v == null) return {};
  return /<|under|less|smaller|below|max/.test(t) ? { max: v } : { min: v };
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAY = 86400000;
const UNIT_MS = { day: DAY, week: 7 * DAY, month: 30 * DAY, year: 365 * DAY };
// A time phrase -> { from, to } (ms, either may be missing). "today", "last week", "last 3 months", "october", "2025",
// "2026-10-01", "since october", "before 2025", "older than 6 months".
export function parseWhen(s, now = Date.now()) {
  let t = String(s || '').toLowerCase().trim();
  if (!t) return {};
  const n = new Date(now);
  const day0 = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  // a range: "1 october to 5 october", "between 2025-01-01 and 2025-03-31", "from june to august" (the end day is included)
  const rg = !/^(?:older|last|past)\b/.test(t) && t.match(/^(?:from\s+|between\s+)?(.+?)\s+(?:to|until|till|through|and)\s+(.+)$/);
  if (rg) {
    const a = parseWhen(rg[1], now), z = parseWhen(rg[2], now);
    const to = z && (z.to ?? (z.from != null ? z.from + DAY : undefined));
    if (a && z && a.from != null && to != null && to > a.from) return { from: a.from, to };
  }
  const older = t.match(/older than\s+(\d+)\s*(day|week|month|year)s?/);
  if (older) return { to: now - older[1] * UNIT_MS[older[2]] };
  const ago = t.match(/^(?:in the\s+)?(?:last|past)\s+(\d+)\s*(day|week|month|year)s?$/) || t.match(/^(\d+)\s*(day|week|month|year)s?(?:\s+ago)?$/);
  if (ago) return { from: now - ago[1] * UNIT_MS[ago[2]] };
  const pre = t.match(/^(since|after|from|before|until|till)\s+(.+)$/);
  if (pre) { const r = parseWhen(pre[2], now); return /before|until|till/.test(pre[1]) ? { to: r.from } : { from: r.from }; }
  const monday = day0 - ((n.getDay() + 6) % 7) * DAY;
  const named = {
    today: { from: day0 }, yesterday: { from: day0 - DAY, to: day0 },
    'this week': { from: monday }, 'last week': { from: monday - 7 * DAY, to: monday },
    'this month': { from: new Date(n.getFullYear(), n.getMonth(), 1).getTime() },
    'last month': { from: new Date(n.getFullYear(), n.getMonth() - 1, 1).getTime(), to: new Date(n.getFullYear(), n.getMonth(), 1).getTime() },
    'this year': { from: new Date(n.getFullYear(), 0, 1).getTime() },
    'last year': { from: new Date(n.getFullYear() - 1, 0, 1).getTime(), to: new Date(n.getFullYear(), 0, 1).getTime() },
  };
  if (named[t]) return named[t];
  const MON = MONTHS.map((m) => m.slice(0, 3)).join('|');
  const dm = t.match(new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MON})[a-z]*(?:,?\\s+(\\d{4}))?$`)) || t.match(new RegExp(`^(${MON})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?$`));
  if (dm) { // "5 november", "november 5th", "5 nov 2025": one day (this year, or last year if that day hasn't come yet)
    const [dayS, monS] = /^\d/.test(dm[1]) ? [dm[1], dm[2]] : [dm[2], dm[1]];
    const mi = MONTHS.findIndex((m) => m.startsWith(monS));
    let f = new Date(dm[3] ? +dm[3] : n.getFullYear(), mi, +dayS).getTime();
    if (!dm[3] && f > day0) f = new Date(n.getFullYear() - 1, mi, +dayS).getTime();
    return { from: f, to: f + DAY };
  }
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) { const f = new Date(+iso[1], iso[2] - 1, +iso[3]).getTime(); return { from: f, to: f + DAY }; }
  const mon = t.match(new RegExp(`^(${MONTHS.map((m) => m.slice(0, 3)).join('|')})[a-z]*(?:\\s+(\\d{4}))?$`));
  if (mon) {
    const mi = MONTHS.findIndex((m) => m.startsWith(mon[1]));
    let y = mon[2] ? +mon[2] : n.getFullYear();
    if (!mon[2] && mi > n.getMonth()) y--; // "october" in March means last October
    return { from: new Date(y, mi, 1).getTime(), to: new Date(y, mi + 1, 1).getTime() };
  }
  const yr = t.match(/^(19|20)\d{2}$/);
  if (yr) return { from: new Date(+t, 0, 1).getTime(), to: new Date(+t + 1, 0, 1).getTime() };
  return null; // not understood: the caller says so instead of silently ignoring it
}

// ---- plain words -> tool. Returns null unless the text clearly asks to SEE files (so "open X" / "play X" never land here).
const FOLDER_KEYS = { downloads: 'downloads', download: 'downloads', documents: 'documents', document: 'documents', docs: 'documents', desktop: 'desktop', pictures: 'pictures', picture: 'pictures', photos: 'pictures', videos: 'videos', video: 'videos', music: 'music', home: 'home' };
const NOUNS = {
  video: 'movie film video episode series clip recording', audio: 'song music audio track podcast', image: 'photo picture image pic screenshot wallpaper',
  document: 'document doc spreadsheet presentation ebook book', archive: 'archive', program: 'installer program setup', code: 'script code',
};
const NOUN_KIND = Object.fromEntries(Object.entries(NOUNS).flatMap(([k, v]) => v.split(' ').map((w) => [w, k])));
const ALL_EXT = new Set(Object.values(KINDS).join(' ').split(' '));
const AMBIG = new Set(['doc', 'go', 'c', 'ts', 'cs', 'sh', 'raw', 'md', 'rb', 'gz']); // also plain English words: only a kind/ext param picks these
const nounKind = (w) => [w, w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/ies$/, 'y')].map((x) => NOUN_KIND[x]).find(Boolean);
const STOPS = new Set(('and or then sorted sort sorting arranged arrange ordered order by from with that which where newest latest oldest recent new old ones '
  + 'bigger larger smaller older newer over under above below since before after than show list me give their its all every each the my a an to of '
  + 'is are i have do please table date dates size sizes in on at inside taken for named called containing modified edited created a-z z-a first last top').split(' '));
// The words the parser understands, in one place so they can be extended without touching the logic below.
export const WORDS = {
  old: /\b(?:old|older|oldest|earliest|ancient|old ones)\b(?! than)/, // "older than 6 months" is a time filter, not an order
  new: /\b(?:new|newer|newest|latest|recent|recently|last \d+|last few|new ones)\b(?! than)/,
  oldToNew: /\b(?:old(?:est)? (?:ones )?to (?:new|recent)(?:est)?|ascending)\b/,
  newToOld: /\b(?:new(?:est)? (?:ones )?to old(?:est)?|descending)\b/,
  few: /\b(?:a few|few|some|couple of|handful)\b/, fewMeans: 5,
  unitAfter: /^\s*(?:tb|gb|mb|kb|b|bytes?|days?|weeks?|months?|years?|hours?|minutes?|mins?|%|percent|am|pm|p|star|stars|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\b/, // "2 gb", "30 days", "5 stars": not a count
  notCountBefore: /\b(?:season|episode|ep|part|s|e|over|under|than|above|below|since|before|after|from|until|till|page|version|windows)\s*$/, // "episode 3", "over 2": not a count
  local: /\b(?:i (?:have|got|own|downloaded|saved)|on (?:my|this) (?:pc|computer|laptop|machine)|in my \w+)\b/, // signs the user means files on this PC
};
const SEE = /\b(list|show|display|give|see|sort|sorted|arrange|arranged|order|browse|table|which|what|how many|count|every|newest|latest|recent|oldest|biggest|largest|smallest|heaviest|duplicates?|taking (?:up )?space|using (?:up )?space|space|search in|search through|downloaded|i (?:have|got|own)|only|just|few|some)\b/;
const NOT_LIST = /^(google|bing|youtube|open|play|watch|launch|start|run|delete|remove|trash|move|copy|rename|close|create|make|write|download|install|send|email)\b/;
const PREP = /\b(?:in|inside|from|under|on|at|across|within|of)\s+/g;

export function parseFileQuery(text, now = Date.now()) {
  const raw = String(text || '').trim();
  const t = raw.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
  if (!t || NOT_LIST.test(t) || !SEE.test(t) || /\bhidden\b/.test(t) || /^what(?:'s| is| are) (?:a|an)\b/.test(t) || /\b(?:episode|ep|season) \d+\b|\bs\d{1,2}e\d{1,2}\b/.test(t)) return null; // "show hidden files" / "what is a pdf" / "show episode 3 of trigger" are not listings
  const p = {};
  let rest = t;

  // where: a quoted or typed path, a drive, a library folder or any folder name
  const quoted = raw.match(/"([a-z]:\\[^"]*)"/i);
  const typed = !quoted && raw.match(/\b[a-z]:\\\S*/i);
  let pathM = quoted && [quoted[0], quoted[1]];
  if (typed) { // a typed path may hold spaces ("C:\Program Files\x"): it runs until a word like "bigger" / "sorted"
    const toks = raw.slice(typed.index).split(' ');
    let n = 1;
    while (n < toks.length && !STOPS.has(toks[n].toLowerCase()) && !/^\d/.test(toks[n])) n++;
    const s = toks.slice(0, n).join(' ');
    pathM = [s, s];
  }
  const drive = t.match(/\b(?:drive\s+([a-z])|([a-z])\s+drive|([a-z]):(?!\\))(?=\s|$)/);
  if (pathM) { p.in = pathM[1].replace(/[\\,.]+$/, '').replace(/^([a-z]:)$/i, '$1\\'); rest = rest.replace(pathM[0].toLowerCase(), ' '); }
  else if (drive) { p.in = `${(drive[1] || drive[2] || drive[3]).toUpperCase()}:\\`; rest = rest.replace(drive[0], ' '); }
  else {
    for (const m of t.matchAll(PREP)) {
      const after = t.slice(m.index + m[0].length).split(' ');
      const words = [];
      for (const w0 of after) {
        const w = w0.replace(/[,;.!?]+$/, '');
        if (['my', 'the', 'all', 'this', 'our'].includes(w) && !words.length) continue;
        if (!w || STOPS.has(w) || /^\d/.test(w)) break;
        words.push(w);
        if (words.length === 3 || w !== w0) break; // punctuation ends the place name
      }
      const said = /^(folder|folders|directory|dir|library)$/.test(words[words.length - 1] || '') || /^(folder|directory)$/.test(after[after.indexOf(words[words.length - 1]) + 1] || '');
      while (words.length && /^(folder|folders|directory|dir|library|pc|computer|laptop)$/.test(words[words.length - 1])) words.pop();
      if (!words.length) continue;
      const one = words.join(' ');
      const key = !said && FOLDER_KEYS[words[0]];
      if (key && !(m[0].startsWith('of') && nounKind(words[0]))) { p.in = words.length === 1 && /^(movies?|films?)$/.test(words[0]) ? words[0] : key; /* "in movies": a real Movies folder if there is one, else the Videos library (folderOf decides) */ rest = rest.slice(0, m.index) + rest.slice(m.index).replace(words[0], ' '); break; }
      if (said) { p.in = one; rest = rest.replace(one, ' '); break; } // "in my movies folder": any folder by name
      // anything else after "in/of" ("list of movies", "in season 1") says what, not where
    }
    // no "in": "my downloads", "the latest download", "on my desktop"
    const bare = !p.in && t.match(/\b(?:my|the) (downloads|documents|desktop|pictures|photos|videos|music)(?: folder)?\b|\b(?:downloads?|downloaded)\b/);
    if (bare) { p.in = FOLDER_KEYS[bare[1] || 'downloads']; rest = rest.replace(bare[0], ' '); }
    const inMovies = !p.in && t.match(/\b(?:in|inside|from)\s+(?:the\s+|my\s+)?(movies?|films?)\s*$/); // "show me in movies": the Movies folder if there is one
    if (inMovies) p.in = inMovies[1];
  }

  // what: kinds and extensions from the words left
  const words = rest.split(/[^a-z0-9.]+/).filter(Boolean);
  const kinds = new Set(), exts = new Set();
  for (const w0 of words) {
    const e = w0.replace(/^\./, ''), es = e.replace(/s$/, '');
    const ext = [e, es].find((x) => ALL_EXT.has(x) && !AMBIG.has(x));
    if (ext) exts.add(ext);
    else if (nounKind(e)) kinds.add(nounKind(e));
  }
  if (exts.size) p.ext = [...exts].join(',');
  else if (kinds.size === 1) p.kind = [...kinds][0];
  if (!p.in && !p.ext && !p.kind && !/\bfiles?\b/.test(t)) return null; // nothing about files: not ours

  // how: sort / order
  if (/\b(biggest|largest|heaviest|by size|size first)\b/.test(t)) p.sort = 'size';
  const adj = /\b(large|big|huge|heavy)\b/.test(t.replace(/\b(?:named|called|titled|containing)\b.*$/, '')); // "large movies" = biggest first ("larger than 1gb" is the size filter below)
  if (adj) p.sort = 'size';
  if (/\b(smallest|lightest)\b/.test(t)) { p.sort = 'size'; p.order = 'asc'; }
  if (/\b(modified|edited|changed|updated)\b/.test(t)) p.sort = 'modified';
  if (/\b(a-z|a to z|alphabetical(?:ly)?|by name)\b/.test(t)) p.sort = 'name';
  if (/\bz-a|z to a\b/.test(t)) { p.sort = 'name'; p.order = 'desc'; }
  if (/\bby (type|extension)\b/.test(t)) p.sort = 'type';
  // old / new anywhere in the sentence, in any form ("old films", "the oldest", "latest i have", "new ones to old")
  if (WORDS.oldToNew.test(t) || (WORDS.old.test(t) && !WORDS.newToOld.test(t))) { p.sort ||= 'arrived'; p.order = 'asc'; }
  else if ((WORDS.new.test(t) || WORDS.newToOld.test(t)) && p.sort !== 'size') { p.sort ||= 'arrived'; p.order = 'desc'; }

  // how many: any plain number in the sentence that is not a year, a size, a time span or an episode number ("only 10", "10 latest", "i have only 10", "show me 10 movies")
  const count = [...t.matchAll(/(?<![\w.])(\d{1,4})(?![\w.%])/g)].map((m) => ({ n: +m[1], before: t.slice(Math.max(0, m.index - 12), m.index), after: t.slice(m.index + m[1].length, m.index + m[1].length + 10) }))
    .find((c) => c.n >= 1 && c.n <= 2000 && !/^(?:19|20)\d\d$/.test(String(c.n)) && !WORDS.unitAfter.test(c.after) && !WORDS.notCountBefore.test(c.before));
  if (count) p.limit = count.n;
  else if (WORDS.few.test(t)) p.limit = WORDS.fewMeans; // "show me a few movies"
  else if (/\b(?:latest|newest|biggest|largest|oldest|smallest|last|most recent) (?:\w+ )?(?:file|movie|film|video|episode|song|photo|picture|document|download|pdf|screenshot)\b(?!s)/.test(t)) p.limit = 1;

  if (adj && !p.limit) p.limit = 20; // "show me large movies" with no number: the top 20, not every file
  // when / how big / named
  const when = t.match(/\b(?:older than \d+ (?:day|week|month|year)s?|(?:in the )?(?:last|past) \d+ (?:day|week|month|year)s?|(?:since|after|before|until) [a-z0-9-]+(?: \d{4})?|today|yesterday|(?:this|last) (?:week|month|year)|(?:19|20)\d{2}-\d{1,2}-\d{1,2})\b/)
    || t.match(new RegExp(`\\b(?:in|from|during) ((?:${MONTHS.join('|')})(?: \\d{4})?|(?:19|20)\\d{2})\\b`)) || t.match(/\b((?:19|20)\d{2})\b/); // "show me 2025 photos"
  if (when) p.when = (when[1] || when[0]).replace(/^in the /, '');
  if (p.when && parseWhen(p.when, now) === null) delete p.when;
  const size = t.match(/\b(?:bigger|larger|more|greater|over|above|smaller|less|under|below)(?: than)? \d+(?:\.\d+)? ?(?:tb|gb|mb|kb)\b|\bbetween \d+(?:\.\d+)? ?(?:tb|gb|mb|kb) and \d+(?:\.\d+)? ?(?:tb|gb|mb|kb)\b/);
  if (size) p.size = size[0];
  const named = raw.match(/\b(?:named|called|titled|containing|with)\s+"([^"]+)"/i) || t.match(/\b(?:named|called|titled|containing)\s+([a-z0-9 _.-]+?)(?=\s+(?:in|from|on|sorted|by|and|newest|oldest)\b|$)/);
  if (named) p.name = named[1].trim();

  // "show me the documents folder" opens it: a bare show/see needs something listing-shaped too
  const listing = /\b(files?|all|every|contents?|list|sort|sorted|arrange|which|what|how many|count|table|duplicates?|space)\b/.test(t);
  if (!listing && !p.kind && !p.ext && !p.sort && !p.when && !p.size && !p.name) return null;

  // Extra columns only when asked for ("with size", "where they are", "by type"); the table is name + date otherwise.
  const show = [p.sort !== 'size' && !p.size && /\b(size|sizes|big|large|small|heavy|mb|gb)\b/.test(t) && 'size', /\b(where (?:they|it|each|the \w+) (?:is|are)|locations?|paths?|which folder|folder names?|by folder|with (?:the |their )?folders?)\b/.test(t) && 'folder', p.sort !== 'type' && /\b(type|types|extension|extensions|kind|kinds|format|formats)\b/.test(t) && 'type'].filter(Boolean);
  if (show.length) p.show = show.join(',');
  // which tool
  if (/\bduplicates?\b|\bsame files?\b|\bcopies of\b|\bdouble files?\b/.test(t)) return { action: 'find_duplicates', params: strip(p, ['sort', 'order', 'limit', 'show']) };
  const grp = t.match(/\b(?:each|every|per|by|group(?:ed)? by)\s+(type|kind|extension|month|year|folder)s?\b/);
  if (/\b(?:taking|using|eating) (?:up )?(?:the most )?space\b|\bwhat(?:'s| is) big\b|\bfolder sizes?\b|\b(?:biggest|largest) folders?\b|\bspace (?:used|usage)\b/.test(t)) return { action: 'file_summary', params: { ...strip(p, ['sort', 'order', 'limit', 'show']), group: 'folder' } };
  if (grp && /\b(how many|count|summary|summari[sz]e|breakdown|group|each|per)\b/.test(t)) return { action: 'file_summary', params: { ...strip(p, ['sort', 'order', 'limit', 'show']), group: { extension: 'type', kind: 'kind', type: 'kind' }[grp[1]] || grp[1] } };
  return { action: 'browse_files', params: p };
}

// ---- the gate between "the code understood it" and "ask the model". Words of the request that the parser did NOT act on
// (an adjective like "tiny", a typo, a condition it has no rule for). Empty = fully understood = safe for the zero-AI fast path;
// anything left over goes to the model router, which reads the whole sentence instead of matching words.
const UNDERSTOOD = new Set(('list show display give see sort sorted arrange arranged order browse table which what whats how many count every all any only just few some couple handful top first last '
  + 'latest newest recent recently oldest earliest old older new newer ancient biggest largest heaviest smallest lightest large big huge heavy bigger larger smaller more less greater over under above below between than since before after until till from '
  + 'in on at inside within across of to and or then with that i have got own my me the a an are is do does can could would you please also there their them they it its these those for '
  + 'named called titled containing modified edited changed updated arrived downloaded taken saved created by file files folder folders directory dir library pc computer laptop drive today yesterday day days week weeks month months year years ago this past '
  + 'january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec st nd rd th kb mb gb tb b bytes '
  + 'find search tell where size sizes name names type types extension extensions kind kinds format formats date dates a-z z-a alphabetical alphabetically duplicates duplicate copies same each per group grouped summary breakdown taking using eating up space most per '
  + 'want need looking get give').split(/\s+/));
const TIME_WORDS = new Set('today yesterday day days week weeks month months year years ago since before after until till january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec'.split(' '));
const SIZE_WORDS = new Set('bigger larger smaller more less greater over under above below kb mb gb tb bytes'.split(' '));
// nouns that name something more specific than their kind ("screenshot" is an image, but not every image is one): the model decides whether to filter by name
const NOUN_VAGUE = new Set('screenshot wallpaper episode series clip recording podcast ebook book installer setup program'.split(' '));
const NOUN_WORDS = new Set(Object.values(NOUNS).join(' ').split(' ').filter((w) => !NOUN_VAGUE.has(w)));
export function unexplainedWords(text, params = {}, now = Date.now()) {
  const valueWords = new Set(Object.values(params).filter((v) => typeof v === 'string').join(' ').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const left = [];
  const t = String(text || '').toLowerCase().replace(/[’']/g, '');
  // two different orderings in one sentence ("2 newest videos and 2 biggest videos") are two requests: one table cannot answer both
  const orders = new Set((t.replace(/\b(?:new|old)(?:est)? (?:ones )?to (?:new|old)(?:est)?\b/g, ' ').match(/\b(?:newest|latest|recent|oldest|earliest|biggest|largest|large|big|huge|heavy|heaviest|smallest|lightest)\b/g) || [])
    .map((w) => ({ newest: 'new', latest: 'new', recent: 'new', oldest: 'old', earliest: 'old', smallest: 'small', lightest: 'small' }[w] || 'big')));
  if (orders.size > 1) left.push('(two requests in one)');
  // a condition the table cannot express: leaving it out would give the opposite of what was asked
  for (const w of t.match(/\b(?:not|isn't|aren't|except|excluding|besides|never|neither|nor|but|other than)\b/g) || []) left.push(w);
  for (const w of t.replace(/\ba-z\b|\bz-a\b/g, ' ').split(/[^a-z0-9]+/).filter(Boolean)) {
    const bases = [w, w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/ies$/, 'y')];
    if (/^\d+$/.test(w)) { if (!valueWords.has(w) && String(params.limit) !== w) left.push(w); continue; } // a number must have become the count, a date or a size
    if (bases.some((b) => valueWords.has(b))) continue;
    // a date / size word only counts as understood when the parser really made a date / size filter out of it
    if (bases.some((b) => TIME_WORDS.has(b))) { if (!params.when) left.push(w); continue; }
    if (bases.some((b) => SIZE_WORDS.has(b))) { if (!params.size) left.push(w); continue; }
    if (bases.some((b) => UNDERSTOOD.has(b) || NOUN_WORDS.has(b) || ALL_EXT.has(b) || FOLDER_KEYS[b])) continue;
    left.push(w);
  }
  return [...new Set(left)];
}
const strip = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
