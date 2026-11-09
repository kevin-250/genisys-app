// Built-in PC controls: one catalog for the code parser (no AI), the router, the AI loop and the executor.
// Pure code (no node imports): the page uses parseSystem, the main process runs makeSystem(deps).

// Settings pages anyone may ask for (ms-settings: links).
export const PAGES = {
  settings: '', display: 'display', sound: 'sound', bluetooth: 'bluetooth', wifi: 'network-wifi', network: 'network-status',
  airplane: 'network-airplanemode', battery: 'batterysaver', power: 'powersleep', storage: 'storagesense', apps: 'appsfeatures',
  updates: 'windowsupdate', notifications: 'notifications', default_apps: 'defaultapps', mouse: 'mousetouchpad', keyboard: 'typing',
  date_time: 'dateandtime', privacy: 'privacy', personalization: 'personalization', night_light: 'nightlight', camera: 'privacy-webcam',
};

// id -> { ask: confirmation question (asked before running), help: what it does (shown to the router / AI) }
export const CONTROLS = {
  volume: { help: 'set volume to value 0-100' }, volume_up: { help: 'louder (value = step, default 10)' }, volume_down: { help: 'quieter' },
  mute: { help: 'mute sound' }, unmute: { help: 'unmute sound' },
  play_pause: { help: 'play/pause music or video' }, next_track: { help: 'next song' }, previous_track: { help: 'previous song' }, stop_media: { help: 'stop music' },
  brightness: { help: 'screen brightness value 0-100 (laptops)' }, brightness_up: { help: 'brighter' }, brightness_down: { help: 'dimmer' },
  camera: { help: 'open the camera' }, screenshot: { help: 'take a screenshot, saved to Pictures/Screenshots' }, snip: { help: 'snip part of the screen' },
  wifi_on: { help: 'turn Wi-Fi on' }, wifi_off: { help: 'turn Wi-Fi off', ask: 'Turn Wi-Fi off? You will be offline.' },
  bluetooth_on: { help: 'turn Bluetooth on' }, bluetooth_off: { help: 'turn Bluetooth off' },
  dark_mode: { help: 'Windows dark mode' }, light_mode: { help: 'Windows light mode' },
  close_app: { help: 'close an app (name = app; value 1 = force)' },
  close_all: { help: 'close all open apps', ask: 'Close all open apps? Unsaved work in them may be lost.' },
  lock: { help: 'lock the PC' },
  sleep: { help: 'put the PC to sleep', ask: 'Put your PC to sleep now?' },
  hibernate: { help: 'hibernate the PC', ask: 'Hibernate your PC now?' },
  restart: { help: 'restart the PC', ask: 'Restart your PC now? Save your work first.' },
  shutdown: { help: 'shut down the PC', ask: 'Shut down your PC now? Save your work first.' },
  sign_out: { help: 'sign out of Windows', ask: 'Sign out of Windows now? Open apps will close.' },
  shutdown_in: { help: 'shut down in value minutes', ask: 'Shut down your PC in {v} minutes?' },
  restart_in: { help: 'restart in value minutes', ask: 'Restart your PC in {v} minutes?' },
  cancel_shutdown: { help: 'cancel a scheduled shutdown/restart' },
  show_desktop: { help: 'minimize all windows' },
  task_manager: { help: 'open Task Manager' }, control_panel: { help: 'open Control Panel' }, device_manager: { help: 'open Device Manager' },
  file_explorer: { help: 'open File Explorer' },
  open_settings: { help: `open a Settings page (name = ${Object.keys(PAGES).join('|')})` },
  battery: { help: 'battery level' }, disk_space: { help: 'free disk space' }, memory: { help: 'RAM use' }, cpu: { help: 'CPU use' },
  windows_version: { help: 'Windows version' }, uptime: { help: 'how long the PC has been on' }, ip_address: { help: 'IP address' }, wifi_name: { help: 'connected Wi-Fi name' },
  empty_recycle_bin: { help: 'empty the Recycle Bin', ask: 'Empty the Recycle Bin? Deleted files there will be gone for good.' },
};

