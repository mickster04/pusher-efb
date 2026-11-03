// Regenerates test/fixtures/suggest-golden.json from the ORIGINAL app's taxiSuggest.ts (sibling repo ../msfs-pusher-main), so the port in
// src/07-push-suggest.js can be checked against it. Needs Node 22.6+ (--experimental-strip-types). Run:  node test/tools/make-suggest-golden.mjs
import { mkdtempSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', '..', '..', 'msfs-pusher-main', 'apps', 'windows', 'src');
const tmp = mkdtempSync(join(tmpdir(), 'orig-'));
for (const f of ['planDraft.ts', 'mapGeo.ts', 'taxiSuggest.ts']) {
  const text = readFileSync(join(src, f), 'utf8').replace(/from '\.\/(planDraft|mapGeo|api)'/g, "from './$1.ts'").replace("from '@shared/api/types'", "from './types.ts'");
  writeFileSync(join(tmp, f), text);
}
writeFileSync(join(tmp, 'api.ts'), 'export {};\n'); writeFileSync(join(tmp, 'types.ts'), 'export {};\n'); writeFileSync(join(tmp, 'package.json'), '{"type":"module"}');
copyFileSync(join(here, 'suggest-scenarios.mjs'), join(tmp, 'suggest-scenarios.mjs'));
const require = createRequire(import.meta.url);
const bundle = join(here, '..', '..', 'PackageSources', 'PusherSpikes', 'PusherSpikes.js');
writeFileSync(join(tmp, 'run.mjs'), `
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { suggestPushbacks } from './taxiSuggest.ts';
import { scenarios } from './suggest-scenarios.mjs';
const PS = createRequire(import.meta.url)(${JSON.stringify(bundle)});
const sc = scenarios(PS.geo);
const out = {};
for (const [name, mk] of Object.entries(sc.layouts)) {
  for (const hdg of sc.headings) {
    out[name + '@' + hdg] = suggestPushbacks(mk(), { lat: sc.ref[0], lon: sc.ref[1], hdgDeg: hdg }).map((s) => ({ title: s.title, pins: s.waypoints.length, endHeading: s.waypoints[s.waypoints.length - 1].headingDeg }));
  }
}
writeFileSync(${JSON.stringify(join(here, '..', 'fixtures', 'suggest-golden.json'))}, JSON.stringify(out, null, 1) + '\\n');
console.log('wrote golden for ' + Object.keys(out).length + ' scenarios');
`);
const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', join(tmp, 'run.mjs')], { stdio: 'inherit' });
process.exit(r.status ?? 1);
