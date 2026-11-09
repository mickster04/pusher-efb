// Keeps src/lang/pushplanner.loc (the sim's .loc format) in step with the texts in the code. The English text in PS.t('...') and PS.tt('...') is the key;
// each text gets a generated key (PUSHPLANNER.<WORDS>_<hash>) and an en-US entry. Existing translations are never touched.
//   node tools/lang.mjs            add texts that are in the code but not in the .loc (de-DE and fr-FR empty, "TranslationNeeded"); list the stale ones
//   node tools/lang.mjs --prune    also remove texts the code no longer uses
//   node tools/lang.mjs --check    change nothing; exit 1 if the .loc is missing a text or holds a stale one (the test runs this)
//   node tools/lang.mjs --strict   with --check: also exit 1 for any text still untranslated
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const locFile = join(root, 'src', 'lang', 'pushplanner.loc');
const LANGS = ['en-US', 'fr-FR', 'de-DE', 'es-ES'];
const args = process.argv.slice(2);
const check = args.includes('--check'),
  strict = args.includes('--strict'),
  prune = args.includes('--prune');

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    return statSync(f).isDirectory() ? walk(f) : f.endsWith('.js') ? [f] : [];
  });
}
// Every PS.t('...') / PS.tt('...') whose first argument is a string literal.
export function textsInCode() {
  const found = new Set();
  const re = /PS\.(?:tt|tp|t)\(\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")/g;
  for (const f of walk(join(root, 'src'))) {
    // comments are not code: drop whole-line comments and trailing " // ..." ones
    const src = readFileSync(f, 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')
      .replace(/\s\/\/\s.*$/gm, '');
    let m;
    while ((m = re.exec(src))) found.add(new Function('return ' + m[1])());
  }
  return [...found].sort();
}
// The texts marked PS.tp(...): patterns for sentences built from pieces (their keys have PATTERN in them, and the build lists them for the matcher).
export function patternsInCode() {
  const found = new Set();
  const re = /PS\.tp\(\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")/g;
  for (const f of walk(join(root, 'src'))) {
    const src = readFileSync(f, 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n');
    let m;
    while ((m = re.exec(src))) found.add(new Function('return ' + m[1])());
  }
  return found;
}
export function keyFor(text, pattern = false) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
  const slug = text
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40)
    .replace(/_$/, '');
  return 'PUSHPLANNER.' + (pattern ? 'PATTERN.' : '') + (slug || 'TEXT') + '_' + h.toString(16).slice(0, 4).padStart(4, '0');
}
const now = () => new Date().toISOString();
const newEntry = (text) => ({
  UUID: randomUUID(),
  LastModifiedBy: 'tools/lang.mjs',
  LastModifiedDate: now(),
  LocalizationStatus: 'TranslationNeeded',
  Languages: Object.fromEntries(
    LANGS.map((l) => [l, { Text: l === 'en-US' ? text : '', LocalizationStatus: l === 'en-US' ? 'TranslationOk' : 'TranslationNeeded' }])
  )
});

const file = existsSync(locFile)
  ? JSON.parse(readFileSync(locFile, 'utf8'))
  : { LocalisationFile: { Version: 2, UUID: randomUUID(), Languages: LANGS, Strings: {} } };
const strings = file.LocalisationFile.Strings;
const byText = new Map(Object.entries(strings).map(([k, v]) => [v.Languages['en-US'].Text, k]));
const inCode = textsInCode();
const patterns = patternsInCode();
const missing = inCode.filter((t) => !byText.has(t));
const stale = [...byText.keys()].filter((t) => !inCode.includes(t));
const untranslated = (code) => inCode.filter((t) => byText.has(t) && !strings[byText.get(t)].Languages[code].Text).length;

if (!check) {
  for (const t of missing) strings[keyFor(t, patterns.has(t))] = newEntry(t);
  if (prune) for (const t of stale) delete strings[byText.get(t)];
  for (const entry of Object.values(strings)) {
    // a translation that was filled in is no longer "needed"
    for (const l of LANGS) {
      const v = entry.Languages[l] || (entry.Languages[l] = { Text: '', LocalizationStatus: 'TranslationNeeded' });
      if (l !== 'en-US' && v.Text && v.LocalizationStatus === 'TranslationNeeded') v.LocalizationStatus = 'TranslationOk';
    }
  }
  if (missing.length || (prune && stale.length) || !existsSync(locFile)) writeFileSync(locFile, JSON.stringify(file, null, 2) + '\n');
}
console.log(
  inCode.length +
    ' texts in the code. ' +
    (check ? 'Missing from the .loc: ' : 'Added: ') +
    missing.length +
    '. Stale in the .loc: ' +
    stale.length +
    (prune && !check ? ' (removed)' : '') +
    '.'
);
for (const l of LANGS.slice(1)) console.log('  ' + l + ': ' + untranslated(l) + ' of ' + inCode.length + ' not translated');
if (check)
  for (const l of LANGS.slice(1))
    for (const t of inCode.filter((x) => byText.has(x) && !strings[byText.get(x)].Languages[l].Text).slice(0, 5)) console.log('  not translated (' + l + '): ' + t.slice(0, 90));
if (check && (missing.length || stale.length)) {
  for (const t of missing.slice(0, 10)) console.log('  missing: ' + t);
  for (const t of stale.slice(0, 10)) console.log('  stale: ' + t);
  console.log('Run: node tools/lang.mjs' + (stale.length ? ' --prune' : ''));
}
// exitCode, not process.exit(): on Windows a pipe is written asynchronously and process.exit() can drop what was printed (the test reads it)
process.exitCode = check && (missing.length || stale.length || (strict && LANGS.slice(1).some((l) => untranslated(l)))) ? 1 : 0;
