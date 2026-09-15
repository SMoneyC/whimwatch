/**
 * Checks a packaged app (after `electron-builder`) before anything is uploaded:
 * app.asar holds only the build output, package.json and runtime dependencies (never source,
 * tests, docs or local files), the licence notices are included, and the window has the strict CSP.
 *
 *   npx tsx scripts/check-package.ts [dist]
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { extractFile, listPackage } from '@electron/asar';
import { PRODUCTION_CSP } from './csp';

const dist = process.argv[2] ?? 'dist';

function findAsars(dir: string, depth = 0): string[] {
  if (depth > 6 || !existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'app.asar') return [path];
    return statSync(path).isDirectory() && !name.endsWith('.asar.unpacked') ? findAsars(path, depth + 1) : [];
  });
}

const asars = findAsars(dist);
if (!asars.length) {
  console.error(`No app.asar found under ${dist}. Run electron-builder first.`);
  process.exit(1);
}

let failed = false;
for (const asar of asars) {
  const entries = listPackage(asar, { isPack: false }).map((e) => e.replace(/\\/g, '/'));
  const stray = entries.filter((e) => !/^\/(out|node_modules)(\/|$)|^\/package\.json$/.test(e));
  const maps = entries.filter((e) => e.startsWith('/out/') && e.endsWith('.map'));
  const required = ['/out/main/index.js', '/out/renderer/index.html', '/out/renderer/licenses/LICENSE.txt', '/out/renderer/licenses/THIRD_PARTY_LICENSES.txt'];
  const missing = required.filter((r) => !entries.includes(r));
  const html = entries.includes('/out/renderer/index.html') ? extractFile(asar, 'out/renderer/index.html').toString('utf8') : '';
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1]?.replace(/&#39;/g, "'");
  const problems = [
    ...stray.slice(0, 20).map((e) => `unexpected file: ${e}`),
    ...(stray.length > 20 ? [`…and ${stray.length - 20} more unexpected files`] : []),
    ...maps.map((e) => `source map: ${e}`),
    ...missing.map((e) => `missing: ${e}`),
    ...(html && csp !== PRODUCTION_CSP ? [`the app window's Content-Security-Policy is ${csp ? `"${csp}"` : 'missing'}, expected the production policy from scripts/csp.ts`] : []),
  ];
  if (problems.length) {
    failed = true;
    console.error(`✗ ${asar}\n  ${problems.join('\n  ')}`);
  } else {
    console.log(`✓ ${asar} (${entries.length} entries: build output, package.json and runtime dependencies only)`);
  }
}
process.exit(failed ? 1 : 0);
