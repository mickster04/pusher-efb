import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('version: package.json, the package definition and the built app all say the same', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const xml = /<AssetPackage Version="([^"]*)"/.exec(readFileSync('PackageDefinitions/push-planner.xml', 'utf8'))[1];
  const PS = require('../PackageSources/PushPlanner/PushPlanner.js');
  assert.equal(xml, pkg, 'package definition');
  assert.equal(PS.VERSION, pkg, 'built app (run npm run build:app: tools/build-app.mjs copies the version in)');
});
