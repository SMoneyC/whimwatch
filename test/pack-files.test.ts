import { describe, expect, it } from 'vitest';
import { datePageByFiles, dropInstalledFiles, updateExclusions, versionless } from '../src/core/pack-files.js';
import type { AppSnapshot } from '../src/shared/api.js';
import type { CreatorResult, LocalFile, RemoteInfo } from '../src/shared/types.js';
import { newFilesFor } from '../src/renderer/src/eligibility.js';

const at = (iso: string): number => Date.parse(iso);
const page: RemoteInfo = {
  listing: { source: 'loverslab', url: 'https://www.loverslab.com/files/file/3528-moonberry-animations/', origin: 'directory' },
  status: 'ok',
  checkedAt: 0,
  // Moved by an edit: none of the files below is this new.
  updatedAt: at('2026-09-18T11:16:48Z'),
};
const local = (name: string): LocalFile => ({ path: `/mods/${name}`, root: '/mods', relPath: name, size: 1, mtimeMs: at('2026-09-14T05:36:12Z'), kind: 'ww-animation', authors: {} });
const listed = [
  { href: 'r=1', name: 'WW_Moonberry_Animations.package', updatedAt: at('2026-07-30T13:30:28Z') },
  { href: 'r=2', name: 'WW_Moonberry_Juniper_Petal.package', updatedAt: at('2026-09-11T11:55:39Z') },
  // Put up alongside their pack: a variant they chose not to install, not news.
  { href: 'r=3', name: 'WW_Moonberry_Animations_NoSound.package', updatedAt: at('2026-07-30T13:31:00Z') },
];

describe("dating a LoversLab page by its files", () => {
  it("uses their pack's own file date, and keeps newer files they don't have apart", () => {
    expect(datePageByFiles(page, listed, [local('ww_moonberry_animations.package')])).toEqual({
      ...page,
      updatedAt: at('2026-07-30T13:30:28Z'),
      newFiles: [{ name: 'WW_Moonberry_Juniper_Petal.package', updatedAt: at('2026-09-11T11:55:39Z') }],
    });
  });

  it('counts their own file under a new version number as their update, not a new pack', () => {
    const versions = [
      { href: 'r=1', name: 'WW_Moonberry_v1.package', updatedAt: at('2026-07-30T13:30:28Z') },
      { href: 'r=2', name: 'WW_Moonberry_V2.package', updatedAt: at('2026-09-11T11:55:39Z') },
    ];
    const dated = datePageByFiles(page, versions, [local('WW_Moonberry_v1.package')]);
    expect(dated).toEqual({ ...page, updatedAt: at('2026-09-11T11:55:39Z') });
    expect(versionless('WW_Moonberry_v1.2.package')).toBe(versionless('WW_Moonberry_V2.package'));
    // A different pack of theirs isn't a version of this one.
    expect(versionless('WW_Moonberry_Juniper_Petal.package')).not.toBe(versionless('WW_Moonberry_Animations.package'));
  });

  it('never takes a name with no letters, or a file from another page, for a version of theirs', () => {
    const numbered = [
      { href: 'r=1', name: 'WW_Moonberry_Animations.package', updatedAt: at('2026-07-30T13:30:28Z') },
      { href: 'r=2', name: '01.package', updatedAt: at('2026-09-11T11:55:39Z') },
      { href: 'r=3', name: 'Thornwood_2.package', updatedAt: at('2026-09-11T11:55:39Z') },
    ];
    // Their Thornwood_1 comes from another page of the creator's, so it says nothing about this one.
    const dated = datePageByFiles(page, numbered, [local('WW_Moonberry_Animations.package'), local('02.package'), local('Thornwood_1.package')]);
    expect(dated.updatedAt).toBe(at('2026-07-30T13:30:28Z'));
    expect(dated.newFiles?.map((f) => f.name)).toEqual(['01.package', 'Thornwood_2.package']);
  });

  it("leaves new and unwanted files out of an update, but not one they've installed since", () => {
    const listPage = { ...datePageByFiles(page, listed, [local('WW_Moonberry_Animations.package')]), chooserUrl: `${page.listing.url}?do=download` };
    const ignored = ['ww_moonberry_thornwood.package', 'ww_moonberry_velvet.package'];
    // Velvet was said no to, then installed from the page by hand: it's theirs now.
    expect(updateExclusions(listPage, ignored, [local('WW_Moonberry_Velvet.package')])).toEqual(['WW_Moonberry_Juniper_Petal.package', 'ww_moonberry_thornwood.package']);
    // A single-file entry has nothing to pick from, so nothing is asked for.
    expect(updateExclusions({ ...listPage, chooserUrl: undefined }, ignored, [])).toEqual([]);
  });

  it("changes nothing when no file on the list is theirs by name", () => {
    expect(datePageByFiles(page, listed, [local('Moonberry.zip')])).toBe(page);
    expect(datePageByFiles(page, [{ href: 'r=1', name: 'WW_Moonberry_Animations.package' }], [local('WW_Moonberry_Animations.package')])).toBe(page);
  });

  it('drops a new file once it is in their folders, whoever it is filed under', () => {
    const dated = datePageByFiles(page, listed, [local('WW_Moonberry_Animations.package')]);
    expect(dropInstalledFiles(dated, [local('WW_Moonberry_Juniper_Petal.package')]).newFiles).toBeUndefined();
    expect(dropInstalledFiles(dated, [local('Something_Else.package')])).toBe(dated);
  });

  it('offers new files with new packs, minus the ones they said no to', () => {
    const creator = { key: 'moonberry', remotes: [datePageByFiles(page, listed, [local('WW_Moonberry_Animations.package')])] } as CreatorResult;
    const snapshot = (showNewPacks: boolean, ignored: string[] = []): AppSnapshot => ({ settings: { showNewPacks }, ignoredFiles: { moonberry: ignored } }) as unknown as AppSnapshot;
    expect(newFilesFor(creator, snapshot(true)).map((f) => f.name)).toEqual(['WW_Moonberry_Juniper_Petal.package']);
    expect(newFilesFor(creator, snapshot(true, ['ww_moonberry_juniper_petal.package']))).toEqual([]);
    expect(newFilesFor(creator, snapshot(false))).toEqual([]);
  });
});
