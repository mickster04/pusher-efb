import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const PS = require('../PackageSources/PushPlanner/PushPlanner.js');

test('distance and bearing', () => {
  const d = PS.geo.distanceM(0, 0, 0, 1);
  assert.ok(Math.abs(d - 111195) < 200);
  assert.ok(Math.abs(PS.geo.bearingDeg(0, 0, 1, 0) - 0) < 0.01);
  assert.ok(Math.abs(PS.geo.bearingDeg(0, 0, 0, 1) - 90) < 0.01);
});

test('angleDiff wraps', () => {
  assert.equal(PS.geo.angleDiff(350, 10), 20);
  assert.equal(PS.geo.angleDiff(10, 350), -20);
  assert.equal(PS.geo.normDeg(-90), 270);
});

test('offset round trip', () => {
  const p = PS.geo.offset(51.47, -0.45, 45, 500);
  assert.ok(Math.abs(PS.geo.distanceM(51.47, -0.45, p[0], p[1]) - 500) < 1);
  assert.ok(Math.abs(PS.geo.bearingDeg(51.47, -0.45, p[0], p[1]) - 45) < 0.1);
});

test('nearestOnPolyline projects onto a segment', () => {
  const a = PS.geo.offset(0, 0, 90, -100), b = PS.geo.offset(0, 0, 90, 100);
  const n = PS.geo.nearestOnPolyline([a, b], PS.geo.offset(0, 0, 0, 50)[0], 0);
  assert.ok(Math.abs(n.distM - 50) < 1);
});

test('traffic: head-on contact closes and has CPA near zero', () => {
  const own = { lat: 0, lon: 0, hdgDeg: 0, gsKt: 10, altFt: 0 };
  const p = PS.geo.offset(0, 0, 0, 200);
  const r = PS.traffic.analyse(own, { lat: p[0], lon: p[1], hdgDeg: 180, gsKt: 10, altFt: 0 });
  assert.ok(Math.abs(r.distM - 200) < 1);
  assert.ok(r.closingKt > 19 && r.closingKt < 21);
  assert.ok(r.cpaM < 1);
  assert.ok(Math.abs(r.tcpaSec - 200 / (20 * PS.geo.KT_TO_MS)) < 0.5);
  assert.equal(r.ahead, true);
});

test('traffic: stationary contact has no tcpa when both stopped', () => {
  const own = { lat: 0, lon: 0, hdgDeg: 0, gsKt: 0, altFt: 0 };
  const r = PS.traffic.analyse(own, { lat: 0.001, lon: 0, hdgDeg: 0, gsKt: 0, altFt: 100 });
  assert.equal(r.tcpaSec, null);
  assert.equal(r.altDiffFt, 100);
});

test('taxi extract + aggregate on the sample layout', () => {
  const s = PS.taxi.sample(51.47, -0.45);
  const ex = PS.taxi.extract({ runways: s.runways, paths: s.paths, parking: s.parking });
  const rows = PS.taxi.aggregate(ex.items, 51.47, -0.45);
  const a = rows.find((r) => r.name === 'A' && r.category === 'Taxiway');
  assert.equal(a.segments, 4);
  assert.ok(a.lengthM > 400 && a.lengthM < 520);
  assert.ok(rows.find((r) => r.category === 'Runway'));
  assert.ok(rows.find((r) => r.category === 'Parking connector'));
  assert.equal(ex.parking.length, 2);
});

test('taxi extract reports unknown shapes instead of failing', () => {
  const ex = PS.taxi.extract({ icao: 'KSEA', frequencies: [] });
  assert.equal(ex.items.length, 0);
  assert.ok(/Top-level keys/.test(ex.notes[0]));
  assert.equal(PS.taxi.extract(null).items.length, 0);
});

test('toasts: show, update, dismiss', () => {
  PS.toasts.clear();
  const id = PS.toasts.show({ kind: 'info', title: 'x', persistent: true });
  assert.equal(PS.toasts.items.length, 1);
  PS.toasts.update(id, { message: 'm' });
  assert.equal(PS.toasts.items[0].message, 'm');
  PS.toasts.dismiss(id);
  assert.equal(PS.toasts.items.length, 0);
});

test('sim wrappers fail soft without a sim', () => {
  assert.equal(PS.getVar('X', 'number').ok, false);
  assert.equal(PS.setVar('X', 'number', 1).ok, false);
  assert.equal(PS.keyEvent('X', 1, 'coherent').ok, false);
  assert.equal(PS.readOwn(), null);
});

