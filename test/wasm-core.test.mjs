// Compiles the portable core of the taxi WASM module with the host C++ compiler, runs it, and feeds its JSON messages
// to the EFB-side client. Skipped when no clang++/g++ is available. The MSFS glue (wasm/src/module.cpp) is not covered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);
const PS = require('../PackageSources/PusherSpikes/PusherSpikes.js');

function findCompiler() {
  for (const cc of ['clang++', 'g++']) {
    const r = spawnSync(cc, ['--version'], { encoding: 'utf8' });
    if (r.status === 0) return cc;
  }
  return null;
}
const cc = findCompiler();
const skip = cc ? false : 'no C++ compiler on this machine';

let bin = null;
function build() {
  if (bin) return bin;
  const dir = mkdtempSync(join(tmpdir(), 'pusher-taxi-'));
  bin = join(dir, 'gen_sample');
  execFileSync(cc, ['-std=c++17', '-Wall', '-Wextra', '-Werror', '-O1', join(root, 'wasm/src/taxi_core.cpp'), join(root, 'wasm/test/gen_sample.cpp'), '-o', bin], { stdio: 'pipe' });
  return bin;
}
function run(...args) {
  return execFileSync(build(), args, { encoding: 'utf8' }).split('\n').filter(Boolean);
}
function assemble(lines) {
  const asm = PS.wasmTaxi.newAssembler();
  let result = null;
  for (const l of lines) { const r = asm.add(JSON.parse(l)); if (r) result = r; }
  return result;
}

test('core compiles warning-free and every message is valid JSON', { skip }, () => {
  const lines = run('sample');
  assert.ok(lines.length >= 5);
  lines.forEach((l) => JSON.parse(l));
  assert.equal(JSON.parse(lines[0]).kind, 'meta');
  assert.equal(JSON.parse(lines[lines.length - 1]).kind, 'end');
});

test('assembled layout has the right counts, names and geometry', { skip }, () => {
  const out = assemble(run('sample'));
  assert.equal(out.icao, 'NZCH');
  assert.ok(Math.abs(out.refLat - -43.489) < 1e-6);
  assert.equal(out.counts.points, 6);
  assert.equal(out.counts.skippedPaths, 1);          // the path with a bad end index
  assert.equal(out.paths.length, 6);
  assert.equal(out.parking.length, 3);
  const a = out.paths.filter((p) => p.name === 'A');
  assert.equal(a.length, 2);
  // path 0 runs 100 m east: A is 0,0 to 100,0
  const len = PS.geo.polylineLengthM(a[0].points);
  assert.ok(Math.abs(len - 100) < 1, 'A segment is about 100 m, got ' + len);
  assert.equal(a[0].widthM, 23);
  const b = out.paths.filter((p) => p.name === 'B');
  assert.ok(Math.abs(PS.geo.polylineLengthM(b[0].points) - 100) < 1);
  assert.ok(Math.abs(PS.geo.bearingDeg(...b[0].points[0], ...b[0].points[1]) - 0) < 0.5, 'B runs north');
  // the connector ends at a parking spot, not a taxi point
  const link = out.paths.find((p) => p.name === 'LINK');
  assert.equal(link.type, 3);
  const gate = out.parking.find((p) => p.name === 'Gate A 1');
  assert.ok(gate, 'parking label Gate A 1');
  assert.ok(Math.abs(PS.geo.distanceM(link.points[1][0], link.points[1][1], gate.lat, gate.lon)) < 0.5);
  assert.ok(out.parking.find((p) => p.name === 'Parking 2'));
  assert.ok(out.parking.find((p) => p.name === 'Gate 3A'));
  // a name with a quote and a backslash survives
  assert.ok(out.paths.some((p) => p.name === 'A"Q\\X'));
});

test('the layout feeds the page extract and table', { skip }, () => {
  const out = assemble(run('sample'));
  const ex = PS.taxi.extract({ paths: out.paths, parking: out.parking });
  assert.equal(ex.parking.length, 3);
  const rows = PS.taxi.aggregate(ex.items, out.refLat, out.refLon);
  const A = rows.find((r) => r.name === 'A' && r.category === 'Taxiway');
  assert.equal(A.segments, 2);
  assert.ok(Math.abs(A.lengthM - 200) < 2);
});

test('messages can arrive in any order and in tiny chunks', { skip }, () => {
  const lines = run('sample', '100');
  assert.ok(lines.length > 9, 'small chunk size makes many messages, got ' + lines.length);
  lines.forEach((l) => assert.ok(l.length < 400));
  const forward = assemble(lines);
  const shuffled = assemble(lines.slice().reverse());
  assert.deepEqual(shuffled, forward);
  assert.equal(forward.paths.length, 6);
  assert.equal(forward.parking.length, 3);
});

test('problems come back as one error message', { skip }, () => {
  for (const mode of ['empty', 'noairport']) {
    const lines = run(mode);
    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).kind, 'error');
    assert.throws(() => assemble(lines), /taxiway data|reference position/);
  }
});

test('request parser accepts good input and rejects bad', { skip }, () => {
  assert.deepEqual(run('request').map((s) => s.trimEnd()), ['1 7 NZCH', '1 12 EGLL', '0 3', '0 1', '0 0']);
});

test('client: ping then request over a fake CommBus', { skip }, async () => {
  const lines = run('sample');
  let handler = null;
  globalThis.RegisterCommBusListener = () => ({
    on: (name, cb) => { assert.equal(name, 'PusherTaxiResponse'); handler = cb; },
    callWasm: (name, json) => {
      const req = JSON.parse(json);
      setTimeout(() => {
        if (name === 'PusherTaxiPing') handler(JSON.stringify({ id: req.id, kind: 'pong', version: '0.1.0' }));
        else if (name === 'PusherTaxiRequest') {
          assert.equal(req.icao, 'NZCH');
          // reply with the real messages, re-stamped with the request id, delivered newest-first
          lines.map((l) => JSON.stringify({ ...JSON.parse(l), id: req.id })).reverse().forEach((m, i) => setTimeout(() => handler(m), i));
        }
      }, 1);
      return Promise.resolve();
    },
  });
  try {
    const r = await PS.wasmTaxi.request('nzch');
    assert.equal(r.icao, 'NZCH');
    assert.equal(r.paths.length, 6);
    assert.equal(PS.wasmTaxi.isAlive(), true);
    assert.equal(PS.wasmTaxi.version(), '0.1.0');
  } finally {
    delete globalThis.RegisterCommBusListener;
  }
});

test('client: reports a missing module quickly instead of hanging', { skip }, async () => {
  // A fresh module state is needed, so load a second copy of the bundle.
  delete require.cache[require.resolve('../PackageSources/PusherSpikes/PusherSpikes.js')];
  const PS2 = require('../PackageSources/PusherSpikes/PusherSpikes.js');
  globalThis.RegisterCommBusListener = () => ({ on: () => {}, callWasm: () => Promise.resolve() });
  try {
    await assert.rejects(PS2.wasmTaxi.ping(200), /no reply from the taxi module/);
  } finally {
    delete globalThis.RegisterCommBusListener;
  }
});
