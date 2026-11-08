// A small lint with no dependencies: the checks that matter for code the sim's old browser has to run. `npm run lint` (also part of `npm test`).
//   - the sources use only what the sim's browser handles: no let/const, template strings or arrow functions, which would break it silently
//   - no line of code longer than MAX characters (comments and the text inside strings may be longer; Prettier does not wrap them) and no trailing spaces or tabs
//   - the built bundle parses
// Layout is Prettier's (.prettierrc.json): `npm run format` applies it.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX = 160;
const problems = [];

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    return statSync(f).isDirectory() ? walk(f) : [f];
  });
}

// Take out strings and comments so the checks look at code only (good enough for these checks: it does not parse regular expressions).
function codeOnly(line, state) {
  let out = '', i = 0;
  while (i < line.length) {
    const c = line[i], n = line[i + 1];
    if (state.block) { if (c === '*' && n === '/') { state.block = false; i += 2; } else i++; continue; }
    if (c === '/' && n === '*') { state.block = true; i += 2; continue; }
    if (c === '/' && n === '/') break;
    if (c === "'" || c === '"') { const q = c; i++; while (i < line.length && line[i] !== q) { if (line[i] === '\\') i++; i++; } i++; out += '""'; continue; }
    out += c; i++;
  }
  return out;
}

for (const file of walk(join(root, 'src')).filter((f) => f.endsWith('.js'))) {
  const rel = relative(root, file).split(sep).join('/');
  const state = { block: false };
  readFileSync(file, 'utf8').split('\n').forEach((raw, idx) => {
    const at = rel + ':' + (idx + 1);
    if (/[ \t]+$/.test(raw)) problems.push(at + ': trailing whitespace');
    if (raw.indexOf('\t') >= 0) problems.push(at + ': tab character');
    const code = codeOnly(raw, state);
    if (code.length > MAX) problems.push(at + ': code line is ' + code.length + ' characters (max ' + MAX + ')');
    if (/=>/.test(code)) problems.push(at + ': arrow function (the sim\'s browser: use function)');
    if (/\b(let|const)\s/.test(code)) problems.push(at + ': let/const (use var)');
    if (raw.indexOf('`') >= 0 && /`/.test(code.replace(/""/g, ''))) problems.push(at + ': template string');
  });
}

const bundle = join(root, 'PackageSources', 'PushPlanner', 'PushPlanner.js');
if (existsSync(bundle)) {
  try { new vm.Script(readFileSync(bundle, 'utf8'), { filename: 'PushPlanner.js' }); } catch (e) { problems.push('the built PushPlanner.js does not parse: ' + e.message); }
} else problems.push('PushPlanner.js is not built (run npm run build:app first)');

if (problems.length) {
  console.error(problems.slice(0, 60).join('\n') + (problems.length > 60 ? '\n... and ' + (problems.length - 60) + ' more' : ''));
  console.error('\nlint: ' + problems.length + ' problem(s)');
  process.exit(1);
}
console.log('lint: ok');
