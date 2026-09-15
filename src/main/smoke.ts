import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listArchive } from '../core/archive.js';
import type { Fetcher } from '../core/fetcher.js';
import { checkLoversLab } from '../core/sources/loverslab.js';
import { checkPatreon } from '../core/sources/patreon.js';
import { checkWickedCc } from '../core/sources/wickedcc.js';
import { fetchWwModPage } from '../core/sources/wwmod.js';

/**
 * Live checks against the real sites (`npm run smoke:app`). Catches markup
 * changes that fixtures can't. Returns the number of failures.
 */
export async function runSmoke(fetcher: Fetcher, log = console.log): Promise<number> {
  let failures = 0;
  const check = async (name: string, fn: () => Promise<string>): Promise<void> => {
    try {
      log(`PASS  ${name}: ${await fn()}`);
    } catch (err) {
      failures++;
      log(`FAIL  ${name}: ${(err as Error).message}`);
    }
  };
  const assert = (cond: unknown, message: string): void => {
    if (!cond) throw new Error(message);
  };
  const day = (t?: number): string => (t ? new Date(t).toISOString().slice(0, 10) : 'none');

  // No network: proves the RAR worker can load node-unrar-js (it must be unpacked from app.asar in builds).
  await check('RAR worker', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'whimwatch-smoke-'));
    try {
      const file = join(dir, 'test.rar');
      await writeFile(file, Buffer.from(SMOKE_RAR, 'base64'));
      const entries = await listArchive(file);
      assert(entries.length === 2, `expected 2 entries, got ${entries.length}`);
      return entries.map((e) => e.name).join(', ');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  await check('wickedwhimsmod.com', async () => {
    const page = await fetchWwModPage(fetcher);
    assert(/^\d{3}[a-z]?(\.\d+)?$/.test(page.version ?? ''), `unexpected version ${page.version}`);
    assert(page.directory.length > 50, `only ${page.directory.length} directory entries`);
    assert(page.supportedGameVersions.length > 0, 'no supported game versions');
    return `v${page.version} (${day(page.releasedAt)}), ${page.directory.length} directory entries, supports ${page.supportedGameVersions.join(', ')}`;
  });

  await check('wicked.cc', async () => {
    const f = await checkWickedCc(
      { source: 'wickedcc', url: 'https://wicked.cc/animations/anarcis/anarcis-animations-for-wickedwhims/', origin: 'manual' },
      fetcher,
    );
    assert(f.updatedAt && f.updatedAt >= Date.UTC(2026, 7, 28), `updatedAt ${day(f.updatedAt)}`);
    assert(f.downloadUrl, 'no download link');
    return `updated ${day(f.updatedAt)}, patreon ${f.patreonLinks?.join(' ')}`;
  });

  if (fetcher.browserGet) {
    await check('LoversLab', async () => {
      const f = await checkLoversLab(
        { source: 'loverslab', url: 'https://www.loverslab.com/files/file/27388-lamaboy-adult-animations-for-wickedwhims/', origin: 'manual' },
        fetcher,
      );
      assert(f.version, 'no version');
      assert(f.updatedAt, 'no date');
      return `v${f.version}, updated ${day(f.updatedAt)}`;
    });

    await check('Patreon', async () => {
      const f = await checkPatreon({ source: 'patreon', url: 'https://www.patreon.com/LAMABOY', origin: 'manual' }, fetcher);
      assert(f.status === undefined, f.error ?? 'error');
      assert(f.updatedAt, 'no post date');
      return `"${f.title}" ${day(f.updatedAt)}${f.locked ? ' (locked)' : ''}`;
    });
  }
  return failures;
}

/** WithComment.rar from node-unrar-js's test files (MIT): two empty text files. */
const SMOKE_RAR = 'UmFyIRoHAM+QcwAADQAAAAAAAABE/XoAgCMAgAAAAHoAAAACz49u6RBWg0odMwMAAQAAAENNVAmRgUj+DP8lkhMHmASQ/weSuB6qBLpR5hAVgRbmhpQWpwFwlqcBRG9wBoQb3AUVFEaPLh/UcHHZN9gfx3H2G+QkNBsch2H4MKM+zftKitd/U8v3gxvoX2/UcRvxeGKIAjgjoh5Na88O461qTz+RPsmM0mwzF0ymRT9FY9y5doe1zHl0IJAuAAAAAAAAAAAAAgAAAAA1VYNKHTAJACAAAAAxRmlsZS50eHQAsCZjiozxdCCSNAAAAAAAAAAAAAIAAAAAOlWDSh0wDwAgAAAAMj8/LnR4dABOGzIth2UCALAgORXEPXsAQAcA';
