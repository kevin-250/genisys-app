// PC info as tables: running apps, installed apps, drives, startup apps, Wi-Fi networks.
// Main runs the read-only query in Q and hands the raw result to the matching builder; parseSysQuery maps plain words
// to the tool with no AI call. No imports: the page uses parseSysQuery.
const pad = (x) => String(x).padStart(2, '0');
const size = (b) => {
  if (b == null || Number.isNaN(+b)) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = +b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${i && v < 10 ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
};
const list = (x) => (x == null ? [] : [].concat(x)).filter(Boolean);
const has = (q, s) => !q || String(s || '').toLowerCase().includes(String(q).toLowerCase());
const rowsData = (rows) => rows.slice(0, 50).map((r) => r.join(' | ')).join('\n') + (rows.length > 50 ? `\n…and ${rows.length - 50} more` : '');
const done = (title, columns, rows, extra = {}) => ({ message: rows.length ? title : `Nothing found: ${title}`, table: rows.length ? { title, columns, rows, more: 0, ...extra.table } : null, stats: extra.stats, data: rowsData(rows) });

// The read-only queries main runs (PowerShell -> JSON, except Wi-Fi which is netsh text).
export const Q = {
  running_apps: "Get-Process | Select-Object Name,Id,@{n='WS';e={$_.WorkingSet64}},@{n='CPU';e={[math]::Round($_.CPU,1)}},MainWindowTitle | ConvertTo-Json -Compress",
  installed_apps: "Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and -not $_.SystemComponent -and -not $_.ParentKeyName } | Select-Object DisplayName,DisplayVersion,Publisher,InstallDate,EstimatedSize | ConvertTo-Json -Compress",
  drives: 'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,Size,FreeSpace,DriveType | ConvertTo-Json -Compress',
  startup_apps: 'Get-CimInstance Win32_StartupCommand | Select-Object Name,Command,Location | ConvertTo-Json -Compress',
  wifi_networks: 'netsh wlan show networks mode=bssid',
};

// running_apps: one row per app (all its processes added up), heaviest first. p: { sort: memory|cpu|name, name, limit }
export function runningTable(procs, p = {}, totalRam = 0) {
  const by = new Map();
  for (const x of list(procs)) {
    if (!x.Name || !has(p.name, x.Name)) continue;
    const g = by.get(x.Name) || { name: x.Name, n: 0, ws: 0, cpu: 0, window: '' };
    g.n++; g.ws += +x.WS || 0; g.cpu += +x.CPU || 0; g.window ||= x.MainWindowTitle || '';
    by.set(x.Name, g);
  }
  const sort = p.sort === 'cpu' ? (a, b) => b.cpu - a.cpu : p.sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => b.ws - a.ws;
  const all = [...by.values()].sort(sort);
  const shown = all.slice(0, p.limit || 60);
  const used = all.reduce((s, g) => s + g.ws, 0);
  const rows = shown.map((g) => [g.name, size(g.ws), `${Math.round(g.cpu)} s`, String(g.n), g.window.slice(0, 60)]);
  const stats = [{ label: 'Apps running', value: String(all.length) }, { label: 'Memory used by apps', value: size(used), note: totalRam ? `of ${size(totalRam)}` : '' }];
  return done(`${shown.length < all.length ? `Top ${shown.length} of ` : ''}${all.length} running apps · by ${p.sort === 'cpu' ? 'CPU time' : p.sort === 'name' ? 'name' : 'memory'}`, ['App', 'Memory', 'CPU time', 'Processes', 'Window'], rows, { stats });
}

// installed_apps: registry "Programs and Features". p: { sort: name|size|date, name, limit }
const instDate = (s) => (/^\d{8}$/.test(String(s)) ? `${String(s).slice(0, 4)}-${String(s).slice(4, 6)}-${String(s).slice(6)}` : '');
export function installedTable(apps, p = {}) {
  const seen = new Map();
  for (const a of list(apps)) if (a.DisplayName && has(p.name, `${a.DisplayName} ${a.Publisher || ''}`) && !seen.has(a.DisplayName.toLowerCase())) seen.set(a.DisplayName.toLowerCase(), a);
  const all = [...seen.values()];
  const sort = { size: (a, b) => (+b.EstimatedSize || 0) - (+a.EstimatedSize || 0), date: (a, b) => String(b.InstallDate || '').localeCompare(String(a.InstallDate || '')) }[p.sort] || ((a, b) => a.DisplayName.localeCompare(b.DisplayName));
  all.sort(sort);
  const shown = all.slice(0, p.limit || 500);
  const rows = shown.map((a) => [a.DisplayName, String(a.DisplayVersion || ''), String(a.Publisher || ''), instDate(a.InstallDate), a.EstimatedSize ? size(a.EstimatedSize * 1024) : '']);
  const say = { size: 'size, biggest first', date: 'install date, newest first' }[p.sort] || 'name';
  return done(`${shown.length < all.length ? `${shown.length} of ` : ''}${all.length} installed apps${p.name ? ` matching "${p.name}"` : ''} · by ${say}`, ['App', 'Version', 'Publisher', 'Installed', 'Size'], rows);
}

// drives: every drive with used/free space
const DTYPE = { 2: 'USB', 3: 'Local', 4: 'Network', 5: 'CD/DVD' };
export function drivesTable(disks) {
  const all = list(disks).filter((d) => d.DeviceID);
  const rows = all.map((d) => {
    const total = +d.Size || 0, free = +d.FreeSpace || 0;
    return [`${d.DeviceID}\\`, d.VolumeName || '', DTYPE[d.DriveType] || '', size(total - free), size(free), size(total), total ? `${Math.round(((total - free) / total) * 100)}%` : ''];
  });
  const free = all.reduce((s, d) => s + (+d.FreeSpace || 0), 0), total = all.reduce((s, d) => s + (+d.Size || 0), 0);
  return done(`${all.length} drive${all.length === 1 ? '' : 's'} · ${size(free)} free of ${size(total)}`, ['Drive', 'Label', 'Type', 'Used', 'Free', 'Total', 'Full'], rows,
    { stats: [{ label: 'Free space', value: size(free) }, { label: 'Total space', value: size(total) }, { label: 'Drives', value: String(all.length) }], table: { paths: all.map((d) => `${d.DeviceID}\\`) } });
}

export function startupTable(items, p = {}) {
  const all = list(items).filter((x) => x.Name && has(p.name, x.Name));
  const rows = all.map((x) => [x.Name, String(x.Command || ''), String(x.Location || '').replace(/^HKU\\S-1-5-[\d-]+\\/, 'HKCU\\')]);
  return done(`${all.length} apps start with Windows`, ['App', 'Command', 'Where it is set'], rows);
}

// netsh text -> one row per network (strongest signal of its access points)
export function wifiTable(text) {
  const nets = [];
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const ssid = line.match(/^SSID \d+ : (.*)$/);
    if (ssid) { cur = { ssid: ssid[1].trim() || '(hidden)', auth: '', signal: 0, band: '' }; nets.push(cur); continue; }
    if (!cur) continue;
    const kv = line.match(/^\s+([^:]+?)\s+:\s+(.*)$/);
    if (!kv) continue;
    const [, k, v] = kv;
    if (/^Authentication/.test(k)) cur.auth = v.trim();
    if (/^Signal/.test(k)) cur.signal = Math.max(cur.signal, parseInt(v, 10) || 0);
    if (/^Band/.test(k) && !cur.band.includes(v.trim())) cur.band = cur.band ? `${cur.band}, ${v.trim()}` : v.trim();
  }
  nets.sort((a, b) => b.signal - a.signal);
  const rows = nets.map((n) => [n.ssid, `${n.signal}%`, n.band, n.auth]);
  return done(nets.length ? `${nets.length} Wi-Fi network${nets.length === 1 ? '' : 's'} nearby · strongest first` : 'no Wi-Fi networks (Wi-Fi off or no adapter?)', ['Network', 'Signal', 'Band', 'Security'], rows);
}