test('runway centre + heading + length becomes a line of the right length', () => {
  const ex = PS.taxi.extract({ runways: [{ designation: '02/20', latitude: -43.49, longitude: 172.53, direction: 20, length: 3000, width: 45 }] });
  assert.equal(ex.items.length, 1);
  assert.equal(ex.items[0].points.length, 2);
  const len = PS.geo.polylineLengthM(ex.items[0].points);
  assert.ok(Math.abs(len - 3000) < 5);
});

test('air traffic: our own aircraft in the list is ignored, even as it lags behind us', () => {
  const T = PS.airTraffic, G = PS.geo;
  T.ownIds = {};
  const own = { lat: -43.49, lon: 172.53 };
  const near = (d) => G.offset(own.lat, own.lon, 180, d);
  const mk = (id, d) => ({ id, title: 'T' + id, lat: near(d)[0], lon: near(d)[1] });
  let out = T.ignoreOwn([mk(1, 3), mk(2, 120)], own);
  assert.deepEqual(out.map((c) => c.id), [2], 'the one 3 m away is us');
  out = T.ignoreOwn([mk(1, 40), mk(2, 120)], own);                       // we moved on and it lags 40 m behind: still us
  assert.deepEqual(out.map((c) => c.id), [2]);
  out = T.ignoreOwn([mk(1, 200), mk(2, 120)], own);                      // 200 m away: a real contact now
  assert.deepEqual(out.map((c) => c.id), [1, 2]);
  out = T.ignoreOwn([mk(3, 40)], own);                                   // a different aircraft 40 m away that was never us is kept
  assert.deepEqual(out.map((c) => c.id), [3]);
  assert.equal(T.ignoreOwn([mk(4, 1)], null).length, 1, 'no own position: nothing is ignored');
});

test('wheel zoom: a notch is one step, small trackpad deltas add up, lines and pages count more', () => {
  const a = PS.ui.wheelAccum();
  assert.equal(a(-100, 0), -1, 'scroll up one notch: zoom in');
  assert.equal(a(100, 0), 1, 'scroll down one notch: zoom out');
  let steps = 0; for (let i = 0; i < 12; i++) steps += Math.abs(a(10, 0));
  assert.equal(steps, 2, 'twelve small deltas of 10 make two steps (50 each)');
  const b = PS.ui.wheelAccum();
  assert.equal(b(1, 1), 0, 'a single line is 33: not yet'); assert.equal(b(1, 1), 1, 'two lines: a step');
  assert.equal(PS.ui.wheelAccum()(1, 2), 1, 'a page is a step');
});

test('files module client: a ping, a list of several files, a save and a delete go to the module and the answers come back', async () => {
  const handlers = {}, store = { 'one.json': '{"id":"one"}', 'two.json': '{"id":"two"}' }, seen = [];
  globalThis.RegisterCommBusListener = (cb) => { if (cb) setTimeout(cb, 0); return { on: (n, h) => { handlers[n] = h; }, callWasm: (name, json) => {
    const req = JSON.parse(json); seen.push(name);
    const out = (m) => setTimeout(() => handlers.PusherFilesResponse(JSON.stringify(m)), 2);
    if (name === 'PusherFilesPing') out({ id: req.id, kind: 'pong', version: '0.2.0' });
    else if (name === 'PusherFilesList') { Object.keys(store).forEach((n) => out({ id: req.id, kind: 'file', name: n, text: store[n] })); out({ id: req.id, kind: 'end', count: 2 }); }
    else if (name === 'PusherFilesSave') { store[req.name] = req.text; out({ id: req.id, kind: 'saved', name: req.name, ok: true, detail: '' }); }
    else if (name === 'PusherFilesDelete') { delete store[req.name]; out({ id: req.id, kind: 'deleted', name: req.name, ok: true, detail: '' }); }
  } }; };
  try {
    const pong = await PS.wasmFiles.ping(500);
    assert.equal(pong.version, '0.2.0'); assert.ok(PS.wasmFiles.isAlive());
    assert.deepEqual((await PS.wasmFiles.list(500)).map((f) => f.name), ['one.json', 'two.json']);
    assert.equal((await PS.wasmFiles.save('three.json', '{"id":"three"}', 500)).ok, true);
    assert.equal(store['three.json'], '{"id":"three"}');
    assert.equal((await PS.wasmFiles.list(500)).length, 3);
    assert.equal((await PS.wasmFiles.remove('one.json', 500)).ok, true);
    assert.ok(!('one.json' in store));
  } finally { delete globalThis.RegisterCommBusListener; }
});

