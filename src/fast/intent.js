// Stage 2: understand simple commands without any model. Returns { action, params, confidence (0-1), normalized, reason }.
// Only a few safe "open / search / play" shapes are understood. Everything else gets a low confidence and goes on to the AI.
import { normalize, typoDistance } from './normalize.js';
import { parseSystem } from './system.js';

export const FAST_MIN = 0.75; // at or above this the fast path may run it

const VERBS = {
  open: 'open', launch: 'open', start: 'open', run: 'open', show: 'open', visit: 'open', browse: 'open', goto: 'open', watch: 'open',
  play: 'play', search: 'search', google: 'search', lookup: 'search', find: 'find',
};
const FUZZY_VERBS = ['open', 'launch', 'search', 'google', 'play', 'start', 'visit', 'watch', 'browse'];

export const FOLDERS = {
  downloads: 'downloads', download: 'downloads', documents: 'documents', docs: 'documents', desktop: 'desktop',
  pictures: 'pictures', photos: 'pictures', images: 'pictures', videos: 'videos', movies: 'videos', music: 'music', home: 'home',
};
export const BROWSERS = { chrome: 'chrome', 'google chrome': 'chrome', edge: 'edge', 'microsoft edge': 'edge', firefox: 'firefox', brave: 'brave', opera: 'opera' };
export const SITES = {
  youtube: 'https://www.youtube.com', gmail: 'https://mail.google.com', github: 'https://github.com', google: 'https://www.google.com',
  facebook: 'https://www.facebook.com', instagram: 'https://www.instagram.com', twitter: 'https://x.com', x: 'https://x.com',
  linkedin: 'https://www.linkedin.com', reddit: 'https://www.reddit.com', netflix: 'https://www.netflix.com', chatgpt: 'https://chatgpt.com',
  wikipedia: 'https://www.wikipedia.org', maps: 'https://www.google.com/maps', 'google maps': 'https://www.google.com/maps',
  whatsapp: 'https://web.whatsapp.com', 'whatsapp web': 'https://web.whatsapp.com', amazon: 'https://www.amazon.com', 'google drive': 'https://drive.google.com',
};
const SEARCH_SITES = ['youtube', 'google', 'bing', 'duckduckgo', 'wikipedia', 'github', 'amazon'];
export const APP_ALIASES = {
  'google chrome': 'chrome', 'microsoft edge': 'edge', 'vs code': 'code', vscode: 'code', 'visual studio code': 'code',
  'file explorer': 'explorer', 'task manager': 'taskmgr', 'command prompt': 'cmd', 'control panel': 'control', calc: 'calculator',
  word: 'word', excel: 'excel', powerpoint: 'powerpoint', 'ms word': 'word', 'ms excel': 'excel',
};
export const KNOWN_APPS = new Set(['chrome', 'edge', 'firefox', 'brave', 'opera', 'spotify', 'vlc', 'notepad', 'calculator', 'paint', 'word', 'excel',
  'powerpoint', 'outlook', 'teams', 'discord', 'whatsapp', 'telegram', 'zoom', 'code', 'steam', 'obsidian', 'cmd', 'powershell', 'terminal',
  'settings', 'taskmgr', 'control', 'explorer', 'snipping tool', 'onenote', 'photoshop', 'slack', 'postman', 'notion', 'figma', 'obs', 'itunes', 'netflix', 'chatgpt']);

