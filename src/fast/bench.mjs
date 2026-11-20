// The accuracy benchmark: typed requests -> parseIntent -> open_app (with a fake PC) -> what actually got started.
// Run: node src/fast/bench.mjs      (prints the report; bench.test.mjs fails the build if accuracy drops)
import { buildEntries } from './catalog.js';
import { parseIntent, FAST_MIN } from './intent.js';
import { makeActions } from './actions.js';

const A = (name, t = `C:\\Apps\\${name}.exe`) => ({ kind: 'app', name, launch: { type: 'exe', target: t }, source: 'startmenu' });
const P = (name) => ({ kind: 'pwa', name, launch: { type: 'lnk', target: `C:\\SM\\${name}.lnk`, args: '--app-id=x' }, source: 'startmenu' });
const S = (name) => ({ kind: 'store', name, launch: { type: 'store', target: `shell:AppsFolder\\${name}!App` }, source: 'store' });
const G = (name) => ({ kind: 'program', name, launch: { type: 'exe', target: `C:\\Prog\\${name}.exe` }, source: 'registry' });
const B = (name, url) => ({ kind: 'site', name, launch: { type: 'url', url, browser: 'chrome', profile: 'KEVIN' }, source: 'bookmarks:chrome:KEVIN' });

export const PC = buildEntries([
  A('Google Chrome'), A('Microsoft Edge'), A('Firefox'), A('Brave'), P('Spotify'), G('Spotify'), A('Spotify Uninstaller'), A('VLC media player'),
  A('Notepad'), A('Notepad++'), A('Calculator'), A('Paint'), A('Microsoft Word'), A('Microsoft Excel'), A('Microsoft PowerPoint'), A('Outlook'),
  A('Microsoft Teams'), A('Discord'), S('WhatsApp'), A('Telegram Desktop'), A('Zoom'), A('Visual Studio Code'), A('Steam'), A('Obsidian'),
  A('Windows Terminal'), A('Task Manager'), A('Snipping Tool'), A('OneNote'), A('OneDrive'), A('Adobe Photoshop 2024'), A('Slack'), A('Postman'),
  A('Notion'), A('Figma'), A('OBS Studio'), A('iTunes'), S('Netflix'), A('Docker Desktop'), A('Git Bash'), G('Node.js'), G('Python 3.12'), A('7-Zip File Manager'),
  A('WinRAR'), A('Adobe Acrobat'), A('Epic Games Launcher'), A('Visual Studio 2022'), A('Android Studio'), A('MySQL Workbench'), A('GitHub Desktop'),
  A('Sublime Text'), A('AnyDesk'), A('TeamViewer'), A('uTorrent'), P('Canva'), P('ChatGPT'), P('YouTube'), A('PotPlayer'), A('Camtasia'),
  G('Microsoft Visual C++ 2015-2022 Redistributable'), G('Python 3.12 Documentation'), A('Skype'), A('Xbox'), A('Camera'), A('Photos'),
  B('Kevin portfolio', 'https://kevin.dev'), B('Jira board', 'https://jira.example.com'),
]);

// [what the user typed after "open", the app that must start (by display name), or null = nothing may start without asking]
export const CASES = [
  // exact
  ...[['spotify', 'Spotify'], ['discord', 'Discord'], ['slack', 'Slack'], ['postman', 'Postman'], ['notion', 'Notion'], ['figma', 'Figma'], ['steam', 'Steam'], ['obsidian', 'Obsidian'],
    ['zoom', 'Zoom'], ['outlook', 'Outlook'], ['firefox', 'Firefox'], ['brave', 'Brave'], ['anydesk', 'AnyDesk'], ['winrar', 'WinRAR'], ['paint', 'Paint'], ['calculator', 'Calculator'],
    ['whatsapp', 'WhatsApp'], ['netflix', 'Netflix'], ['canva', 'Canva'], ['onenote', 'OneNote'], ['onedrive', 'OneDrive'], ['teamviewer', 'TeamViewer'], ['skype', 'Skype'], ['camtasia', 'Camtasia']],
  // typos
  ...[['spotfy', 'Spotify'], ['spotiyf', 'Spotify'], ['spotifi', 'Spotify'], ['discrod', 'Discord'], ['disord', 'Discord'], ['slak', 'Slack'], ['postmen', 'Postman'], ['notoin', 'Notion'],
    ['figam', 'Figma'], ['stema', 'Steam'], ['obsidan', 'Obsidian'], ['zoomm', 'Zoom'], ['outlok', 'Outlook'], ['firefx', 'Firefox'], ['whatsap', 'WhatsApp'], ['whatsupp', 'WhatsApp'],
    ['netflx', 'Netflix'], ['netfllix', 'Netflix'], ['chrom', 'Google Chrome'], ['chorme', 'Google Chrome'], ['exel', 'Microsoft Excel'], ['wrod', 'Microsoft Word'], ['powerpoit', 'Microsoft PowerPoint'],
    ['calculater', 'Calculator'], ['calcuator', 'Calculator'], ['onedrve', 'OneDrive'], ['tmeviewer', 'TeamViewer'], ['canvas', 'Canva'], ['chatgtp', 'ChatGPT'], ['youtub', 'YouTube']],
  // short names / abbreviations / partial names
  ...[['vsc', 'Visual Studio Code'], ['visual studio', 'Visual Studio 2022'], ['vs code', 'Visual Studio Code'], ['vscode', 'Visual Studio Code'], ['code', 'Visual Studio Code'], ['chrome', 'Google Chrome'], ['edge', 'Microsoft Edge'],
    ['word', 'Microsoft Word'], ['excel', 'Microsoft Excel'], ['powerpoint', 'Microsoft PowerPoint'], ['teams', 'Microsoft Teams'], ['telegram', 'Telegram Desktop'], ['vlc', 'VLC media player'],
    ['photoshop', 'Adobe Photoshop 2024'], ['acrobat', 'Adobe Acrobat'], ['docker', 'Docker Desktop'], ['obs', 'OBS Studio'], ['terminal', 'Windows Terminal'],
    ['snipping', 'Snipping Tool'], ['android studio', 'Android Studio'], ['epic', 'Epic Games Launcher'], ['mysql', 'MySQL Workbench'], ['github desktop', 'GitHub Desktop'], ['sublime', 'Sublime Text'],
    ['7zip', '7-Zip File Manager'], ['utorrent', 'uTorrent'], ['potplayer', 'PotPlayer'], ['git bash', 'Git Bash']],
  // must NOT open junk (installer / redistributable / docs), and must not guess nonsense
  ['spotify uninstaller', 'Spotify Uninstaller'],
  ['qwertyuiop', null], ['zzzz', null], ['asdf ghjk', null], ['flibbertigibbet', null], ['xyzzy plugh', null],
  // genuinely ambiguous: it must ask (choose) or leave it to the AI, never pick blindly
  ['one', null], ['microsoft', null], ['adobe', null],
];

