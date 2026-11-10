// Build everything this machine can: the app, the lint and the tests always; the WASM modules and the package when the MSFS SDK is found.
// What cannot be built here is a warning, not a failure. Every run is appended to build.log (ignored by git, but synced with the folder), with the machine,
// the commit, each command and its exit code, so a run on the Windows machine can be read from another one.
//   node tools/build.mjs                 build what can be built
//   node tools/build.mjs --no-tests      skip the lint and the tests (faster)
//   node tools/build.mjs --sdk "G:\MSFS 2024 SDK"   look for the SDK in this folder
// Exit code 1 if a step that ran failed.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createLog, findBash, findSdk, machineLine, packageToolPath, root, sdkHas, sdkWasmParts, win } from './lib.mjs';

const args = process.argv.slice(2);
const noTests = args.includes('--no-tests');
const sdkArg = args.includes('--sdk') ? args[args.indexOf('--sdk') + 1] : '';
const log = createLog('build.log', { append: true });
const { say, note, run } = log;
const t0 = Date.now();

say('');
say('==== build ' + new Date().toISOString() + ' ====');
say('machine: ' + machineLine());
{
  const head = run('git', ['rev-parse', '--short', 'HEAD']);
  const dirty = run('git', ['status', '--short']);
  say(
    'commit: ' +
      (head.ok ? head.out : 'unknown') +
      (dirty.ok && dirty.out ? ' (+' + dirty.out.split('\n').length + ' uncommitted file(s))' : '')
  );
}
say('options: ' + (args.join(' ') || 'none'));

// ---- the steps ----
const results = []; // { step, status: 'ok' | 'skipped' | 'FAILED', detail }
function record(step, status, detail = '') {
  results.push({ step, status, detail });
  say('  ' + (status === 'ok' ? 'OK       ' : status === 'skipped' ? 'SKIPPED  ' : 'FAILED   ') + step + (detail ? ': ' + detail : ''));
}
const stopOnFail = () => results.some((r) => r.status === 'FAILED');

say('');
say('App');
{
  const r = run('node', ['tools/build-app.mjs']);
  record('app bundle', r.ok ? 'ok' : 'FAILED', r.ok ? r.out.split('\n').pop().replace(root, '.') : r.out.split('\n')[0]);
}
if (!stopOnFail() && !noTests) {
  const l = run('node', ['tools/lint.mjs']);
  record('lint', l.ok ? 'ok' : 'FAILED', l.ok ? '' : l.out.split('\n')[0]);
  if (l.ok) {
    const t = run('node', ['--test', 'test/*.test.mjs'], { shell: true, lines: 60 });
    const n = (w) => (new RegExp('(?:#|ℹ) ' + w + ' (\\d+)').exec(t.out) || [])[1] || '?';
    record(
      'tests',
      t.ok ? 'ok' : 'FAILED',
      n('pass') + ' passed, ' + n('fail') + ' failed' + (Number(n('skipped')) ? ', ' + n('skipped') + ' skipped' : '')
    );
  }
} else if (noTests) record('lint and tests', 'skipped', '--no-tests');

