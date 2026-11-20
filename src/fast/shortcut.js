// What to start for a Start-menu shortcut. link = { target, args } as Electron's shell.readShortcutLink returns it.
// A shortcut WITH arguments must be started as the shortcut itself. "Spotify" installed as a Chrome app is
// chrome_proxy.exe --profile-directory=Default --app-id=...: start only its target and you get plain Chrome.
export function shortcutLaunch(lnkPath, link, exists = () => true) {
  if (!link) return null;
  if (String(link.args || '').trim()) return lnkPath;
  const t = String(link.target || '');
  return /\.exe$/i.test(t) && exists(t) ? t : null;
}
export const isShortcut = (p) => /\.lnk$/i.test(String(p || ''));
