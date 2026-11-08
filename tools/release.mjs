// `npm run release -- <patch|minor|major|x.y.z> ["release notes"]`: builds the installer and publishes it as a
// GitHub Release on kevin-250/genisys-app, all from this laptop (needs the GitHub CLI, logged in with `gh auth login`).
// `npm run release -- patch --dry` builds the installer but commits, tags and uploads nothing.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = 'kevin-250/genisys-app';
const ASSET = 'Genisys-Setup.exe'; // fixed name, so .../releases/latest/download/Genisys-Setup.exe always gives the newest
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const iss = path.join(root, 'installer', 'genisys.iss');
const exe = path.join(root, 'installer', 'dist', ASSET);

export function nextVersion(cur, b) {
  if (/^\d+\.\d+\.\d+$/.test(b)) return b;
  const [M, m, p] = cur.split('.').map(Number);
  if (b === 'major') return `${M + 1}.0.0`;
  if (b === 'minor') return `${M}.${m + 1}.0`;
  if (b === 'patch') return `${M}.${m}.${p + 1}`;
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();

function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const [bump, notes] = args.filter((a) => a !== '--dry');
  const fail = (msg) => { console.error(`\n✗ ${msg}`); process.exit(1); };
  const run = (cmd, a, opts = {}) => execFileSync(cmd, a, { cwd: root, stdio: 'inherit', ...opts });
  // Network steps retry: GitHub connections drop now and then (ECONNRESET, upload timeouts).
  const retry = (what, fn) => {
    for (let i = 1; ; i++) {
      try { return fn(); } catch (e) {
        if (i === 5) fail(`${what} failed 5 times. The installer is built; when your internet is back, finish with:\n  git push && git push origin ${tag}\n  gh release upload ${tag} installer\\dist\\${ASSET} --repo ${REPO} --clobber   (or gh release create if it does not exist yet)`);
        console.log(`  ${what} failed (attempt ${i}/5), retrying in 10 s…`);
        execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},10000)']);
      }
    }
  };
  const out = (cmd, a) => execFileSync(cmd, a, { cwd: root, encoding: 'utf8' }).trim();

  // gh may not be on PATH in a shell opened before it was installed.
  const ghPath = ['gh', 'C:\\Program Files\\GitHub CLI\\gh.exe'].find((g) => { try { out(g, ['--version']); return true; } catch { return false; } });
  if (!ghPath) fail('GitHub CLI not found. Install it: winget install --id GitHub.cli');


  const pkgFile = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  const version = nextVersion(pkg.version, bump);
  if (!version) fail('Usage: npm run release -- <patch|minor|major|x.y.z> ["what changed"] [--dry]');
  const tag = `v${version}`;
  console.log(`Genisys ${pkg.version} → ${version}${dry ? '  (dry run: nothing is published)' : ''}`);

  // Safety checks before touching anything.
  if (!dry) {
    try { out(ghPath, ['auth', 'status']); } catch { fail('GitHub CLI is not logged in. Run: gh auth login'); }
    if (out('git', ['status', '--porcelain'])) fail('You have uncommitted changes. Commit or stash them first, so the release matches the code on GitHub.');
    if (out('git', ['tag', '--list', tag])) fail(`Tag ${tag} already exists. Pick a higher version.`);
  }

  // 1) Write the version into package.json, package-lock.json and the installer script.
  const setJson = (file, fn) => { const j = JSON.parse(fs.readFileSync(file, 'utf8')); fn(j); fs.writeFileSync(file, JSON.stringify(j, null, 2) + '\n'); };
  setJson(pkgFile, (j) => { j.version = version; });
  const lock = path.join(root, 'package-lock.json');
  if (fs.existsSync(lock)) setJson(lock, (j) => { j.version = version; if (j.packages?.['']) j.packages[''].version = version; });
  const issText = fs.readFileSync(iss, 'utf8');
  if (!/#define AppVersion "[^"]*"/.test(issText)) fail('Could not find #define AppVersion in installer/genisys.iss');
  fs.writeFileSync(iss, issText.replace(/#define AppVersion "[^"]*"/, `#define AppVersion "${version}"`));

  // 2) Build: package the app, then compile the Inno Setup installer.
  if (fs.existsSync(exe)) fs.rmSync(exe);
  try { run('cmd', ['/c', path.join('installer', 'build-installer.bat')]); } catch { fail('Build failed (see the output above). Nothing was published.'); }
  if (!fs.existsSync(exe)) fail(`Build finished but ${exe} is missing.`);
  console.log(`\n✓ Built ${path.relative(root, exe)} (${(fs.statSync(exe).size / 1048576).toFixed(1)} MB)`);
  if (dry) { console.log('Dry run done. Undo the version change with: git checkout package.json package-lock.json installer/genisys.iss'); process.exit(0); }

  // 3) Commit the version bump, tag it, push both.
  run('git', ['add', 'package.json', 'package-lock.json', 'installer/genisys.iss']);
  run('git', ['commit', '-m', `Release ${tag}`]);
  run('git', ['tag', tag]);
  retry('git push', () => run('git', ['push']));
  retry('Pushing the tag', () => run('git', ['push', 'origin', tag]));

  // 4) Publish the GitHub Release with the installer attached.
  // A failed upload can leave the release without its file, so later attempts re-upload into the existing release.
  retry('Publishing the release', () => {
    let exists = true;
    try { out(ghPath, ['release', 'view', tag, '--repo', REPO]); } catch { exists = false; }
    if (exists) run(ghPath, ['release', 'upload', tag, exe, '--repo', REPO, '--clobber']);
    else run(ghPath, ['release', 'create', tag, exe, '--repo', REPO, '--title', `Genisys ${tag}`, ...(notes ? ['--notes', notes] : ['--generate-notes'])]);
  });
  console.log(`\n✓ Released ${tag}: https://github.com/${REPO}/releases/tag/${tag}`);
  console.log(`  Always-latest download link: https://github.com/${REPO}/releases/latest/download/${ASSET}`);
}
