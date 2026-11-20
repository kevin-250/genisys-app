// Questions whose answer changes over time (news, releases, prices, scores…). The model's training data is old, so for
// these the app searches the web FIRST and gives the model the results, instead of trusting it to decide to search.
const CHANGES = new RegExp([
  String.raw`\b(?:news|headlines?|latest|newest|recent(?:ly)?|currently|right now|nowadays|this (?:week|month|year)|today'?s|tonight'?s)\b`,
  String.raw`\b(?:release date|released?|come out|comes out|coming out|launch(?:es|ed|ing)?|out yet|announced?|delayed?|trailer)\b`,
  String.raw`\b(?:price|prices|cost|costs|worth|stock|shares?|exchange rate|bitcoin|crypto)\b`,
  String.raw`\b(?:score|who won|winner|results?|standings|match|election|president|prime minister|ceo of)\b`,
  String.raw`\b(?:still alive|died|dead|age of|how old is)\b`,
  String.raw`\b20(?:2[4-9]|3\d)\b`, // a recent or future year
].join('|'), 'i');
// about this PC, the user's own things or the app itself: never the web
const LOCAL = /\b(?:my (?:pc|computer|laptop|files?|folders?|desktop|downloads|documents|music|photos|pictures|videos|screen|timers?|alarms?|reminders?|notes?|lists?|calendar|battery|ram|memory|storage|disk)|this (?:pc|computer|laptop)|genisys|on my|in my|wifi|bluetooth|volume|brightness)\b/i;
const COMMAND = /^\s*(?:please\s+)?(?:open|close|play|pause|stop|start|launch|run|create|make|delete|remove|rename|move|copy|set|turn|send|write|install|uninstall|find|show me my|remind)\b/i;

// the time somewhere comes from the PC clock (world_time), never from news headlines
const CLOCK = /\b(?:what time|what's the time|what is the time|time (?:is it|in|now|right now)|time zone|timezone)\b/i;

export function needsFresh(text, { isFile = false } = {}) {
  const t = String(text ?? '').trim();
  if (!t || isFile || LOCAL.test(t) || COMMAND.test(t) || CLOCK.test(t)) return false;
  return CHANGES.test(t);
}

// the words worth searching for: the question without the chat around it
export function freshQuery(text) {
  return String(text ?? '')
    .replace(/^\s*(?:hey\s+genisys[,\s]*|please\s+|can you\s+|could you\s+|do you know\s+|tell me\s+|i want to know\s+)+/i, '')
    .replace(/^\s*(?:tell me|please)\s+/i, '')
    .replace(/[?!.\s]+$/, '')
    .slice(0, 120).trim();
}
