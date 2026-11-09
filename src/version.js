// Pure helpers for automatic updates (tested in version.test.mjs).

/** Is version a (e.g. "v1.2.0" or "1.2.0") newer than b? */
export function newer(a, b) {
  const x = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const y = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

/** The installer asset of a GitHub release, only if it carries a SHA-256 to check the download against. */
export function pickAsset(release, name = 'Genisys-Setup.exe') {
  const a = (release?.assets || []).find((x) => x.name === name);
  const m = /^sha256:([0-9a-f]{64})$/i.exec(a?.digest || '');
  if (!a || !m || !/^https:\/\/github\.com\//.test(a.browser_download_url || '')) return null;
  return { url: a.browser_download_url, size: a.size, sha256: m[1].toLowerCase(), version: String(release.tag_name || '').replace(/^v/, '') };
}
