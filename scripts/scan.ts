/**
 * Developer CLI: runs a full check against one or more Mods folders using
 * plain HTTP. LoversLab and Patreon need the desktop app's browser, so they
 * show as unavailable here; use `npm run scan:app` for those.
 *
 *   npm run scan -- "<path to Mods>" [--json]
 */
import { runCheck } from '../src/core/check.js';
import { createNodeFetcher } from '../src/core/fetcher.js';
import { formatReport } from '../src/core/report.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const dirs = args.filter((a) => a !== '--json');
if (!dirs.length) {
  console.error('Usage: npm run scan -- "<path to Mods>" [--json]');
  process.exit(1);
}

const { result } = await runCheck({
  dirs,
  fetcher: createNodeFetcher(),
  onProgress: (p) => {
    if (!json && process.stderr.isTTY) process.stderr.write(`\r\x1b[K${p.phase} ${p.done}/${p.total} ${p.message}`.slice(0, 100));
  },
});
if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');

console.log(json ? JSON.stringify(result, null, 2) : formatReport(result));
