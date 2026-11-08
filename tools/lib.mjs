// Shared by tools/setup.mjs and tools/build.mjs: a log that is also printed, a command runner that logs what it ran, and finding the MSFS SDK.
// The logs (setup.log, build.log) are written into the repo folder, which is synced between machines, so a run on one machine can be read from another.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, hostname, release, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const win = process.platform === 'win32';
export const mac = process.platform === 'darwin';
export const firstLine = (s) => (s || '').split('\n')[0];

// Who and what ran this, for the top of a log.
export function machineLine() {
  let user = '?';
  try {
    user = userInfo().username;
  } catch {
    /* no user info */
  }
  return hostname() + ' (' + user + ') ' + process.platform + ' ' + arch() + ' ' + release() + ', node ' + process.version;
}

// A log file in the repo root. append: keep earlier runs (trimmed to the last keepLines lines), else start fresh.
export function createLog(name, { append = false, keepLines = 4000 } = {}) {
  const file = join(root, name);
  if (!append || !existsSync(file)) writeFileSync(file, '');
  else {
    const lines = readFileSync(file, 'utf8').split('\n');
    if (lines.length > keepLines) writeFileSync(file, lines.slice(-keepLines).join('\n'));
  }
  const stamp = (m) => appendFileSync(file, new Date().toISOString().slice(11, 19) + ' ' + m + '\n');
  // say: shown and logged. note: logged only (the detail).
  const say = (m = '') => {
    console.log(m);
    stamp(m);
  };
  const note = (m) => stamp('  ' + m);
  // Run a command and log it, its exit code and the first `lines` lines of its output. Returns { ok, out, status }.
  function run(cmd, cmdArgs = [], opts = {}) {
    const { lines = 6, ...rest } = opts;
    // npm and npx are .cmd files on Windows and need a shell; a command given as a full path (an .exe, maybe with spaces) must not use one
    const shell = rest.shell !== undefined ? rest.shell : win && !/[\\/]/.test(cmd);
    const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', timeout: 1800000, cwd: root, maxBuffer: 64 * 1024 * 1024, ...rest, shell });
    const out = ((r.stdout || '') + (r.stderr || '')).trim();
    note('$ ' + [cmd, ...cmdArgs].join(' ') + '  -> ' + (r.error ? 'could not run: ' + r.error.message : 'exit ' + r.status));
    if (out) note(out.split('\n').slice(-lines).join('\n  '));
    return { ok: !r.error && r.status === 0, out, status: r.status };
  }
  return { file, stamp, say, note, run };
}

// The MSFS SDK folder: --sdk, then the MSFS2024_SDK environment variable (set by the SDK installer), then two common folders.
export function findSdk(note, sdkArg = '') {
  const tries = [
    [sdkArg, '--sdk'],
    [process.env.MSFS2024_SDK, 'MSFS2024_SDK environment variable'],
    ['G:\\MSFS 2024 SDK', 'a common folder'],
    ['C:\\MSFS 2024 SDK', 'a common folder']
  ];
  for (const [dir, how] of tries) {
    if (!dir) continue;
    const ok = existsSync(join(dir, 'WASM'));
    note('SDK candidate ' + dir + ' (' + how + '): ' + (ok ? 'found' : 'not there'));
    if (ok) return { dir, how };
  }
  return null;
}
export const sdkHas = (sdk, ...p) => !!sdk && existsSync(join(sdk.dir, ...p));
// The pieces of the SDK the WASM build uses: [name, present].
export const sdkWasmParts = (sdk) => [
  ['clang-cl.exe', sdkHas(sdk, 'WASM', 'llvm', 'bin', 'clang-cl.exe')],
  ['wasm-ld.exe', sdkHas(sdk, 'WASM', 'llvm', 'bin', 'wasm-ld.exe')],
  ['wasi-sysroot', sdkHas(sdk, 'WASM', 'wasi-sysroot')],
  ['MSFS_WasmVersions.a', sdkHas(sdk, 'WASM', 'WasmVersions', 'MSFS_WasmVersions.a')]
];
export const packageToolPath = (sdk) => (sdk ? join(sdk.dir, 'Tools', 'bin', 'fspackagetool.exe') : '');
// Git Bash, if bash itself is not on the PATH (Windows).
export function findBash() {
  const r = spawnSync('bash', ['--version'], { encoding: 'utf8', shell: win });
  if (!r.error && r.status === 0) return { cmd: 'bash', detail: firstLine(r.stdout) };
  const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
  if (win && existsSync(gitBash)) return { cmd: gitBash, detail: gitBash + ' (not on the PATH)' };
  return null;
}
