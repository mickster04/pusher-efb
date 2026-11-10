// Set up this machine for Push Planner: check the tools, offer to install the missing ones, then do what can be done here (prepare Prettier, build the
// app, run the tests). What needs the MSFS SDK or Windows (the WASM modules and the package) is a warning, never a failure: on a Mac the setup is complete
// without it. Everything is written to setup.log (ignored by git), so a problem can be read or sent without copying it out of the terminal.
//   node tools/setup.mjs                          do the setup (asks before installing anything)
//   node tools/setup.mjs --yes                    answer yes to every install question
//   node tools/setup.mjs --check                  only check and report: install nothing, build nothing
//   node tools/setup.mjs --sdk "G:\MSFS 2024 SDK"   look for the MSFS SDK in this folder
// Exit code 1 only if Node is missing or too old, or the app does not build or its tests fail.
import { existsSync, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import { createLog, findBash, findSdk, firstLine, mac, machineLine, packageToolPath, root, sdkHas, sdkWasmParts, win } from './lib.mjs';

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const yes = args.includes('--yes');
const sdkArg = args.includes('--sdk') ? args[args.indexOf('--sdk') + 1] : '';
const { file: logFile, stamp, say, note, run } = createLog('setup.log');
const version = (cmd, a = ['--version']) => {
  const r = run(cmd, a);
  return r.ok ? firstLine(r.out) : null;
};
let sdk = null; // set below, after the header is logged

// ---- the checks. A check with msfs: true is MSFS or Windows only: when it fails it is a warning, never a failure. ----
// fix: how to install it per platform (a command), or only a hand note.
const winget = (id) => ['winget', ['install', '--id', id, '-e', '--accept-source-agreements', '--accept-package-agreements']];
const checks = [
  {
    id: 'node',
    title: 'Node 20 or newer',
    blocks: 'building the app and running the tests',
    check: () => {
      const major = Number(process.versions.node.split('.')[0]);
      return { ok: major >= 20, detail: 'v' + process.versions.node + (major >= 20 ? '' : ' (too old)') };
    },
    fix: { win: winget('OpenJS.NodeJS.LTS'), mac: ['brew', ['install', 'node']], hand: 'Install Node 20 or newer from https://nodejs.org' }
  },
  {
    id: 'npm',
    title: 'npm and npx',
    blocks: 'formatting (npx fetches Prettier on first use)',
    check: () => {
      const v = version('npm');
      return { ok: !!v, detail: v ? 'npm ' + v : 'not found' };
    },
    fix: { hand: 'npm comes with Node: reinstall Node' }
  },
  {
    id: 'git',
    title: 'git',
    blocks: 'committing',
    check: () => {
      const v = version('git');
      return { ok: !!v, detail: v || 'not found' };
    },
    fix: { win: winget('Git.Git'), mac: ['brew', ['install', 'git']], hand: 'Install git from https://git-scm.com' }
  },
  {
    id: 'cpp',
    title: 'a C++ compiler (clang++ or g++)',
    blocks: 'the two WASM host tests, which are skipped without it',
    check: () => {
      for (const cc of ['clang++', 'g++']) {
        const v = version(cc);
        if (v) return { ok: true, detail: cc + ': ' + v };
      }
      return { ok: false, detail: 'none found' };
    },
    fix: {
      hand: mac
        ? 'Run: xcode-select --install'
        : 'Install clang or g++ (on Windows the MSFS SDK has its own compiler; this one is only for the tests)'
    }
  },
  {
    id: 'bash',
    title: 'bash (Git Bash on Windows)',
    msfs: true,
    blocks: 'building the WASM modules (npm run build:wasm)',
    check: () => {
      const b = findBash();
      return b ? { ok: true, detail: b.detail } : { ok: false, detail: 'not found' };
    },
    fix: { win: winget('Git.Git'), hand: 'Install git, which includes Git Bash' }
  },
  {
    id: 'sdk',
    title: 'the MSFS 2024 SDK',
    msfs: true,
    blocks: 'the WASM modules and the package',
    check: () => {
      if (!win) return { ok: false, detail: 'Windows only: build the WASM modules and the package on a Windows machine with the sim' };
      if (!sdk) return { ok: false, detail: 'not found (checked --sdk, MSFS2024_SDK and two common folders)' };
      const viaEnv = process.env.MSFS2024_SDK && sdk.dir === process.env.MSFS2024_SDK;
      return { ok: true, detail: sdk.dir + ' (from ' + sdk.how + ')' + (viaEnv ? '' : ', but MSFS2024_SDK is not set to it') };
    },
    fix: { hand: 'Install it from the sim: Options > General > Developers (Developer Mode on) > Help > SDK Installer' }
  },
  {
    id: 'clang',
    title: "the SDK's WASM compiler, linker and sysroot",
    msfs: true,
    blocks: 'the WASM modules',
    check: () => {
      if (!sdk) return { ok: false, detail: 'needs the SDK' };
      const missing = sdkWasmParts(sdk)
        .filter((p) => !p[1])
        .map((p) => p[0]);
      return { ok: !missing.length, detail: missing.length ? 'missing ' + missing.join(', ') : 'all four found' };
    },
    fix: { hand: 'Reinstall the SDK (WASM component)' }
  },
  {
    id: 'pkgtool',
    title: 'fspackagetool',
    msfs: true,
    blocks: 'building the package from the command line (the Project Editor still works)',
    check: () => {
      if (!sdk) return { ok: false, detail: 'needs the SDK' };
      const at = packageToolPath(sdk);
      if (sdkHas(sdk, 'Tools', 'bin', 'fspackagetool.exe')) return { ok: true, detail: at };
      const tools = existsSync(join(sdk.dir, 'Tools')) ? readdirSync(join(sdk.dir, 'Tools')).join(', ') : 'no Tools folder';
      return { ok: false, detail: 'not at ' + at + ' (the SDK Tools folder holds: ' + tools + ')' };
    },
    fix: { hand: 'Use the Project Editor (docs/BUILDING.md step 3) or reinstall the SDK' }
  }
];

// ---- 1. the tools ----
say('Push Planner setup  ' + new Date().toISOString());
say('machine: ' + machineLine() + ', cwd ' + root);
say('log: ' + logFile + (checkOnly ? '   (--check: nothing will be installed or built)' : ''));
sdk = findSdk(note, sdkArg);
say();
say('Tools');
const results = checks.map((c) => ({ ...c, ...c.check() }));
for (const r of results) say((r.ok ? '  OK       ' : r.msfs ? '  WARNING  ' : '  MISSING  ') + r.title + ': ' + r.detail);

// Offer to install what is missing, can be installed here, and is not MSFS only.
const installable = results.filter((r) => !r.ok && !r.msfs);
if (installable.length && !checkOnly) {
  say();
  say('Install');
  const rl = process.stdin.isTTY || yes ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  for (const r of installable) {
    const how = win ? r.fix.win : mac ? r.fix.mac : null;
    if (!how) {
      say('  ' + r.title + ': install by hand. ' + (r.fix.hand || ''));
      continue;
    }
    const cmdText = [how[0], ...how[1]].join(' ');
    let answer = 'n';
    if (yes) answer = 'y';
    else if (rl) answer = (await rl.question('  Install ' + r.title + ' with "' + cmdText + '"? [y/N] ')).trim().toLowerCase();
    else say('  ' + r.title + ': not installing without a terminal to ask in; run it yourself: ' + cmdText);
    stamp('  question: install ' + r.title + ' with ' + cmdText + ' -> ' + answer);
    if (answer !== 'y') continue;
    say('  running: ' + cmdText);
    const done = run(how[0], how[1], { stdio: 'inherit' });
    say(
      '  ' + (done.ok ? 'installed' : 'did not finish: see setup.log') + ' (open a new terminal so it is on the PATH, then run setup again)'
    );
  }
  if (rl) rl.close();
}

// ---- 2. what can be done here ----
let failed = !results.find((r) => r.id === 'node').ok;
if (!checkOnly && !failed) {
  say();
  say('Setup');
  const step = (title, cmd, a, detail) => {
    const r = run(cmd, a);
    say('  ' + (r.ok ? 'OK       ' : 'FAILED   ') + title + (r.ok && detail ? ': ' + detail(r.out) : ''));
    if (!r.ok) {
      say('           ' + firstLine(r.out) + '  (see setup.log)');
      failed = true;
    }
  };
  step(
    'Prettier ready (fetched once, then kept by npx)',
    'npx',
    ['--yes', 'prettier@3.3.3', '--version'],
    (o) => 'prettier ' + firstLine(o)
  );
  step('app built', 'node', ['tools/build-app.mjs'], (o) => firstLine(o).replace(root, '.'));
  const t = run('node', ['--test', 'test/*.test.mjs'], { shell: true });
  const count = (word) => (new RegExp('(?:#|ℹ) ' + word + ' (\\d+)').exec(t.out) || [])[1] || '?';
  const skipped = Number(count('skipped')) || 0;
  say(
    '  ' +
      (t.ok ? 'OK       ' : 'FAILED   ') +
      'tests: ' +
      count('pass') +
      ' passed, ' +
      count('fail') +
      ' failed' +
      (skipped ? ', ' + skipped + ' skipped' : '')
  );
  if (!t.ok) failed = true;
}

// ---- 3. warnings: the MSFS and Windows side ----
const warnings = results.filter((r) => !r.ok && r.msfs);
const cppMissing = results.find((r) => r.id === 'cpp' && !r.ok);
if (warnings.length || cppMissing) {
  say();
  say('Warnings (these do not stop the app being built or tested)');
  for (const r of [...warnings, ...(cppMissing ? [cppMissing] : [])])
    say('  - ' + r.title + ': ' + r.detail + '. Blocks ' + r.blocks + '.');
  if (warnings.length) {
    say('  To build the WASM modules and the package, run "npm run setup" on a Windows machine with MSFS 2024 and its SDK, then');
    say('  "npm run build:wasm" and build the package (docs/BUILDING.md steps 2 and 3).');
  }
}
if (win && sdk && !(process.env.MSFS2024_SDK && sdk.dir === process.env.MSFS2024_SDK)) {
  say();
  say('To let every script find the SDK, set the variable once (then open a new terminal):');
  say('  setx MSFS2024_SDK "' + sdk.dir + '"');
}

// ---- what exists here ----
const have = (p) => existsSync(join(root, p));
say();
say(
  'Built here: app bundle ' +
    (have('PackageSources/PushPlanner/PushPlanner.js') ? 'yes' : 'no') +
    ', WASM modules ' +
    (have('PackageSources/modules/PusherTaxi.wasm') && have('PackageSources/modules/PusherFiles.wasm') ? 'yes' : 'no') +
    ', package ' +
    (have('Packages/push-planner') ? 'yes' : 'no')
);
say(
  failed
    ? '\nSetup did not finish: see above and ' + logFile
    : '\nSetup complete' + (warnings.length ? ' for what this machine can do (see the warnings).' : '.')
);
process.exit(failed ? 1 : 0);