const n = (s) => (s === undefined ? undefined : Number(s));
const PAGE_WORDS = { 'wi-fi': 'wifi', 'wi fi': 'wifi', 'date and time': 'date_time', time: 'date_time', 'default apps': 'default_apps', update: 'updates', 'windows update': 'updates', 'night light': 'night_light', theme: 'personalization', background: 'personalization', speaker: 'sound', speakers: 'sound', audio: 'sound', screen: 'display', touchpad: 'mouse', airplane: 'airplane', 'airplane mode': 'airplane', 'battery saver': 'battery', sleep: 'power' };

// [pattern on normalized text, id, (match) -> extra params]. First match wins; anchored so normal sentences don't match.
const RULES = [
  [/^(?:(?:set|put|turn|change|make)\s+)?(?:volume|sound)\s+(?:to\s+|at\s+)?(\d{1,3})\s*%?$/, 'volume', (m) => ({ value: n(m[1]) })],
  [/^(?:set|put|turn|change)\s+(?:volume|sound)\s+(?:to|at)\s+(\d{1,3})\s*%?$/, 'volume', (m) => ({ value: n(m[1]) })],
  [/^(?:volume|sound)\s+(?:up|higher|louder)(?:\s+(?:by\s+)?(\d{1,2}))?$|^(?:turn|make)\s+(?:it|volume|sound|music)\s+(?:up|louder)$|^louder$/, 'volume_up', (m) => (m[1] ? { value: n(m[1]) } : {})],
  [/^(?:volume|sound)\s+(?:down|lower|quieter)(?:\s+(?:by\s+)?(\d{1,2}))?$|^(?:turn|make)\s+(?:it|volume|sound|music)\s+(?:down|quieter)$|^quieter$/, 'volume_down', (m) => (m[1] ? { value: n(m[1]) } : {})],
  [/^(?:mute|silence)(?:\s+(?:sound|volume|audio|pc|computer|it))?$/, 'mute'],
  [/^unmute(?:\s+(?:sound|volume|audio|pc|computer|it))?$|^turn\s+(?:sound|audio)\s+(?:back\s+)?on$/, 'unmute'],
  [/^(?:play|pause|resume)(?:\s+(?:music|song|video|it|media))?$|^play\s*\/\s*pause$/, 'play_pause'],
  [/^(?:next|skip)(?:\s+(?:song|track|music))?$|^skip\s+(?:this\s+)?(?:song|track)$/, 'next_track'],
  [/^(?:previous|last|back)\s+(?:song|track)$/, 'previous_track'],
  [/^stop\s+(?:music|song|playing|media)$/, 'stop_media'],
  [/^(?:(?:set|put|turn|change|make)\s+)?brightness\s+(?:to\s+|at\s+)?(\d{1,3})\s*%?$/, 'brightness', (m) => ({ value: n(m[1]) })],
  [/^brightness\s+up$|^(?:make\s+)?(?:screen\s+)?brighter$|^(?:increase|raise)\s+brightness$/, 'brightness_up'],
  [/^brightness\s+down$|^(?:make\s+)?(?:screen\s+)?(?:dimmer|darker)$|^(?:decrease|lower|reduce)\s+brightness$|^dim\s+(?:the\s+)?screen$/, 'brightness_down'],
  [/^(?:open|start|launch|turn\s+on)\s+(?:camera|webcam)(?:\s+app)?$|^camera$/, 'camera'],
  [/^(?:take|capture|grab)\s+(?:a\s+)?(?:screenshot|screen\s*shot|screen\s+capture|picture\s+of\s+(?:my\s+)?screen)$|^screenshot$/, 'screenshot'],
  [/^snip(?:\s+(?:screen|part\s+of\s+screen))?$|^(?:open\s+)?snipping\s+tool$/, 'snip'],
  [/^(?:turn|switch)\s+(?:on\s+)?wi-?\s?fi(?:\s+on)?$|^(?:enable|connect)\s+wi-?\s?fi$|^wi-?\s?fi\s+on$/, 'wifi_on'],
  [/^(?:turn|switch)\s+(?:off\s+)?wi-?\s?fi\s+off$|^(?:turn|switch)\s+off\s+wi-?\s?fi$|^(?:disable|disconnect)\s+wi-?\s?fi$|^wi-?\s?fi\s+off$/, 'wifi_off'],
  [/^(?:turn|switch)\s+(?:on\s+)?bluetooth(?:\s+on)?$|^(?:enable)\s+bluetooth$|^bluetooth\s+on$/, 'bluetooth_on'],
  [/^(?:turn|switch)\s+(?:off\s+bluetooth|bluetooth\s+off)$|^disable\s+bluetooth$|^bluetooth\s+off$/, 'bluetooth_off'],
  [/^(?:turn\s+on\s+|switch\s+to\s+|enable\s+|use\s+)?dark\s+(?:mode|theme)(?:\s+on)?$/, 'dark_mode'],
  [/^(?:turn\s+on\s+|switch\s+to\s+|enable\s+|use\s+)?light\s+(?:mode|theme)(?:\s+on)?$|^(?:turn|switch)\s+off\s+dark\s+mode$/, 'light_mode'],
  [/^(?:close|quit|exit)\s+(?:all|every(?:thing)?|all\s+(?:open\s+)?(?:apps|applications|programs|windows))(?:\s+(?:apps|programs|windows))?$/, 'close_all'],
  [/^(?:force\s+(?:close|quit)|kill|end\s+task)\s+(.+)$/, 'close_app', (m) => ({ name: m[1], value: 1 })],
  [/^(?:close|quit|exit)\s+(.+?)(?:\s+(?:app|application|program|window))?$/, 'close_app', (m) => ({ name: m[1] })],
  [/^lock(?:\s+(?:pc|computer|screen|laptop|it))?$/, 'lock'],
  [/^(?:(?:shut|turn)\s*(?:down|off)|power\s+off)\s+(?:pc\s+|computer\s+|laptop\s+)?in\s+(\d{1,4})\s*(?:min|mins|minutes?)$/, 'shutdown_in', (m) => ({ value: n(m[1]) })],
  [/^restart\s+(?:pc\s+|computer\s+)?in\s+(\d{1,4})\s*(?:min|mins|minutes?)$/, 'restart_in', (m) => ({ value: n(m[1]) })],
  [/^cancel\s+(?:the\s+)?(?:shutdown|shut\s+down|restart)$|^(?:don\s?t|do\s+not)\s+shut\s*down$/, 'cancel_shutdown'],
  [/^(?:put\s+(?:pc|computer|laptop|it)\s+to\s+)?sleep(?:\s+(?:pc|computer|laptop|now))?$|^go\s+to\s+sleep$/, 'sleep'],
  [/^hibernate(?:\s+(?:pc|computer|laptop|now))?$/, 'hibernate'],
  [/^(?:restart|reboot)(?:\s+(?:pc|computer|laptop|windows|now))?$/, 'restart'],
  [/^(?:shut\s*down|turn\s+off|power\s+off)(?:\s+(?:pc|computer|laptop|now))?$/, 'shutdown'],
  [/^(?:sign|log)\s*(?:out|off)$/, 'sign_out'],
  [/^(?:show|go\s+to)\s+desktop$|^minimi[sz]e\s+(?:all|everything)(?:\s+windows)?$/, 'show_desktop'],
  [/^(?:open\s+)?task\s+manager$/, 'task_manager'],
  [/^(?:open\s+)?control\s+panel$/, 'control_panel'],
  [/^(?:open\s+)?device\s+manager$/, 'device_manager'],
  [/^(?:open\s+)?(?:file\s+explorer|file\s+manager|explorer|this\s+pc|my\s+computer)$/, 'file_explorer'],
  [/^(?:open\s+)?(?:(.+?)\s+)?settings$/, 'open_settings', (m) => ({ name: m[1] || 'settings' })],
  [/^(?:how\s+much\s+)?battery(?:\s+(?:level|left|percentage|status))?$|^(?:what\s+is\s+|whats\s+)?(?:my\s+)?battery(?:\s+level)?$/, 'battery'],
  [/^(?:how\s+much\s+)?(?:free\s+)?(?:disk|storage|space)(?:\s+(?:space|left|free))?(?:\s+(?:do\s+i\s+have|left))?$|^disk\s+space$/, 'disk_space'],
  [/^(?:how\s+much\s+)?(?:ram|memory)(?:\s+(?:use|usage|used|free|left))?$/, 'memory'],
  [/^cpu(?:\s+(?:use|usage|load))?$/, 'cpu'],
  [/^(?:what\s+|which\s+)?(?:windows\s+version|version\s+of\s+windows)(?:\s+do\s+i\s+have)?$/, 'windows_version'],
  [/^uptime$|^how\s+long\s+(?:has\s+)?(?:pc|computer|laptop)\s+been\s+on$/, 'uptime'],
  [/^(?:what\s+is\s+|whats\s+)?(?:my\s+)?ip(?:\s+address)?$/, 'ip_address'],
  [/^(?:what\s+|which\s+)?wi-?\s?fi(?:\s+(?:name|network))?(?:\s+am\s+i\s+on)?$/, 'wifi_name'],
  [/^(?:empty|clear|clean)\s+(?:recycle\s+bin|trash|bin)$/, 'empty_recycle_bin'],
];