// ---- the MSFS side ----
let sdk = null;
const wasmFiles = ['PusherTaxi.wasm', 'PusherFiles.wasm'].map((f) => join(root, 'PackageSources', 'modules', f));
if (!stopOnFail()) {
  say('');
  say('MSFS (needs Windows and the MSFS 2024 SDK)');
  sdk = win ? findSdk(note, sdkArg) : null;
  const bash = win ? findBash() : null;
  const missing = sdk
    ? sdkWasmParts(sdk)
        .filter((p) => !p[1])
        .map((p) => p[0])
    : [];
  note(
    'sdk: ' +
      (sdk ? sdk.dir + ' (' + sdk.how + ')' : 'none') +
      '; bash: ' +
      (bash ? bash.detail : 'none') +
      '; missing SDK parts: ' +
      (missing.join(', ') || 'none')
  );

  // WASM modules
  if (!win) record('WASM modules', 'skipped', 'Windows only');
  else if (!sdk) record('WASM modules', 'skipped', 'MSFS 2024 SDK not found (set MSFS2024_SDK, or pass --sdk <folder>)');
  else if (!bash) record('WASM modules', 'skipped', 'bash not found (install Git for Windows)');
  else if (missing.length) record('WASM modules', 'skipped', 'the SDK is missing ' + missing.join(', '));
  else {
    const started = Date.now();
    // no shell: through one the SDK folder ("G:\\MSFS 2024 SDK") would be split at its spaces
    const r = run(bash.cmd, ['wasm/build.sh', sdk.dir.replace(/\\/g, '/')], { lines: 40, shell: false });
    const made = wasmFiles.every((f) => existsSync(f) && statSync(f).mtimeMs >= started - 2000);
    if (existsSync(join(root, 'wasm', 'build.log')))
      note(
        'wasm/build.log (end):\n  ' +
          readFileSync(join(root, 'wasm', 'build.log'), 'utf8')
            .split('\n')
            .slice(-25)
            .join('\n  ')
      );
    record(
      'WASM modules',
      r.ok && made ? 'ok' : 'FAILED',
      r.ok && made
        ? 'PusherTaxi.wasm and PusherFiles.wasm built'
        : r.ok
          ? 'the script finished but the .wasm files are not new'
          : 'build.sh exited ' + r.status + ' (see the end of wasm/build.log above)'
    );
  }

  // The package: UNVERIFIED. fspackagetool has not been run by us yet: the flags below are the usual ones, so the first run is a test of them too.
  const tool = packageToolPath(sdk);
  const projectXml = join(root, 'PushPlannerProject.xml');
  if (!win) record('package', 'skipped', 'Windows only');
  else if (!sdk) record('package', 'skipped', 'MSFS 2024 SDK not found');
  else if (!sdkHas(sdk, 'Tools', 'bin', 'fspackagetool.exe'))
    record('package', 'skipped', 'fspackagetool.exe not at ' + tool + ' (build it in the Project Editor instead)');
  else {
    if (!wasmFiles.every((f) => existsSync(f))) say('  WARNING   no compiled WASM modules: the package will be built without them');
    // fspackagetool starts the real build in another process ("Attached to EXE - waiting for completion") and returns an exit code that is not 0 even
    // when the package is built (seen: 2279931962, a different number each run). So the result is judged by what it wrote: a fresh layout.json and no
    // errors in the package report.
    const started = Date.now();
    const r = run(tool, ['-nopause', projectXml], { lines: 40 });
    const layout = join(root, 'Packages', 'push-planner', 'layout.json');
    const report = join(root, '_PackageInt', '_RPTErrors.xml');
    const fresh = existsSync(layout) && statSync(layout).mtimeMs >= started - 2000;
    const errors = existsSync(report) ? (readFileSync(report, 'utf8').match(/<RPTError[ >]/g) || []).length : 0;
    note('fspackagetool exit ' + r.status + ' (not used); layout.json ' + (fresh ? 'fresh' : 'not fresh') + '; errors in _RPTErrors.xml: ' + errors);
    record(
      'package',
      fresh && !errors ? 'ok' : 'FAILED',
      fresh && !errors
        ? 'Packages/push-planner built, no errors in the package report'
        : !fresh
          ? 'Packages/push-planner/layout.json was not written (see _PackageInt/_RPTErrors.xml)'
          : errors + ' error(s) in _PackageInt/_RPTErrors.xml'
    );
  }
}

// ---- summary ----
say('');
const failed = results.filter((r) => r.status === 'FAILED');
const skipped = results.filter((r) => r.status === 'skipped');
say(
  'Summary (' +
    Math.round((Date.now() - t0) / 1000) +
    ' s): ' +
    results.filter((r) => r.status === 'ok').length +
    ' built, ' +
    skipped.length +
    ' skipped, ' +
    failed.length +
    ' failed'
);
if (skipped.length)
  say(
    '  skipped steps are warnings: ' +
      skipped.map((s) => s.step).join(', ') +
      (win ? '' : ' (build those on Windows with the SDK: npm run setup there to check)')
  );
say('  log: ' + log.file);
// The last line: which version was built and how it went, read back from the built files rather than assumed.
{
  const read = (f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8') : '');
  const want = JSON.parse(read('package.json') || '{}').version || '?';
  const inBundle = (read('PackageSources/PushPlanner/PushPlanner.js').match(/PS\.VERSION = '([^']*)'/) || [])[1] || '?';
  const inPackage = (read('PackageDefinitions/push-planner.xml').match(/<AssetPackage Version="([^"]*)"/) || [])[1] || '?';
  const same = inBundle === want && inPackage === want;
  say(
    'RESULT: ' +
      (failed.length ? 'BUILD FAILED (' + failed.map((f) => f.step).join(', ') + ')' : 'BUILD OK' + (skipped.length ? ' with ' + skipped.length + ' skipped step(s)' : '')) +
      ' - Push Planner ' +
      want +
      (same ? ' (app and package both say ' + want + ')' : ' - VERSION MISMATCH: app ' + inBundle + ', package ' + inPackage)
  );
}
process.exit(failed.length ? 1 : 0);
