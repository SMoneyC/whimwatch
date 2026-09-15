import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbpfError, refpackDecompress, withPackage } from '../src/core/dbpf.js';
import { parseWickedTuning, scanDirs, SNIPPET_TUNING_TYPE } from '../src/core/scanner.js';
import { buildDbpf, wwTuningXml } from './helpers/dbpf-builder.js';

const CLIP = 0x6b20c4f3;

describe('DBPF reader', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'whimwatch-dbpf-'));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('reads zlib and uncompressed resources', async () => {
    const path = join(dir, 'mixed.package');
    await writeFile(
      path,
      buildDbpf([
        { type: CLIP, data: Buffer.alloc(64, 7), compression: 'none' },
        { type: SNIPPET_TUNING_TYPE, instance: 0x1234_5678_9abc_def0n, data: 'hello tuning' },
      ]),
    );
    await withPackage(path, async (pkg) => {
      expect(pkg.entries).toHaveLength(2);
      expect(pkg.entries[1]!.instance).toBe(0x1234_5678_9abc_def0n);
      expect((await pkg.read(pkg.entries[0]!))!.equals(Buffer.alloc(64, 7))).toBe(true);
      expect((await pkg.read(pkg.entries[1]!))!.toString()).toBe('hello tuning');
      expect(await pkg.read(pkg.entries[0]!, 10)).toBeNull();
    });
  });

  it('handles indexes with a shared type', async () => {
    const path = join(dir, 'shared.package');
    await writeFile(path, buildDbpf([{ type: SNIPPET_TUNING_TYPE, data: 'a' }, { type: SNIPPET_TUNING_TYPE, data: 'b' }], { sharedType: SNIPPET_TUNING_TYPE }));
    await withPackage(path, async (pkg) => {
      expect(pkg.entries.map((e) => e.type)).toEqual([SNIPPET_TUNING_TYPE, SNIPPET_TUNING_TYPE]);
      expect((await pkg.read(pkg.entries[1]!))!.toString()).toBe('b');
    });
  });

  it('rejects files that are not packages', async () => {
    const path = join(dir, 'fake.package');
    await writeFile(path, Buffer.alloc(200));
    await expect(withPackage(path, async () => undefined)).rejects.toBeInstanceOf(DbpfError);
  });

  it('decompresses RefPack streams', () => {
    // "abc" literal + copy 6 bytes from 3 back, then a 4-byte literal run, then stop.
    const stream = Buffer.from([0x10, 0xfb, 0x00, 0x00, 0x0d, 0x0f, 0x02, 0x61, 0x62, 0x63, 0xe0, 0x77, 0x78, 0x79, 0x7a, 0xfc]);
    expect(refpackDecompress(stream).toString()).toBe('abcabcabcwxyz');
  });

  it('rejects RefPack back-references before the start', () => {
    const stream = Buffer.from([0x10, 0xfb, 0x00, 0x00, 0x03, 0x00, 0x05, 0xfc]);
    expect(() => refpackDecompress(stream)).toThrow(DbpfError);
  });
});

describe('scanner', () => {
  let mods: string;
  beforeAll(async () => {
    mods = await mkdtemp(join(tmpdir(), 'whimwatch-mods-'));
    await writeFile(
      join(mods, 'WW_Tester_Animations.package'),
      buildDbpf([
        { type: CLIP, data: Buffer.alloc(32) },
        { type: SNIPPET_TUNING_TYPE, data: wwTuningXml({ authors: ['!Tester', '!Tester', 'Guest'] }) },
        { type: SNIPPET_TUNING_TYPE, data: wwTuningXml({ cls: 'StripClubDanceAnimationPackage', field: 'author_name', authors: ['!Tester'] }) },
      ]),
    );
    await writeFile(join(mods, 'Cas.package'), buildDbpf([{ type: SNIPPET_TUNING_TYPE, data: wwTuningXml({ cls: 'WickedWhimsCASPartsPackage', field: 'cas_part_author', authors: ['Maker &amp; Co'] }) }]));
    await writeFile(join(mods, 'Chair.package'), buildDbpf([{ type: 0x319e4f1d, data: 'object' }]));
    await writeFile(join(mods, 'broken.package'), 'not a package at all, but long enough to look like one maybe'.repeat(3));
    await writeFile(join(mods, 'TURBODRIVER_WickedWhims_Scripts.ts4script'), 'zip');
    await writeFile(join(mods, 'other_script.ts4script'), 'zip');
    await utimes(join(mods, 'Chair.package'), new Date('2024-01-01'), new Date('2024-01-01'));
  });
  afterAll(() => rm(mods, { recursive: true, force: true }));

  it('classifies packages and counts authors', async () => {
    const { files } = await scanDirs([mods]);
    const byName = Object.fromEntries(files.map((f) => [f.relPath, f]));

    expect(byName['WW_Tester_Animations.package']).toMatchObject({
      kind: 'ww-animation',
      authors: { '!Tester': 3, Guest: 1 },
      primaryAuthor: '!Tester',
    });
    expect(byName['Cas.package']).toMatchObject({ kind: 'ww-cas', primaryAuthor: 'Maker & Co' });
    expect(byName['Chair.package']).toMatchObject({ kind: 'other', authors: {} });
    expect(byName['broken.package']!.error).toBeTruthy();
    expect(byName['TURBODRIVER_WickedWhims_Scripts.ts4script']!.kind).toBe('ww-core');
    expect(byName['other_script.ts4script']!.kind).toBe('other');
    expect(byName['Chair.package']!.mtimeMs).toBe(new Date('2024-01-01').getTime());
  });

  it('reuses cached results when size and mtime match', async () => {
    const first = await scanDirs([mods]);
    const path = join(mods, 'WW_Tester_Animations.package');
    const cache = { ...first.cache, [path]: { ...first.cache[path]!, authors: { Cached: 1 } } };
    const second = await scanDirs([mods], { cache });
    expect(second.files.find((f) => f.path === path)!.primaryAuthor).toBe('Cached');
  });

  it('ignores tuning that is not WickedWhims content', () => {
    expect(parseWickedTuning('<?xml version="1.0"?><I c="Buff" n="x"><T n="animation_author">X</T></I>')).toBeNull();
  });
});
