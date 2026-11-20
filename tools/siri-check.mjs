// Everyday "Siri-style" requests: which ones the code handles instantly, which go to the AI.
// Usage: node tools/siri-check.mjs   (prints FAST / AI per line; the AI ones are candidates for a tool)
import { parseIntent } from '../src/fast/intent.js';
import { FAST_MIN } from '../src/fast/intent.js';
export const SIRI = [
  // timers, alarms, stopwatch
  'set a timer for 10 minutes', 'timer 5 minutes', 'set a 20 minute timer for the rice', 'how much time is left on my timer', 'cancel the timer', 'stop the timer',
  'wake me up at 6am', 'set an alarm for 7:30', 'set an alarm for 6:45 am tomorrow', 'cancel my alarm', 'what alarms do i have',
  'start a stopwatch', 'stop the stopwatch', 'how long has the stopwatch been running',
  'remind me in 30 minutes to take my medicine', 'remind me at 5pm to call kevin', 'what are my reminders',
  // time and date
  'what time is it', "what's the date today", 'what day is it', 'what time is it in london', 'how many days until christmas',
  // notes
  'take a note buy milk and bread', 'note: call the landlord', 'show my notes', 'read my notes',
  // music and media
  'play some music', 'play gospel music', 'pause the music', 'next song', 'previous song', 'turn it up', 'volume 50', 'mute',
  // device
  'turn on dark mode', 'turn off wifi', 'turn on bluetooth', 'take a screenshot', 'open the camera', 'how much battery do i have', 'brightness 70', 'lock my computer', 'turn on do not disturb',
  // quick answers
  'flip a coin', 'roll a dice', 'pick a number between 1 and 10', "what's 15% of 80", 'what is 25 times 4', 'convert 100 dollars to rwandan francs', "what's the weather today", 'weather in kigali tomorrow',
  'how do you spell necessary', 'define serendipity', 'translate good morning to french', 'tell me a joke',
  // communication
  'send hello to mom on whatsapp', 'open whatsapp', 'email kevin@example.org about the meeting',
  // web and apps
  'open youtube', 'search for cheap flights to nairobi', 'open calculator', 'find my cv', 'open my downloads',
];
const fast = [], ai = [];
for (const q of SIRI) { const r = parseIntent(q); (r.action !== 'unknown' && r.confidence >= FAST_MIN ? fast : ai).push(`${q}  ->  ${r.action}${r.action !== 'unknown' ? ` ${JSON.stringify(r.params)}` : ` (${r.reason})`}`); }
console.log(`FAST ${fast.length}/${SIRI.length}\n  ${fast.join('\n  ')}\n\nAI ${ai.length}\n  ${ai.join('\n  ')}`);