// Held out: written AFTER the weights were tuned on CASES and never used to tune them. If this drops, the tuning overfit.
export const HELDOUT = [
  ['googel chrome', 'Google Chrome'], ['mircosoft edge', 'Microsoft Edge'], ['firefoxx', 'Firefox'], ['bravee', 'Brave'], ['vlc', 'VLC media player'], ['vlc player', 'VLC media player'],
  ['notepade', 'Notepad'], ['paitn', 'Paint'], ['micosoft word', 'Microsoft Word'], ['outlookk', 'Outlook'], ['teems', 'Microsoft Teams'], ['telegram', 'Telegram Desktop'],
  ['zom', 'Zoom'], ['steem', 'Steam'], ['obsidian notes', null], ['windows terminal', 'Windows Terminal'], ['one note', 'OneNote'], ['one drive', 'OneDrive'], ['photoshop 2024', 'Adobe Photoshop 2024'],
  ['slck', 'Slack'], ['postman', 'Postman'], ['notion', 'Notion'], ['figma', 'Figma'], ['docker desktop', 'Docker Desktop'], ['dockr', 'Docker Desktop'], ['git bash', 'Git Bash'],
  ['gitbash', 'Git Bash'], ['winrarr', 'WinRAR'], ['acrobat reader', 'Adobe Acrobat'], ['epic games', 'Epic Games Launcher'], ['sublime text', 'Sublime Text'], ['anydsk', 'AnyDesk'],
  ['utorent', 'uTorrent'], ['camtasia', 'Camtasia'], ['xbox', 'Xbox'], ['photos', 'Photos'], ['camera', 'Camera'], ['skyp', 'Skype'],
  ['blargh', null], ['qqqq', null], ['hello world foo', null], ['lorem ipsum', null],
];

function fake() {
  const started = [], answers = [];
  const d = {
    shell: { openPath: async (p) => { started.push(p); return ''; }, openExternal: async (u) => { started.push(u); } },
    resolveApp: () => null, spawnDetached: (t) => started.push(t), paths: {}, exists: () => true, isAllowed: () => true,
    catalog: () => PC, prefs: () => ({}), learned: () => ({}), learn() {}, confuse() {}, catalogTouch() {}, browserProfiles: async () => [],
  };
  return { A: makeActions(d), started, answers };
}

export async function runBench(cases = CASES) {
  const rows = []; let top1 = 0, wrong = 0, asked = 0, blind = 0, should = 0, expectNone = 0;
  for (const [typed, want] of cases) {
    const it = parseIntent(`open ${typed}`);
    const t = fake();
    let res = null;
    if (it.action === 'open_app' && it.confidence >= FAST_MIN) res = await t.A.open_app(it.params);
    const opened = res?.status === 'done' ? PC.find((e) => e.launch.target === t.started[0] || e.launch.url === t.started[0])?.name ?? t.started[0] : null;
    const toAI = !res || res.status === 'fall';
    const choose = res?.status === 'choose' ? res.options.map((o) => o.label) : null;
    if (want) { should++; if (opened === want) top1++; else if (opened) wrong++; else if (choose?.includes(want)) asked++; }
    else { expectNone++; if (opened) blind++; }
    rows.push({ typed, want, opened, choose, toAI });
  }
  return { rows, total: cases.length, should, top1, wrong, asked, blind, expectNone,
    top1Rate: top1 / should, wrongRate: wrong / should, blindRate: expectNone ? blind / expectNone : 0 };
}

if (process.argv[1] && process.argv[1].endsWith('bench.mjs')) {
  for (const [label, cases] of [['TUNED', CASES], ['HELD-OUT', HELDOUT]]) {
  const r = await runBench(cases); console.log(`--- ${label}`);
  for (const x of r.rows.filter((x) => x.want ? x.opened !== x.want : x.opened)) console.log(`MISS  open ${x.typed.padEnd(18)} want ${String(x.want).padEnd(22)} got ${x.opened ?? (x.choose ? 'choose ' + x.choose.join(' / ') : x.toAI ? '-> AI' : '?')}`);
  console.log(`\n${r.total} requests. Opened the right thing: ${r.top1}/${r.should} (${(r.top1Rate * 100).toFixed(1)}%). Opened the WRONG thing: ${r.wrong} (${(r.wrongRate * 100).toFixed(1)}%). Asked with the right one offered: ${r.asked}. Opened something for junk/ambiguous input: ${r.blind}/${r.expectNone}.`);
  }
}
