// Favorites: the apps, browser and browser profile the user likes, so "search cats" or "open my email" go where THEY go.
// Pure code (no node imports). prefs = { "fav:browser": "chrome", "fav:profile:chrome": "KEVIN", "fav:email": "gmail", "count:browser:chrome": 7, ... }.
// Rule: whatever the request names itself (a browser, a profile, an app) always wins; a favorite only fills what the request left out.

export const CATEGORIES = {
  browser: ['browser', 'web browser'],
  email: ['email', 'e mail', 'mail', 'inbox', 'mail app', 'email app'],
  chat: ['chat', 'chat app', 'messenger', 'messaging', 'messages'],
  music: ['music', 'music app', 'music player', 'songs'],
  video: ['video player', 'movie player', 'media player', 'player'],
  notes: ['notes', 'notes app', 'notebook'],
  editor: ['editor', 'code editor', 'text editor', 'ide'],
  terminal: ['terminal', 'console', 'shell', 'command line'],
  calendar: ['calendar'],
  maps: ['maps', 'map'],
};
// Used only when the user has set nothing and nothing was learned.
export const DEFAULTS = { email: 'gmail', calendar: 'calendar', maps: 'maps' };

const clean = (s) => String(s || '').toLowerCase().replace(/^(?:my|the|a)\s+/, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
export function categoryOf(word) {
  const w = clean(word);
  return Object.keys(CATEGORIES).find((c) => c === w || CATEGORIES[c].includes(w)) || null;
}

const LEARN_MIN = 3, LEARN_SHARE = 0.6;
// A choice used at least 3 times, and in at least 60% of the uses, counts as a favorite even if the user never said so.
function learned(prefs, prefix) {
  const rows = Object.entries(prefs || {}).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), Number(v) || 0]);
  const total = rows.reduce((s, [, n]) => s + n, 0);
  const top = rows.sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= LEARN_MIN && top[1] / total >= LEARN_SHARE ? top[0] : null;
}
export const favoriteOf = (prefs, category) => prefs?.[`fav:${category}`] || (category === 'browser' ? learned(prefs, 'count:browser:') : learned(prefs, `count:${category}:`)) || null;
export const favoriteProfile = (prefs, browser) => (browser ? prefs?.[`fav:profile:${browser}`] || learned(prefs, `count:profile:${browser}:`) || null : null);

/**
 * { browser, profile } as the request named them -> what to really use.
 * Named browser/profile are kept. A missing browser becomes the favorite one; a missing profile becomes the favorite profile OF THAT browser,
 * so "in edge" never gets chrome's profile.
 */
export function applyBrowserFavorites({ browser, profile } = {}, prefs = {}) {
  const b = browser || favoriteOf(prefs, 'browser') || null;
  const p = profile || favoriteProfile(prefs, b) || null;
  return { browser: b, profile: p, usedFavorite: Boolean((!browser && b) || (!profile && p)) };
}

// "my email" / "my music app" -> the app to open: the favorite, else a sensible default, else null (the normal app lookup runs).
export function appForCategory(word, prefs = {}) {
  const c = categoryOf(word);
  if (!c) return null;
  return { category: c, app: favoriteOf(prefs, c) || DEFAULTS[c] || null };
}

// ---- spoken settings: "my favorite browser is chrome", "make kevin my default chrome profile", "forget my favorite music app" ----
const CAT_RE = Object.values(CATEGORIES).flat().sort((a, b) => b.length - a.length).join('|');
const FAV_WORD = '(?:favou?rite|default|preferred|main|usual)';
const BROWSERS = 'chrome|google chrome|edge|microsoft edge|brave|firefox|opera';
const normBrowser = (b) => ({ 'google chrome': 'chrome', 'microsoft edge': 'edge' }[b] || b);

export function parseFavoriteCommand(text) {
  const t = String(text || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9@._ -]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\bfavourite\b/g, 'favorite');
  if (!t) return null;
  if (/^(?:what are|show|list|tell me|whats|what is)\s+(?:all\s+)?(?:my\s+)?(?:favou?rites?|defaults?|preferred apps)\b/.test(t) || /^(?:my\s+)?favorites$/.test(t)) return { op: 'list' };
  let m;
  if ((m = t.match(new RegExp(`^(?:forget|remove|clear|delete|reset)\\s+(?:my\\s+)?${FAV_WORD}\\s+(${BROWSERS})\\s+profile$`)))) return { op: 'forget', category: 'profile', browser: normBrowser(m[1]) };
  if ((m = t.match(new RegExp(`^(?:forget|remove|clear|delete|reset)\\s+(?:my\\s+)?(?:${FAV_WORD}\\s+)?(${CAT_RE})(?:\\s+${FAV_WORD})?$`))) && categoryOf(m[1])) return { op: 'forget', category: categoryOf(m[1]) };
  // profile: "make kevin my default chrome profile", "my default chrome profile is kevin", "use my kevin profile by default"
  if ((m = t.match(new RegExp(`^(?:set|make|use|remember|save)\\s+(.{1,40}?)\\s+(?:as\\s+)?(?:my\\s+)?${FAV_WORD}\\s+(?:(${BROWSERS})\\s+)?profile$`)))) return { op: 'set', category: 'profile', value: m[1].trim(), browser: normBrowser(m[2] || 'chrome') };
  if ((m = t.match(new RegExp(`^(?:my\\s+)?${FAV_WORD}\\s+(?:(${BROWSERS})\\s+)?profile\\s+(?:is|=)\\s+(.{1,40})$`)))) return { op: 'set', category: 'profile', value: m[2].trim(), browser: normBrowser(m[1] || 'chrome') };
  if ((m = t.match(new RegExp(`^(?:use|always use)\\s+(?:my\\s+)?(.{1,40}?)\\s+profile\\s+by\\s+default$`)))) return { op: 'set', category: 'profile', value: m[1].trim(), browser: 'chrome' };
  // app: "my favorite browser is chrome", "set chrome as my default browser", "i use spotify for music", "my email is gmail"
  if ((m = t.match(new RegExp(`^(?:my\\s+)?${FAV_WORD}\\s+(${CAT_RE})\\s+(?:app\\s+)?(?:is|=)\\s+(.{1,40})$`))) && categoryOf(m[1])) return { op: 'set', category: categoryOf(m[1]), value: m[2].trim() };
  if ((m = t.match(new RegExp(`^(?:set|make|use|remember|save)\\s+(.{1,40}?)\\s+(?:as\\s+)?(?:my\\s+)?${FAV_WORD}\\s+(${CAT_RE})$`))) && categoryOf(m[2])) return { op: 'set', category: categoryOf(m[2]), value: m[1].trim() };
  if ((m = t.match(new RegExp(`^(?:i\\s+use|i\\s+prefer)\\s+(.{1,40}?)\\s+for\\s+(?:my\\s+)?(${CAT_RE})$`))) && categoryOf(m[2])) return { op: 'set', category: categoryOf(m[2]), value: m[1].trim() };
  if ((m = t.match(new RegExp(`^my\\s+(${CAT_RE})\\s+(?:app\\s+)?is\\s+(.{1,40})$`))) && categoryOf(m[1])) return { op: 'set', category: categoryOf(m[1]), value: m[2].trim() };
  return null;
}