// ---- plain words -> tool
const APPS = '(?:apps?|applications?|programs?|software|processes|tasks)';
export function parseSysQuery(text) {
  const t = String(text || '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
  if (!t || /^(open|launch|start|close|kill|stop|end|uninstall|install|remove|delete|disable|enable)\b/.test(t)) return null;
  const top = t.match(/\btop (\d{1,3})\b/);
  const limit = top ? { limit: +top[1] } : {};
  if (new RegExp(`\\b(running|open) ${APPS}\\b|\\b${APPS} (?:that )?(?:are )?(?:running|open)\\b|\\bprocesses\\b|\\b(?:using|uses?|eating|hogging) (?:the )?(?:most |all )?(?:my )?(ram|memory|cpu)\\b|\\bwhat'?s (?:using|eating|slowing)\\b|\\bhow much (?:ram|memory) (?:am i|is) (?:using|used)\\b|\\b(?:ram|memory|cpu) (?:usage )?by app\\b`).test(t))
    return { action: 'running_apps', params: { ...(/\bcpu\b/.test(t) ? { sort: 'cpu' } : {}), ...limit } };
  if (new RegExp(`\\binstalled ${APPS}\\b|\\b${APPS} (?:do i have |i have |that are |are )?installed\\b|\\bwhat ${APPS} do i have\\b|\\b(?:list|show)(?: me)?(?: all)?(?: my)? ${APPS}$`).test(t)) {
    const sort = /\b(biggest|largest|space|size)\b/.test(t) ? 'size' : /\b(recent(?:ly)?|newest|latest|last)\b/.test(t) ? 'date' : undefined;
    return { action: 'installed_apps', params: { ...(sort && { sort }), ...limit } };
  }
  if (/\b(drives?|disks?|partitions?|hard ?drives?|ssd)\b/.test(t) && /\b(space|free|left|full|list|show|all|my|how much|size)\b/.test(t) && !/\bfiles?\b/.test(t)) return { action: 'drives', params: {} };
  if (new RegExp(`\\bstartup ${APPS}|\\b${APPS} (?:that )?(?:run|start|open|launch)s? (?:at|on|with) (?:startup|boot|windows)\\b|\\bstart ?up items\\b`).test(t)) return { action: 'startup_apps', params: {} };
  if (/\b(wi-?fi|wireless) networks?\b|\bnetworks? (?:near|around|available|nearby)\b|\bavailable (?:wi-?fi|networks)\b/.test(t) && !/\b(turn|connect|disconnect)\b/.test(t)) return { action: 'wifi_networks', params: {} };
  return null;
}