/** Normalized text -> { do, value?, name? } or null. "close" never matches a few words that mean something else. */
export function parseSystem(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  for (const [re, id, extra] of RULES) {
    const m = re.exec(t);
    if (!m) continue;
    const p = { do: id, ...(extra ? extra(m) : {}) };
    if (id === 'open_settings') {
      const w = p.name.replace(/\s+(?:page|menu)$/, '');
      const page = PAGE_WORDS[w] || (w in PAGES ? w : null);
      if (!page) continue; // "open chrome settings" is not a Windows page
      p.name = page;
    }
    if (id === 'close_app' && /^(?:it|this|that|tab|the\s+tab|window)$/.test(p.name)) return null; // ambiguous: let the AI decide
    if ((id === 'volume' || id === 'brightness') && p.value > 100) return null;
    return p;
  }
  // Questions about this PC: "how much battery do I have", "check my free space", "whats my ip", "ram usage"
  const q = t.replace(/^(?:how\s+much|what\s+is|whats|check|show(?:\s+me)?|tell\s+me|see)\s+/, '').replace(/^(?:my|the)\s+/, '')
    .replace(/\s+(?:do\s+i\s+have|is\s+left|left|now|right\s+now|usage|use|level|status|percentage|on\s+(?:this|my)\s+(?:pc|computer|laptop))$/, '').trim();
  const INFO = [[/^(?:battery|charge)$/, 'battery'], [/^(?:free\s+)?(?:disk\s+)?(?:space|storage|disk)$/, 'disk_space'], [/^(?:ram|memory)$/, 'memory'],
    [/^(?:cpu|processor)$/, 'cpu'], [/^ip(?:\s+address)?$/, 'ip_address'], [/^wi-?\s?fi(?:\s+name)?$/, 'wifi_name'], [/^(?:windows\s+version|version\s+of\s+windows)$/, 'windows_version']];
  for (const [re, id] of INFO) if (re.test(q)) return { do: id };
  return null;
}

