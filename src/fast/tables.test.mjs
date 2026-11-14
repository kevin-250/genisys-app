import assert from 'node:assert';
import { parseSysQuery, runningTable, installedTable, drivesTable, startupTable, wifiTable } from './tables.js';
import { parseIntent } from './intent.js';

const is = (t, action, params = {}) => assert.deepStrictEqual(parseSysQuery(t), { action, params }, t);
is('what apps are running', 'running_apps');
is('which apps use the most memory', 'running_apps');
is('show running processes', 'running_apps');
is('how much ram am i using', 'running_apps');
is("what's using my cpu", 'running_apps', { sort: 'cpu' });
is('top 5 apps using ram', 'running_apps', { limit: 5 });
is('list installed apps', 'installed_apps');
is('what programs do i have installed', 'installed_apps');
is('biggest installed programs', 'installed_apps', { sort: 'size' });
is('recently installed software', 'installed_apps', { sort: 'date' });
is('how much space is left on my drives', 'drives');
is('show my disks', 'drives');
is('list startup apps', 'startup_apps');
is('which programs run at startup', 'startup_apps');
is('show wifi networks near me', 'wifi_networks');
for (const t of ['open task manager', 'close chrome', 'uninstall zoom', 'turn wifi off', 'connect to wifi network home', 'show biggest files in my d drive', 'open spotify'])
  assert.strictEqual(parseSysQuery(t), null, t);
// the old wrong routes are gone: these used to "open an app" called "running processes" / "wifi networks"
assert.strictEqual(parseIntent('show running processes').action, 'running_apps');
assert.strictEqual(parseIntent('show my wifi networks').action, 'wifi_networks');
assert.strictEqual(parseIntent('what programs do i have installed').action, 'installed_apps');

const run = runningTable([{ Name: 'chrome', WS: 300e6, CPU: 10 }, { Name: 'chrome', WS: 200e6, CPU: 5 }, { Name: 'code', WS: 700e6, CPU: 50, MainWindowTitle: 'app.js' }, { Name: 'idle', WS: 1e6 }], {}, 16 * 1024 ** 3);
assert.deepStrictEqual(run.table.rows.map((r) => [r[0], r[3]]), [['code', '1'], ['chrome', '2'], ['idle', '1']]);
assert.strictEqual(run.stats[0].value, '3');
assert.strictEqual(runningTable([{ Name: 'a', WS: 1, CPU: 9 }, { Name: 'b', WS: 9, CPU: 1 }], { sort: 'cpu' }).table.rows[0][0], 'a');

const inst = installedTable([{ DisplayName: 'Zoom', EstimatedSize: 300000, InstallDate: '20261101' }, { DisplayName: 'VLC', DisplayVersion: '3.0', EstimatedSize: 100 }, { DisplayName: 'zoom' }], { sort: 'size' });
assert.deepStrictEqual(inst.table.rows.map((r) => [r[0], r[3], r[4]]), [['Zoom', '2026-11-01', '293 MB'], ['VLC', '', '100 KB']]); // duplicates merged
assert.strictEqual(installedTable({ DisplayName: 'Solo' }).table.rows.length, 1); // PowerShell sends one object, not an array

const dr = drivesTable([{ DeviceID: 'C:', Size: 100 * 1024 ** 3, FreeSpace: 25 * 1024 ** 3, DriveType: 3 }]);
assert.deepStrictEqual(dr.table.rows[0], ['C:\\', '', 'Local', '75 GB', '25 GB', '100 GB', '75%']);

const wifi = wifiTable(`
SSID 1 : Home
    Network type            : Infrastructure
    Authentication          : WPA2-Personal
    BSSID 1                 : aa:bb
         Signal             : 40%
         Band               : 2.4 GHz
    BSSID 2                 : aa:cc
         Signal             : 88%
         Band               : 5 GHz
SSID 2 : Cafe
    Authentication          : Open
         Signal             : 91%
`);
assert.deepStrictEqual(wifi.table.rows, [['Cafe', '91%', '', 'Open'], ['Home', '88%', '2.4 GHz, 5 GHz', 'WPA2-Personal']]);
assert.strictEqual(wifiTable('').table, null);
assert.strictEqual(startupTable([{ Name: 'a', Location: String.raw`HKU\S-1-5-21-17-1001\SOFTWARE\Run` }]).table.rows[0][2], String.raw`HKCU\SOFTWARE\Run`);
assert.match(dr.message, /^1 drive ·/);
console.log('tables: ok');
