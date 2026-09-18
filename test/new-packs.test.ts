import { describe, expect, it } from 'vitest';
import { toCreatorResult } from '../src/core/check.js';
import { fileNameKey, groupByCreator } from '../src/core/creators.js';
import type { LocalFile, PackageKind } from '../src/shared/types.js';

const file = (relPath: string, opts: { author?: string; kind?: PackageKind; at?: string } = {}): LocalFile => ({
  path: `/Mods/${relPath}`,
  root: '/Mods',
  relPath,
  size: 1,
  mtimeMs: Date.parse(opts.at ?? '2026-01-01'),
  kind: opts.kind ?? (opts.author ? 'ww-cas' : 'other'),
  authors: opts.author ? { [opts.author]: 1 } : {},
  primaryAuthor: opts.author,
});

describe('attributing a creator’s CAS and object packages', () => {
  // The case this was built for: 20 Moonberry_* files on disk, 4 of them carrying tuning that credits
  // the creator. The other 16 are CAS packages with no animation_author at all.
  const files = [
    file('Extras/Moonberry_marigolddress2.package', { author: 'Moonberry', at: '2026-09-14' }),
    file('Extras/Moonberry_marigolddress1.package', { at: '2026-09-14' }),
    file('Extras/Moonberry-juniperpetaloverlay-acne.package', { at: '2024-11-08' }),
    file('Extras/Moonberry_verbenalacelingerietopREMAKE.package', { at: '2026-09-17' }),
    file('Extras/OtherCreator_thing.package'),
  ];

  it('gives a creator the files named after them, and only those', () => {
    const [group, ...rest] = groupByCreator(files);
    expect(rest).toEqual([]);
    expect(group!.key).toBe('moonberry');
    expect(group!.files.map((f) => f.relPath)).toEqual([
      'Extras/Moonberry_marigolddress2.package',
      'Extras/Moonberry_marigolddress1.package',
      'Extras/Moonberry-juniperpetaloverlay-acne.package',
      'Extras/Moonberry_verbenalacelingerietopREMAKE.package',
    ]);
  });

  it('dates the creator from all of their files, not just the tuned ones', () => {
    const group = groupByCreator(files)[0]!;
    expect(toCreatorResult(group, []).localUpdatedAt).toBe(Date.parse('2026-09-17'));
  });

  it('never invents a creator from a file name alone', () => {
    expect(groupByCreator([file('Extras/Moonberry_gloria_wrap.package')])).toEqual([]);
  });

  it('lets tuning win over the name, and leaves short names alone', () => {
    const groups = groupByCreator([
      file('Ivy_thing.package', { author: 'Ivy' }),
      // "ivy" is three letters: too short to claim files on its name.
      file('Ivy_other.package'),
      file('Cobalt_a.package', { author: 'Cobalt' }),
      // Named after Cobalt but credited to Ivy: the tuning decides.
      file('Cobalt_b.package', { author: 'Ivy' }),
    ]);
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.files.map((f) => f.relPath)]));
    expect(byKey.ivy).toEqual(['Ivy_thing.package', 'Cobalt_b.package']);
    expect(byKey.cobalt).toEqual(['Cobalt_a.package']);
  });

  it('follows the catalog’s aliases, and gives a file to the longest name that claims it', () => {
    const groups = groupByCreator(
      [
        file('Echo_a.package', { author: 'Echo' }),
        file('EchoSims_b.package'),
        file('Amberlily_x.package', { author: 'Amberlily' }),
        file('AmberlilyPro_y.package', { author: 'AmberlilyPro' }),
        file('AmberlilyPro_z.package'),
      ],
      { echosims: 'echo' },
    );
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.files.map((f) => f.relPath)]));
    expect(byKey.echo).toEqual(['Echo_a.package', 'EchoSims_b.package']);
    expect(byKey.amberlilypro).toEqual(['AmberlilyPro_y.package', 'AmberlilyPro_z.package']);
    expect(byKey.amberlily).toEqual(['Amberlily_x.package']);
  });

  it('normalizes file names the way creator names are normalized', () => {
    expect(fileNameKey('/Mods/Extras/Moonberry-juniper petal.package')).toBe('moonberryjuniperpetal');
    expect(fileNameKey('C:\\Mods\\[Echo]Ember.package')).toBe('echoember');
    expect(fileNameKey('Amberlily_Lantern.ts4script')).toBe('amberlilylantern');
  });
});
