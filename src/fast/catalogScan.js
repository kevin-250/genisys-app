// Turning what Windows and the browsers give us into catalog items. Pure functions: main.js reads the disk/registry and calls these.

// A Start-menu shortcut. With arguments it is started AS the shortcut (see shortcut.js). Chrome/Edge apps carry --app-id=...
export function classifyShortcut(name, lnkPath, link, exists = () => true) {
  if (!link) return null;
  const args = String(link.args || '').trim();
  if (args) {
    const pwa = /--app-id=|--app=/.test(args);
    return { kind: pwa ? 'pwa' : 'app', name, launch: { type: 'lnk', target: lnkPath, args }, meta: { program: link.target || '' }, source: 'startmenu' };
  }
  const t = String(link.target || '');
  if (!/\.exe$/i.test(t) || !exists(t)) return null;
  return { kind: 'app', name, launch: { type: 'exe', target: t }, meta: {}, source: 'startmenu' };
}

// Microsoft Store / packaged apps from Get-StartApps: [{ name, id }].
export const storeItems = (apps) => (apps || []).filter((a) => a?.name && a?.id).map((a) => ({ kind: 'store', name: a.name, launch: { type: 'store', target: `shell:AppsFolder\\${a.id}` }, meta: {}, source: 'store' }));

// Installed programs from the registry "Uninstall" keys (JSON from PowerShell). Skips what the registry itself marks as
// not a program: system components, updates/hotfixes, child entries.
export function programItems(json) {
  let rows = [];
  try { rows = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(rows)) rows = rows ? [rows] : [];
  const out = [];
  for (const r of rows) {
    const name = String(r?.DisplayName || '').trim();
    if (!name || r.SystemComponent === 1 || r.ParentKeyName || r.ParentDisplayName || /^(KB\d+|hotfix)/i.test(name) || /\b(update|hotfix)\b.*\bKB\d+/i.test(name)) continue;
    const icon = String(r.DisplayIcon || '').split(',')[0].replace(/^\s*"|"\s*$/g, '');
    const exe = /\.exe$/i.test(icon) ? icon : '';
    out.push({ kind: 'program', name, launch: { type: exe ? 'exe' : 'none', target: exe || String(r.InstallLocation || '') }, meta: { publisher: r.Publisher || '', location: r.InstallLocation || '' }, source: 'registry' });
  }
  return out.filter((o) => o.launch.target);
}

// Chrome/Edge "Bookmarks" file -> sites, each remembered with the profile it lives in (so it opens signed in).
export function bookmarkItems(json, browser, profile) {
  let j; try { j = JSON.parse(json); } catch { return []; }
  const out = [];
  const walk = (n, trail) => {
    if (!n) return;
    if (n.type === 'url' && /^https?:\/\//i.test(n.url || '')) out.push({ kind: 'site', name: String(n.name || n.url), launch: { type: 'url', url: n.url, browser, profile }, meta: { folder: trail.join(' / ') }, source: `bookmarks:${browser}:${profile}` });
    for (const c of n.children || []) walk(c, n.name ? [...trail, n.name] : trail);
  };
  for (const root of Object.values(j?.roots || {})) walk(root, []);
  return out;
}

// Recent files/folders: items already resolved by main.js ({ name, target, isDir, mtime }).
export const recentItems = (items) => (items || []).filter((i) => i?.target && i?.name).map((i) => ({ kind: i.isDir ? 'folder' : 'file', name: i.name, launch: { type: 'path', target: i.target }, meta: { mtime: i.mtime || 0 }, source: 'recent' }));