const MEDIA_WORDS = /\b(movie|film|video|episode|season|series|song|music|track|album|mp3|mp4)\b/;
const TYPE_WORDS = /\b(?:movie|film|video|file|document|doc|song|track)\b/g;
const EXT = /\.(mp4|mkv|avi|mov|wmv|webm|mp3|flac|wav|m4a|pdf|docx?|xlsx?|pptx?|txt|csv|png|jpe?g|gif|zip)$/i;
const URL_RE = /^(?:https?:\/\/\S+|www\.\S+|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|rw|co|dev|app|ai|edu|gov|info|tv|me|ly|uk)(?:[/?#]\S*)?)$/i;
const MULTI = /\b(and|then|after|also|before)\b|,|;/;
// "search …" is a web search unless it is clearly about this PC ("in my movie folder", "on my pc") or wants an answer back.
const PC_SEARCH = /\b(?:my|this)\s+(?:\w+\s+)?(?:files?|folders?|downloads?|documents?|desktop|videos?|movies?|films?|music|songs?|pictures?|photos?|pc|computer|laptop|drive)\b|\b(?:in|inside|from|across|through)\s+(?:the\s+)?\w*\s*(?:folders?|director(?:y|ies)|downloads|documents|desktop|videos|pictures|music)\b|\b(?:folders?|director(?:y|ies)|file\s+(?:manager|explorer))\b|\band\s+(?:tell|show|see|list|give)\b/;
const WEB_HINT = /\b(?:online|on the (?:internet|web)|the web|internet)\b/;
const FILLER = new Set(['called', 'named', 'titled', 'the', 'in', 'of']);
// "film called trigger ep 1 in potplayer" -> { q: 'trigger ep 1', with: 'potplayer' }
function mediaQuery(rest) {
  let w = null;
  const m = rest.match(/\s+(?:in|with|using|on)\s+([a-z0-9][\w.-]*(?:\s[a-z0-9][\w.-]*)?)$/);
  if (m && !/\b(?:my|folders?|downloads|documents|desktop|videos|pictures|music|pc|computer)\b/.test(m[1]) && !MEDIA_WORDS.test(m[1])) { w = APP_ALIASES[m[1]] || m[1]; rest = rest.slice(0, m.index); }
  const words = rest.replace(new RegExp(MEDIA_WORDS, 'g'), ' ').replace(TYPE_WORDS, ' ').split(/\s+/).filter((x) => x && !FILLER.has(x));
  return { q: [...new Set(words)].join(' '), with: w };
}

const out = (action, params, confidence, normalized, reason) => ({ action, params, confidence, normalized, reason });
const unknown = (n, confidence, reason) => out('unknown', {}, confidence, n, reason);

function pickVerb(words) {
  let [w, w2] = words;
  if (!w) return null;
  if (w === 'go' && w2 === 'to') return { verb: 'open', rest: words.slice(2), typo: false };
  if (w === 'look' && (w2 === 'up' || w2 === 'for')) return { verb: 'search', rest: words.slice(2), typo: false };
  if (VERBS[w]) return { verb: VERBS[w], rest: words.slice(1), typo: false };
  if (w.length >= 4) {
    const near = FUZZY_VERBS.find((v) => typoDistance(w, v) <= (w.length >= 6 ? 2 : 1));
    if (near) return { verb: VERBS[near], rest: words.slice(1), typo: true };
  }
  return null;
}

const cleanQuery = (s) => s.replace(/^(?:for|up|about)\s+/, '').trim();

export function parseIntent(text) {
  const raw = String(text ?? '').trim();
  const n = normalize(raw);
  if (!n) return unknown(n, 0, 'empty');
  const words = n.split(' ');
  if (words.length > 16) return unknown(n, 0.1, 'too long for the fast path');

  // Built-in PC controls (volume, camera, screenshot, close app, shutdown…): no AI needed.
  const pc = parseSystem(n);
  if (pc) return out('pc', pc, 0.95, n, 'pc control');

  // A bare URL ("youtube.com", "https://x.com/a") just opens.
  if (words.length === 1 && URL_RE.test(words[0])) return out('open_url', { url: toUrl(rawToken(raw, words[0])) }, 0.92, n, 'bare url');

  const v = pickVerb(words);
  if (!v) return unknown(n, 0.2, 'no known verb');
  const typoPenalty = v.typo ? 0.1 : 0;
  let rest = v.rest.join(' ').trim();
  if (!rest) return unknown(n, 0.1, 'verb without a target');
  // Search words must reach the search engine exactly as typed (keep "me", "a", years), so they come from the unfiltered text.
  const rv = pickVerb(normalize(raw, { keepAll: true }).split(' '));
  const restRaw = rv ? rv.rest.join(' ').trim() : rest;

  // "... in/using chrome" at the end
  let browser = null;
  let searchRest = restRaw;
  const bm0 = searchRest.match(/\s+(?:in|on|with|using|via|through)\s+(google chrome|microsoft edge|chrome|edge|firefox|brave|opera)$/);
  const bm = rest.match(/\s+(?:in|on|with|using|via|through)\s+(google chrome|microsoft edge|chrome|edge|firefox|brave|opera)$/);
  if (bm) { browser = BROWSERS[bm[1]]; rest = rest.slice(0, bm.index).trim(); }

  // "open chrome and search X"
  const ba = restRaw.match(/^(google chrome|microsoft edge|chrome|edge|firefox|brave|opera)\s+(?:and|then)\s+(?:search|google|look up|lookup)(?:\s+for)?\s+(.+)$/);
  if (ba && v.verb === 'open') return out('search_web', { query: cleanQuery(ba[2]), browser: BROWSERS[ba[1]] }, 0.92 - typoPenalty, n, 'browser then search');

  if (v.verb === 'search') {
    let site = null;
    if (bm0) searchRest = searchRest.slice(0, bm0.index).trim();
    const sm = searchRest.match(new RegExp(`\\s+(?:on|in|at)\\s+(${SEARCH_SITES.join('|')})$`));
    if (sm) { site = sm[1]; searchRest = searchRest.slice(0, sm.index).trim(); }
    if (!browser && !site && words[0] !== 'google' && !WEB_HINT.test(restRaw) && PC_SEARCH.test(restRaw)) return unknown(n, 0.4, 'search on this PC: the AI decides');
    const query = cleanQuery(searchRest);
    if (!query) return unknown(n, 0.1, 'nothing to search for');
    const params = { query };
    if (browser) params.browser = browser;
    if (site && site !== 'google') params.site = site;
    return out('search_web', params, 0.92 - typoPenalty - (browser || site ? 0.03 : 0), n, 'search');
  }
  if (v.verb === 'find') return unknown(n, 0.3, '"find" can mean many things, the AI decides');

  // Everything below is "open/play something": reject multi-step shapes.
  if (MULTI.test(rest)) return unknown(n, 0.2, 'looks like more than one step');

  if (v.verb === 'play') {
    if (/\s+(?:on|in|using|with)\s+(spotify|youtube|apple music|deezer|soundcloud|netflix)$/.test(rest)) return unknown(n, 0.4, 'play inside an app needs the AI');
    const { q, with: app } = mediaQuery(rest);
    return q ? out('open_file', { query: q, media: true, ...(app && { with: app }) }, 0.8 - typoPenalty, n, 'play a local media file') : unknown(n, 0.2, 'nothing to play');
  }

  // v.verb === 'open'
  const target = rest;
  if (URL_RE.test(target)) return out('open_url', withBrowser({ url: toUrl(rawToken(raw, target)) }, browser), 0.93 - typoPenalty, n, 'url');
  // A name that is both an app and a site ("whatsapp", "netflix"): the installed desktop app first, the website only if it
  // isn't installed. "whatsapp web" or "... in chrome" still means the website.
  const both = APP_ALIASES[target] || target;
  if (SITES[target] && KNOWN_APPS.has(both) && !browser) return out('open_app', { name: both, url: SITES[target] }, 0.95 - typoPenalty, n, 'app, else its website');
  if (SITES[target]) return out('open_url', withBrowser({ url: SITES[target] }, browser), 0.95 - typoPenalty, n, 'known site');
  const folderWord = target.replace(/\s*(?:folder|directory|dir)$/, '').trim();
  if (FOLDERS[folderWord]) return out('open_folder', { folder: FOLDERS[folderWord] }, 0.95 - typoPenalty, n, 'known folder');
  const fm = target.match(/^(?:folder|directory)\s+(.+)$/) || target.match(/^(.+?)\s+(?:folder|directory)$/);
  if (fm) return out('open_folder', { name: fm[1].replace(TYPE_WORDS, ' ').trim() }, 0.82 - typoPenalty, n, 'named folder');
  const ext = target.match(EXT);
  if (MEDIA_WORDS.test(target) || ext || /^file\s/.test(target)) {
    const { q, with: app } = ext ? { q: target.replace(TYPE_WORDS, ' ').replace(/\s+/g, ' ').trim() } : mediaQuery(target);
    const params = { query: ext ? q.replace(EXT, '').trim() || q : q, media: MEDIA_WORDS.test(target) };
    if (app) params.with = app;
    if (ext) params.ext = ext[1].toLowerCase();
    return q ? out('open_file', params, 0.85 - typoPenalty, n, 'open a file') : unknown(n, 0.2, 'no file name');
  }
  const app = APP_ALIASES[target] || target;
  if (browser && !KNOWN_APPS.has(app)) return unknown(n, 0.3, 'unclear target');
  if (KNOWN_APPS.has(app)) return out('open_app', { name: app }, 0.96 - typoPenalty, n, 'known app');
  if (target.split(' ').length <= 3 && !/\b(about|with|that|which|where|how|what|why|who|from|for|into)\b/.test(target)) {
    return out('open_app', { name: target }, 0.8 - typoPenalty, n, 'maybe an app');
  }
  return unknown(n, 0.4, 'unclear target');
}

function withBrowser(p, browser) { if (browser) p.browser = browser; return p; }
function toUrl(t) { return /^https?:\/\//i.test(t) ? t : `https://${t}`; }
// URLs keep their original letter case (paths can be case-sensitive): find the token in the raw text.
function rawToken(raw, lowered) {
  const hit = raw.split(/\s+/).find((w) => w.replace(/[^\p{L}\p{N}]+$/u, '').toLowerCase() === lowered.replace(/[^\p{L}\p{N}]+$/u, ''));
  return (hit || lowered).replace(/[,;!?)]+$/, '');
}

/**
 * "open spotify and put volume at 40%" -> ['open spotify', 'put volume at 40%'] (2-4 parts), else null.
 * The caller only runs the parts if EVERY part is a command the parser understands, so "search cats and dogs" stays one task.
 */
export function splitTask(text) {
  const parts = String(text || '').split(/\s*(?:,|;|\band then\b|\bthen\b|\band\b|&)\s*/i).map((s) => s.trim()).filter(Boolean);
  return parts.length >= 2 && parts.length <= 4 ? parts : null;
}

// Is this task about the user's files or folders? Only then does the AI get the folder map (smaller, faster prompts).
const FILE_TASK = /\b(?:files?|folders?|director(?:y|ies)|documents?|docs?|pdfs?|downloads?|desktop|pictures?|photos?|images?|screenshots?|videos?|movies?|films?|music|songs?|episodes?|mp3|mp4|mkv|excel|spreadsheets?|word\s+doc|zip|rar|backup|rename|move|copy|delete|remove|find|search\s+(?:my|for\s+my)|organi[sz]e|sort|clean\s*up|save|onedrive)\b|[a-z]:\|\.(?:pdf|docx?|xlsx?|pptx?|txt|csv|jpe?g|png|mp4|mkv|mp3|zip)\b/i;
const FILE_WORDS = ['film', 'movie', 'folder', 'file', 'video', 'episode', 'download', 'document', 'picture', 'music'];
// Typos too ("open fiml called trigger"), so the AI still gets the folder map.
export const isFileTask = (text) => FILE_TASK.test(String(text || '')) ||
  normalize(text).split(' ').some((w) => w.length >= 4 && FILE_WORDS.some((f) => typoDistance(w, f) <= (f.length >= 6 ? 2 : 1)));
