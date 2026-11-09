// Remove what the build makes, so the next build starts from source. Never touches tracked files, your logs.txt or local-themes/.
//   node tools/clean.mjs          the JavaScript build output (npm run build makes it again, on any machine)
//   node tools/clean.mjs --full   also the compiled WASM modules and the built package: these need the MSFS SDK (Windows) to make again
//   node tools/clean.mjs --deps   also node_modules (run npm install afterwards)
//   node tools/clean.mjs --dry    only list what would go (combine with the others)
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const has = (f) => process.argv.includes(f);
const dry = has('--dry');

const targets = [
  'PackageSources/PushPlanner/PushPlanner.js', // the bundle (npm run build)
  'PackageSources/PushPlanner/themes', // theme files copied for the package
  'PackageSources/PushPlanner/LICENSE', // copied notices
  'PackageSources/PushPlanner/THIRD_PARTY_NOTICES.md',
  'PackageSources/localization' // the translations copied for the package
];
if (has('--full')) {
  targets.push('setup.log', 'build.log', 'wasm/build', 'wasm/build.log', 'Packages', 'PackagesMetadata', '_PackageInt');
  // compiled modules (the folder's README.txt is tracked and stays)
  const modules = join(root, 'PackageSources', 'modules');
  if (existsSync(modules)) for (const f of readdirSync(modules)) if (/\.wasm(\.bak)?$/.test(f)) targets.push('PackageSources/modules/' + f);
}
if (has('--deps')) targets.push('node_modules');

let n = 0;
for (const t of targets) {
  const p = join(root, t);
  if (!existsSync(p)) continue;
  n++;
  console.log((dry ? 'would remove ' : 'removed ') + relative(root, p));
  if (!dry) rmSync(p, { recursive: true, force: true });
}
console.log(n ? (dry ? n + ' item(s) would be removed' : n + ' item(s) removed; npm run build rebuilds the bundle') : 'nothing to clean');
