// Always-ready hidden PowerShell: started once, so system controls (volume) and short PowerShell commands answer in
// ~0.1 s instead of paying 1-3 s of PowerShell startup every time. One request per line in, one tagged line out.
import { spawn as nodeSpawn } from 'node:child_process';

// Windows Core Audio (exact master volume + mute), compiled once when the helper starts.
const AUDIO_CS = `using System; using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume { int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float level, Guid ctx); int j(); int GetMasterVolumeLevelScalar(out float level);
  int k(); int l(); int m(); int n(); int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid ctx); int GetMute(out bool mute); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int ctx, int p, out IAudioEndpointVolume v); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice dev); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
public static class GenisysAudio {
  static IAudioEndpointVolume V() { var e = (IMMDeviceEnumerator)new MMDeviceEnumerator(); IMMDevice d;
    Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out d)); var id = typeof(IAudioEndpointVolume).GUID; IAudioEndpointVolume v;
    Marshal.ThrowExceptionForHR(d.Activate(ref id, 23, 0, out v)); return v; }
  public static int Get() { float l; Marshal.ThrowExceptionForHR(V().GetMasterVolumeLevelScalar(out l)); return (int)Math.Round(l * 100); }
  public static int Set(int p) { p = Math.Max(0, Math.Min(100, p)); Marshal.ThrowExceptionForHR(V().SetMasterVolumeLevelScalar(p / 100f, Guid.Empty)); return Get(); }
  public static bool Muted() { bool m; Marshal.ThrowExceptionForHR(V().GetMute(out m)); return m; }
  public static bool Mute(bool on) { Marshal.ThrowExceptionForHR(V().SetMute(on, Guid.Empty)); return Muted(); }
}`;

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const ps = (s) => `([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(s)}')))`;

/** One request -> one line of PowerShell that prints "@@<id> <json>" (or "@@<id> !<error>"). Exported for tests. */
export function requestLine(id, kind, arg) {
  if (kind === 'audio') return `try { $r = ${arg} | ConvertTo-Json -Compress; [Console]::Out.WriteLine("@@${id} $r") } catch { [Console]::Out.WriteLine("@@${id} !" + ($_.Exception.Message -replace '\\s+',' ')) }`;
  // A PowerShell command from the AI: run in its own scope so variables and the current folder don't leak between commands.
  return `$global:LASTEXITCODE = 0; $o = try { & ([ScriptBlock]::Create(${ps(arg)})) 2>&1 | Out-String -Width 200; $c = $(if ($?) { $global:LASTEXITCODE } else { 1 }) } catch { $_ | Out-String; $c = 1 }; Set-Location $HOME; [Console]::Out.WriteLine("@@${id} " + (@{ code = [int]$c; out = [string]$o } | ConvertTo-Json -Compress))`;
}

/** Parse one helper output line. Exported for tests. */
export function parseLine(line) {
  const m = /^@@(\d+) (.*)$/.exec(line.trim());
  if (!m) return null;
  if (m[2].startsWith('!')) return { id: Number(m[1]), error: m[2].slice(1).trim() || 'failed' };
  try { return { id: Number(m[1]), value: JSON.parse(m[2]) }; } catch { return { id: Number(m[1]), error: 'bad reply' }; }
}

export function createHelper({ spawn = nodeSpawn, log = () => {} } = {}) {
  let proc = null, buf = '', seq = 0;
  const pending = new Map();

  function start() {
    proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', '-'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    buf = '';
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const r = parseLine(buf.slice(0, i)); buf = buf.slice(i + 1);
        const p = r && pending.get(r.id);
        if (p) { pending.delete(r.id); clearTimeout(p.timer); r.error ? p.reject(new Error(r.error)) : p.resolve(r.value); }
      }
    });
    proc.stderr.on('data', () => {});
    const gone = () => { proc = null; for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('helper stopped')); } pending.clear(); };
    proc.on('exit', gone); proc.on('error', (e) => { log('helper error', e.message); gone(); });
    // Load audio + screen-capture libraries once here, so the first volume change or screenshot isn't slow.
    proc.stdin.write(`$ProgressPreference = 'SilentlyContinue'; Add-Type -TypeDefinition ${ps(AUDIO_CS)}; Add-Type -AssemblyName System.Windows.Forms, System.Drawing\n`);
  }

  function send(kind, arg, ms) {
    if (!proc) start();
    const id = ++seq;
    return new Promise((resolve, reject) => {
      // A stuck request restarts the helper, so one bad command can't block the next ones.
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('too slow')); stop(); }, ms);
      pending.set(id, { resolve, reject, timer });
      proc.stdin.write(requestLine(id, kind, arg) + '\n');
    });
  }

  function stop() { try { proc?.kill(); } catch {} proc = null; }

  return {
    warm: () => { if (!proc) start(); },
    stop,
    // Volume: exact level 0-100 (or a change by `step`), mute on/off. Resolves with the real state read back.
    volume: async ({ level, step, mute } = {}) => {
      if (mute === 'on' || mute === 'off') await send('audio', `[GenisysAudio]::Mute($${mute === 'on'})`, 4000);
      let v;
      if (Number.isInteger(level)) v = await send('audio', `[GenisysAudio]::Set(${level})`, 4000);
      else if (Number.isInteger(step)) v = await send('audio', `[GenisysAudio]::Set([GenisysAudio]::Get() + (${step}))`, 4000);
      else v = await send('audio', '[GenisysAudio]::Get()', 4000);
      const muted = await send('audio', '[GenisysAudio]::Muted()', 4000);
      return { level: v, muted };
    },
    // A plain PowerShell command (from the AI): same {code, out} shape as running a .bat.
    run: (script, ms = 60000) => send('ps', script, ms),
  };
}
