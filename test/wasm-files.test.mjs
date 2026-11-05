// Host test of the files module (wasm/files/files_module.cpp): the module is compiled with stand-ins for the MSFS headers and a temporary folder as its
// work folder, then driven with the same JSON requests the EFB app sends. Skipped when no C++ compiler is found.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function findCompiler() {
  for (const cc of ['clang++', 'g++']) { try { execFileSync(cc, ['--version'], { stdio: 'ignore' }); return cc; } catch { /* next */ } }
  return null;
}
const cc = findCompiler();

const DRIVER = `
#include <cstdio>
#include <cstring>
#include <iostream>
#include <string>
#include "MSFS/MSFS_CommBus.h"
std::string g_sent; FsCommBusCallback g_handlers[16]; const char* g_names[16]; int g_n = 0;
#include "${join(root, 'wasm/files/files_module.cpp').replace(/\\/g, '/')}"
int main() {
  module_init();
  std::string line;
  while (std::getline(std::cin, line)) {
    size_t sp = line.find(' ');
    std::string ev = line.substr(0, sp), json = line.substr(sp + 1);
    for (int i = 0; i < g_n; ++i) if (ev == g_names[i]) g_handlers[i](json.c_str(), (unsigned)json.size(), nullptr);
  }
  return 0;
}
`;
const HEADER_BUS = `#pragma once
#include <string>
#include <cstdio>
typedef void (*FsCommBusCallback)(const char*, unsigned int, void*);
enum { FsCommBusBroadcast_JS = 1 };
extern std::string g_sent; extern FsCommBusCallback g_handlers[16]; extern const char* g_names[16]; extern int g_n;
inline bool fsCommBusCall(const char*, const char* a, unsigned int n, int) { std::printf("%.*s\\n", (int)n, a); return true; }
inline bool fsCommBusRegister(const char* name, FsCommBusCallback cb) { g_names[g_n] = name; g_handlers[g_n++] = cb; return true; }
`;

function build() {
  const dir = mkdtempSync(join(tmpdir(), 'pusher-files-'));
  mkdirSync(join(dir, 'inc/MSFS'), { recursive: true });
  mkdirSync(join(dir, 'work'));
  writeFileSync(join(dir, 'inc/MSFS/MSFS.h'), '#pragma once\n#define MSFS_CALLBACK\n');
  writeFileSync(join(dir, 'inc/MSFS/MSFS_CommBus.h'), HEADER_BUS);
  writeFileSync(join(dir, 'inc/MSFS/MSFS_WindowsTypes.h'), '#pragma once\n');
  writeFileSync(join(dir, 'driver.cpp'), DRIVER);
  const work = join(dir, 'work').replace(/\\/g, '/') + '/';
  execFileSync(cc, ['-std=c++17', '-Wall', '-Wextra', '-Werror', `-DPUSHER_WORK_DIR="${work}"`, '-I', join(dir, 'inc'), join(dir, 'driver.cpp'), '-o', join(dir, 'drv')], { stdio: 'pipe' });
  return { dir, work: join(dir, 'work'), run: (lines) => spawnSync(join(dir, 'drv'), { input: lines.join('\n') + '\n', encoding: 'utf8', cwd: dir }).stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)) };
}

test('files module: save, list, overwrite and delete theme files, with unsafe names refused', { skip: cc ? false : 'no C++ compiler' }, () => {
  const m = build();
  try {
    const theme = JSON.stringify({ id: 'saved-delta-night', name: 'Delta "night"', colours: { bg: '#101010', text: '#ffffff' } }, null, 1);   // has quotes, line breaks, spaces
    const save = (id, name, text) => `PusherFilesSave ${JSON.stringify({ id, name, text })}`;
    let out = m.run([save(1, 'delta-night.json', theme)]);
    assert.equal(out[0].kind, 'saved'); assert.equal(out[0].ok, true, out[0].detail);
    assert.equal(readFileSync(join(m.work, 'delta-night.json'), 'utf8'), theme, 'the file holds exactly the text sent');

    out = m.run(['PusherFilesList {"id":2}']);
    const files = out.filter((o) => o.kind === 'file');
    assert.equal(files.length, 1); assert.equal(files[0].name, 'delta-night.json'); assert.equal(files[0].text, theme, 'the text comes back intact');
    assert.deepEqual(out[out.length - 1], { id: 2, kind: 'end', count: 1 });

    out = m.run([save(3, 'delta-night.json', '{"id":"x"}')]);                                // saving the same name replaces the file
    assert.equal(out[0].ok, true); assert.equal(readFileSync(join(m.work, 'delta-night.json'), 'utf8'), '{"id":"x"}');

    for (const bad of ['..\\\\evil.json', '../evil.json', 'a/b.json', 'noext', '.hidden.json', 'x'.repeat(80) + '.json', 'a..b.json']) {
      out = m.run([save(4, bad, 'x')]);
      assert.equal(out[0].ok, false, 'refused: ' + bad);
    }
    assert.deepEqual(readdirSync(m.work), ['delta-night.json'], 'nothing else was written');
    writeFileSync(join(m.work, 'notes.txt'), 'not a theme'); writeFileSync(join(m.work, 'shared.json'), '{"id":"shared"}');
    out = m.run(['PusherFilesList {"id":5}']);
    assert.deepEqual(out.filter((o) => o.kind === 'file').map((o) => o.name).sort(), ['delta-night.json', 'shared.json'], 'any .json file dropped in is listed, other files are not');

    out = m.run(['PusherFilesDelete {"id":6,"name":"delta-night.json"}', 'PusherFilesDelete {"id":7,"name":"../x.json"}']);
    assert.equal(out[0].ok, true); assert.ok(!existsSync(join(m.work, 'delta-night.json')));
    assert.equal(out[1].ok, false);
  } finally { rmSync(m.dir, { recursive: true, force: true }); }
});