/** One line per control for the router/AI prompt. */
export const controlsHelp = () => Object.entries(CONTROLS).map(([k, v]) => `${k}: ${v.help}`).join('; ');

/** The question to ask first, or '' if none. */
export function confirmText(p) {
  const c = CONTROLS[p.do];
  if (!c?.ask) return p.do === 'close_app' && p.value === 1 ? `Force-close ${p.name}? Unsaved work in it will be lost.` : '';
  return c.ask.replace('{v}', p.value ?? '');
}

const fmtGB = (b) => `${(b / 1073741824).toFixed(b < 10737418240 ? 1 : 0)} GB`;
const fmtUp = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return [d && `${d} day${d > 1 ? 's' : ''}`, h && `${h} hour${h > 1 ? 's' : ''}`, `${m} minute${m === 1 ? '' : 's'}`].filter(Boolean).slice(0, 2).join(' and '); };

/**
 * deps: { helper (createHelper()), openExternal(url), launch(exe, args), os, statfs(drive) -> {bavail,bsize,blocks}|null, pictures }
 * Returns run({do, value, name}, confirmed) -> { status: 'done'|'confirm'|'fall', message?, preview?, reason? }
 */
export function makeSystem(d) {
  const ps = async (script) => { const r = await d.helper.run(script, 20000); if (r.code !== 0) throw new Error(String(r.out || 'failed').trim().split('\n')[0]); return String(r.out || '').trim(); };
  const vol = async (o) => { const r = await d.helper.volume(o); return r.muted ? `Sound is muted (volume ${r.level}%)` : `Volume set to ${r.level}%`; };
  const brightness = async (expr) => {
    const out = await ps(`$m = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1; $v = [int]$m.CurrentBrightness; $n = [Math]::Max(0, [Math]::Min(100, ${expr})); (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Select-Object -First 1 | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{Timeout=1; Brightness=[byte]$n}) | Out-Null; $n`);
    return `Brightness set to ${out}%`;
  };
  const radio = async (kind, on) => {
    await ps(`Add-Type -AssemblyName System.Runtime.WindowsRuntime; $g = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]; function Await($t, $T) { $x = $g.MakeGenericMethod($T).Invoke($null, @($t)); $x.Wait(-1) | Out-Null; $x.Result }; [Windows.Devices.Radios.Radio,Windows.System.Devices,ContentType=WindowsRuntime] | Out-Null; Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null; $r = (Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])) | ? { $_.Kind -eq '${kind}' } | Select-Object -First 1; if (-not $r) { throw 'none' }; Await ($r.SetStateAsync('${on ? 'On' : 'Off'}')) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null`)
      .catch((e) => { throw new Error(e.message === 'none' ? `this PC has no ${kind === 'WiFi' ? 'Wi-Fi' : 'Bluetooth'}` : e.message); });
    return `${kind === 'WiFi' ? 'Wi-Fi' : 'Bluetooth'} turned ${on ? 'on' : 'off'}`;
  };
  const theme = async (light) => { await ps(`$k = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'; Set-ItemProperty $k AppsUseLightTheme ${light ? 1 : 0}; Set-ItemProperty $k SystemUsesLightTheme ${light ? 1 : 0}`); return `Windows switched to ${light ? 'light' : 'dark'} mode`; };
  const media = async (vk, msg) => { await ps(`Add-Type -Namespace G -Name K -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, uint f, System.UIntPtr e);' -ErrorAction SilentlyContinue; [G.K]::keybd_event(${vk},0,0,[UIntPtr]::Zero); [G.K]::keybd_event(${vk},0,2,[UIntPtr]::Zero)`); return msg; };
  const open = async (url, msg) => { await d.openExternal(url); return msg; };
  const page = (name) => open(`ms-settings:${PAGES[name] ?? ''}`, `${name === 'settings' ? 'Settings' : name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) + ' settings'} opened`);
  // Apps the user sees (have a window), never Windows itself, File Explorer or Genisys.
  const KEEP = "'explorer','genisys','electron','ShellExperienceHost','StartMenuExperienceHost','SearchHost','TextInputHost','SystemSettings','LockApp','dwm','csrss','winlogon'";

  const ACT = {
    volume: (p) => vol({ level: p.value }), volume_up: (p) => vol({ step: p.value || 10 }), volume_down: (p) => vol({ step: -(p.value || 10) }),
    mute: () => vol({ mute: 'on' }), unmute: () => vol({ mute: 'off' }),
    play_pause: () => media(0xB3, 'Play / pause pressed'), next_track: () => media(0xB0, 'Skipped to the next song'),
    previous_track: () => media(0xB1, 'Back to the previous song'), stop_media: () => media(0xB2, 'Music stopped'),
    brightness: (p) => brightness(String(p.value)), brightness_up: (p) => brightness(`$v + ${p.value || 10}`), brightness_down: (p) => brightness(`$v - ${p.value || 10}`),
    camera: () => open('microsoft.windows.camera:', 'Camera opened'), snip: () => open('ms-screenclip:', 'Snipping tool opened: drag over the part you want'),
    screenshot: async () => {
      const file = await ps(`Add-Type -AssemblyName System.Windows.Forms, System.Drawing; $b = [System.Windows.Forms.SystemInformation]::VirtualScreen; $img = New-Object System.Drawing.Bitmap $b.Width, $b.Height; $g = [System.Drawing.Graphics]::FromImage($img); $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $img.Size); $dir = Join-Path ([Environment]::GetFolderPath('MyPictures')) 'Screenshots'; New-Item -ItemType Directory -Force $dir | Out-Null; $f = Join-Path $dir ('Screenshot ' + (Get-Date -Format 'yyyy-MM-dd HHmmss') + '.png'); $img.Save($f, [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $img.Dispose(); $f`);
      return { message: 'Screenshot saved to Pictures › Screenshots', path: file };
    },
    wifi_on: () => radio('WiFi', true), wifi_off: () => radio('WiFi', false), bluetooth_on: () => radio('Bluetooth', true), bluetooth_off: () => radio('Bluetooth', false),
    dark_mode: () => theme(false), light_mode: () => theme(true),
    close_app: async (p) => {
      const name = String(p.name || '').replace(/'/g, "''");
      const out = await ps(`$n = '${name}'; $ps = Get-Process | ? { $_.MainWindowHandle -ne 0 -and @(${KEEP}) -notcontains $_.ProcessName -and ($_.ProcessName -like "*$n*" -or $_.MainWindowTitle -like "*$n*" -or $_.Description -like "*$n*") }; if (-not $ps) { 'none' } else { foreach ($x in $ps) { ${p.value === 1 ? 'Stop-Process -Id $x.Id -Force' : '[void]$x.CloseMainWindow()'} }; @($ps).Count }`);
      if (out === 'none') throw new Error(`no open app called "${p.name}"`);
      return `${p.value === 1 ? 'Force-closed' : 'Closed'} ${p.name}`;
    },
    close_all: async () => {
      const out = await ps(`$ps = Get-Process | ? { $_.MainWindowHandle -ne 0 -and @(${KEEP}) -notcontains $_.ProcessName -and $_.Id -ne $PID }; foreach ($x in $ps) { [void]$x.CloseMainWindow() }; @($ps).Count`);
      return Number(out) ? `Closed ${out} app${Number(out) === 1 ? '' : 's'} (apps with unsaved work may ask you first)` : 'No open apps to close';
    },
    lock: async () => { d.launch('rundll32.exe', ['user32.dll,LockWorkStation']); return 'PC locked'; },
    sleep: async () => { await ps(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false) | Out-Null`); return 'Going to sleep'; },
    hibernate: async () => { await ps(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Hibernate', $false, $false) | Out-Null`); return 'Hibernating'; },
    restart: async () => { d.launch('shutdown.exe', ['/r', '/t', '5']); return 'Restarting in 5 seconds'; },
    shutdown: async () => { d.launch('shutdown.exe', ['/s', '/t', '5']); return 'Shutting down in 5 seconds'; },
    sign_out: async () => { d.launch('shutdown.exe', ['/l']); return 'Signing out'; },
    shutdown_in: async (p) => { d.launch('shutdown.exe', ['/s', '/t', String(p.value * 60)]); return `Your PC will shut down in ${p.value} minutes. Say "cancel shutdown" to stop it.`; },
    restart_in: async (p) => { d.launch('shutdown.exe', ['/r', '/t', String(p.value * 60)]); return `Your PC will restart in ${p.value} minutes. Say "cancel shutdown" to stop it.`; },
    cancel_shutdown: async () => { d.launch('shutdown.exe', ['/a']); return 'Scheduled shutdown cancelled'; },
    show_desktop: async () => { await ps('(New-Object -ComObject Shell.Application).MinimizeAll()'); return 'All windows minimized'; },
    task_manager: async () => { d.launch('taskmgr.exe', []); return 'Task Manager opened'; },
    control_panel: async () => { d.launch('control.exe', []); return 'Control Panel opened'; },
    device_manager: async () => { d.launch('mmc.exe', ['devmgmt.msc']); return 'Device Manager opened'; },
    file_explorer: async () => { d.launch('explorer.exe', []); return 'File Explorer opened'; },
    open_settings: (p) => page(PAGES[p.name] !== undefined ? p.name : 'settings'),
    battery: async () => {
      const out = await ps(`$b = Get-CimInstance Win32_Battery | Select-Object -First 1; if (-not $b) { 'none' } else { "$($b.EstimatedChargeRemaining)|$($b.BatteryStatus)" }`);
      if (out === 'none') return 'This PC has no battery (it runs on mains power)';
      const [pct, st] = out.split('|');
      return `Battery is at ${pct}%${st === '2' || st === '6' || st === '7' || st === '8' || st === '9' ? ' and charging' : ''}`;
    },
    disk_space: async () => {
      const parts = [];
      for (const L of 'CDEFGHIJ') { const s = d.statfs(`${L}:\\`); if (s && s.blocks) parts.push(`${L}: ${fmtGB(s.bavail * s.bsize)} free of ${fmtGB(s.blocks * s.bsize)}`); }
      return parts.length ? `Free space — ${parts.join(', ')}` : 'Could not read the disks';
    },
    memory: async () => { const t = d.os.totalmem(), f = d.os.freemem(); return `RAM: ${fmtGB(t - f)} used of ${fmtGB(t)} (${Math.round(((t - f) / t) * 100)}%)`; },
    cpu: async () => `CPU is at ${await ps('[int](Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average')}% right now`,
    windows_version: async () => `${d.os.version()} (build ${d.os.release()})`,
    uptime: async () => `Your PC has been on for ${fmtUp(d.os.uptime())}`,
    ip_address: async () => {
      const ips = Object.values(d.os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
      return ips.length ? `Your IP address: ${ips.join(', ')}` : 'You are not connected to a network';
    },
    wifi_name: async () => {
      const out = await ps(`(netsh wlan show interfaces) -match '^\\s+SSID\\s+:' | Select-Object -First 1`);
      const m = /:\s*(.+)$/.exec(out);
      return m ? `You are connected to "${m[1].trim()}"` : 'You are not connected to Wi-Fi';
    },
    empty_recycle_bin: async () => { await ps('Clear-RecycleBin -Force -ErrorAction SilentlyContinue'); return 'Recycle Bin emptied'; },
  };

  return async function run(p, confirmed) {
    const fn = ACT[p.do];
    if (!fn) return { status: 'fall', reason: `unknown control ${p.do}` };
    if (['volume', 'brightness', 'shutdown_in', 'restart_in'].includes(p.do) && !Number.isInteger(p.value)) return { status: 'fall', reason: 'needs a number' };
    if (p.do === 'close_app' && !p.name) return { status: 'fall', reason: 'which app?' };
    const q = confirmText(p);
    if (q && !confirmed) return { status: 'confirm', preview: q };
    try {
      const r = await fn(p);
      return typeof r === 'string' ? { status: 'done', message: r } : { status: 'done', ...r };
    } catch (e) {
      return { status: 'fall', reason: String(e.message || e).slice(0, 200) };
    }
  };
}