function recordingContext() {
  const g = { strokes: [], arcs: 0, texts: [], lineWidth: 1, strokeStyle: '', fillStyle: '', font: '',
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() { this.strokes.push({ width: this.lineWidth, color: this.strokeStyle }); }, arc() { this.arcs++; },
    fillRect() {}, fillText(t) { this.texts.push(['fill', t, this.font]); }, strokeText(t) { this.texts.push(['halo', t, this.lineWidth, this.strokeStyle]); } };
  return g;
}
const mapView = { scale: 1, toPx: (lat, lon) => [200 + lon * 100, 200 + lat * 100] };
const mapItems = [
  { category: 'Taxiway', name: 'A', rawName: 'A', points: [[0, 0], [0, 1]] },
  { category: 'Taxiway', name: '(unnamed)', rawName: '', points: [[1, 0], [1, 1]] },
  { category: 'Parking connector', name: '(unnamed)', rawName: '', points: [[2, 0], [2, 1]] },
  { category: 'Runway', name: '02/20', rawName: '', points: [[-1, 0], [-1, 1]] }
];

test('map lines: a named taxiway is at least twice as thick as an unnamed path and a runway at least four times, drawn runway first', () => {
  const g = recordingContext();
  PS.plotDraw.backdrop(g, mapView, 400, 400, 300, [200, 200], { items: mapItems, parking: [] });
  const drawn = g.strokes.slice(1);                                  // (the first stroke is the scale bar)
  const widths = drawn.map((s) => s.width);
  const runway = Math.max(...widths), named = widths.filter((w) => w < runway).sort((a, b) => b - a)[0], unnamed = Math.min(...widths);
  assert.ok(named >= 2 * unnamed, 'named ' + named + ' vs unnamed ' + unnamed);
  assert.ok(runway >= 4 * unnamed, 'runway ' + runway + ' vs unnamed ' + unnamed);
  assert.equal(widths[0], runway, 'the runway is drawn first (underneath)');
  assert.equal(widths[widths.length - 1], named, 'the named taxiways are drawn last (on top)');
});

test('map labels: taxiway and runway names are bold, centred on the line, with a gap in the background colour round them', () => {
  const g = recordingContext();
  PS.plotDraw.backdrop(g, mapView, 400, 400, 300, [200, 200], { items: mapItems, parking: [] });
  const fills = g.texts.filter((t) => t[0] === 'fill' && (t[1] === 'A' || t[1] === '02/20')), halos = g.texts.filter((t) => t[0] === 'halo');
  assert.equal(fills.length, 2); fills.forEach((f) => assert.match(f[2], /^bold 1[4-9]px/, 'bold and not small: ' + f[2]));
  ['A', '02/20'].forEach((n) => { const h = halos.find((x) => x[1] === n); assert.ok(h && h[2] >= 7, 'a wide gap behind ' + n); });
  assert.ok(g.texts.findIndex((t) => t[0] === 'halo' && t[1] === 'A') < g.texts.findIndex((t) => t[0] === 'fill' && t[1] === 'A'), 'the gap is drawn before the text');
});

test('map: range rings are off by default and can be switched on', () => {
  const g = recordingContext();
  PS.plotDraw.backdrop(g, mapView, 400, 400, 300, [200, 200], null);
  assert.equal(g.arcs, 0, 'no rings by default');
  PS.settings.set('rings', true);
  const g2 = recordingContext();
  PS.plotDraw.backdrop(g2, mapView, 400, 400, 300, [200, 200], null);
  assert.equal(g2.arcs, 4);
  PS.settings.set('rings', false);
});

test('the theme carries the map style, and a nested theme file is read', () => {
  const d = PS.theme.mapStyle();
  assert.deepEqual([d.unnamed, d.named, d.runway, d.label, d.gap], [3, 6, 32, 15, 9]);
  const file = { id: 'nested', name: 'Nested', page: { surface: { bg: '#102030' }, text: { text: '#eeeeee' }, controls: { accent: '#ff8800' } }, map: { paths: { runway: '#abcdef' }, lines: { runway: 20 } } };
  assert.equal(PS.theme.validateThemeFile(file), '');
  assert.equal(PS.theme.validateThemeFile({ id: 'flat', colours: { bg: '#102030', text: '#eeeeee', accent: '#ff8800' } }), '', 'the older flat shape still works');
});
