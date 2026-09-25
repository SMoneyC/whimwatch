/**
 * How much of WhimWatch each language covers, and which messages it's missing (shown in English
 * until they're translated). For translators; nothing fails on a missing message.
 *
 *   npm run locales           every language's coverage
 *   npm run locales -- it     Italian's missing messages, with the English for each
 */
import { en } from '../src/shared/i18n/catalogs/en.js';
import { CATALOGS, isLocaleId, LOCALE_IDS, LOCALE_INFO } from '../src/shared/i18n/index.js';

/** Every message in a catalogue, by its dotted path. */
function paths(catalog: object, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) for (const [p, v] of paths(value, path)) out.set(p, v);
    else out.set(path, value);
  }
  return out;
}

const english = paths(en);
const only = process.argv[2];
if (only !== undefined && !isLocaleId(only)) {
  console.error(`Unknown language "${only}". WhimWatch has: ${LOCALE_IDS.join(', ')}.`);
  process.exit(1);
}

for (const id of LOCALE_IDS) {
  if (id === 'en' || (only && id !== only)) continue;
  const translated = paths(CATALOGS[id]);
  const missing = [...english.keys()].filter((path) => !translated.has(path));
  const done = english.size - missing.length;
  console.log(`${id} ${LOCALE_INFO[id].name}: ${done} of ${english.size} messages (${Math.floor((done / english.size) * 100)}%)`);
  if (only) {
    for (const path of missing) {
      const source = english.get(path);
      console.log(`  ${path}: ${typeof source === 'function' ? Function.prototype.toString.call(source) : JSON.stringify(source)}`);
    }
  } else if (missing.length) {
    console.log(`  run npm run locales -- ${id} to list them`);
  }
}
