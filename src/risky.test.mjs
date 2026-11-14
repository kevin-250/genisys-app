import assert from 'node:assert';
import { isRisky } from './risky.js';

for (const c of ['del C:\\x.txt', 'RMDIR /s /q foo', 'reg delete HKCU\\x', 'powershell Remove-Item x', 'format D:', 'shutdown /s', 'powershell -enc AAAA'])
  assert.ok(isRisky(c), c);
for (const c of ['start "" explorer "C:\\Users"', 'dir /s /b /ad "%USERPROFILE%\\*excute*"', 'npm start', 'code .', 'echo modeled',
  `powershell -NoProfile -Command "Get-ChildItem -Recurse | Sort-Object LastWriteTime -Descending | Format-Table -AutoSize | Format-List"`])
  assert.ok(!isRisky(c), c);
console.log('risky: ok');
