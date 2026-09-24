import { describe, expect, it } from 'vitest';
import { currentByDate, datePageByFiles, dropInstalledFiles, startUnticked, updateExclusions, updateSkipped, versionless, wasSkipped, withoutVersion } from '../src/core/pack-files.js';
import type { AppSnapshot } from '../src/shared/api.js';
import type { CreatorResult, LocalFile, RemoteInfo } from '../src/shared/types.js';
import { ignoredFilesFor, newFilesFor } from '../src/renderer/src/eligibility.js';

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
      // Their pack is current, so the no-sound edition of that upload is one they left out.
      variants: ['WW_Moonberry_Animations_NoSound.package'],
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
    // Saved without a list (an older version, or markup that hid it): still given, for the download to
    // apply if the button leads to a list after all.
    expect(updateExclusions({ ...listPage, chooserUrl: undefined }, ignored, [])).toEqual(['WW_Moonberry_Juniper_Petal.package', ...ignored]);
    // Not a LoversLab page: nothing to pick from.
    expect(updateExclusions({ ...listPage, listing: { ...listPage.listing, source: 'wickedcc' } }, ignored, [])).toEqual([]);
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

    // Said no to, and still on the page: listed so it can be shown again. A name no longer on
    // any page has nothing to bring back.
    const said = snapshot(true, ['ww_moonberry_juniper_petal.package', 'ww_moonberry_thornwood.package']);
    expect(ignoredFilesFor(creator, said).map((f) => f.name)).toEqual(['WW_Moonberry_Juniper_Petal.package']);
    expect(ignoredFilesFor(creator, snapshot(true))).toEqual([]);
    expect(ignoredFilesFor(creator, snapshot(false, ['ww_moonberry_juniper_petal.package']))).toEqual([]);
    // The same file on two of their pages is one file to bring back.
    const twoPages = { key: 'moonberry', remotes: [creator.remotes[0]!, { ...creator.remotes[0]!, listing: { ...page.listing, url: `${page.listing.url}?second` } }] } as CreatorResult;
    expect(ignoredFilesFor(twoPages, said)).toHaveLength(1);
  });
});

describe('remembering files the user left out', () => {
  it("notes a pack's variants only while their pack is current, never with an update pending", () => {
    // Current: their copy (Sep 14) is newer than their file on the list (Jul 30).
    expect(datePageByFiles(page, listed, [local('WW_Moonberry_Animations.package')]).variants).toEqual(['WW_Moonberry_Animations_NoSound.package']);
    // Update pending: the list is the new upload, where a file they lack may be a companion it needs.
    const reuploaded = listed.map((f) => ({ ...f, updatedAt: at('2026-09-20T10:00:00Z') }));
    expect(datePageByFiles(page, reuploaded, [local('WW_Moonberry_Animations.package')]).variants).toBeUndefined();
  });

  it('knows a left-out file again by its name, or its name under another version marker', () => {
    const skipped = ['ww_moonberry_animations_nosound.package', 'ww_moonberry_thornwood_v1.2.package', 'ww_moonberry_velvet-1.5.package'];
    expect(wasSkipped('WW_Moonberry_Animations_NoSound.package', skipped)).toBe(true);
    expect(wasSkipped('WW_Moonberry_Animations_NoSound_v2.package', skipped)).toBe(true);
    expect(wasSkipped('WW_Moonberry_Thornwood_v2.package', skipped)).toBe(true);
    expect(wasSkipped('WW_Moonberry_Velvet-2.0.package', skipped)).toBe(true);
  });

  it("never takes a companion file for one they left out: a wrong match would leave it out of the update", () => {
    // Another kind of file, even under the same name.
    expect(wasSkipped('WW_Moonberry_Animations.ts4script', ['ww_moonberry_animations.zip'])).toBe(false);
    expect(wasSkipped('WW_Moonberry_Animations.ts4script', ['ww_moonberry_animations_v1.package'])).toBe(false);
    // Numbered parts are different files, not versions of one.
    expect(wasSkipped('WW_Moonberry_Pose_02.package', ['ww_moonberry_pose_01.package'])).toBe(false);
    expect(wasSkipped('02.package', ['01.package'])).toBe(false);
    // "v" inside a word is not a version marker.
    expect(withoutVersion('WW_Velvet.package')).toBe('ww_velvet.package');
    // A marker from the middle of a name leaves one separator, not two.
    expect(withoutVersion('WW_Moonberry_v2_NoSound.package')).toBe(withoutVersion('WW_Moonberry_NoSound.package'));
  });

  it("never takes an old version of their own file for one they skipped, so their update isn't left out", () => {
    // The page keeps the old version beside the one they have, which is current.
    const kept = [
      { href: 'r=1', name: 'WW_Moonberry_Animations_v0.package', updatedAt: at('2026-06-01T10:00:00Z') },
      { href: 'r=2', name: 'WW_Moonberry_Animations_v1.package', updatedAt: at('2026-07-30T13:30:28Z') },
      { href: 'r=3', name: 'WW_Moonberry_Animations_NoSound.package', updatedAt: at('2026-07-30T13:31:00Z') },
    ];
    const theirs = [local('WW_Moonberry_Animations_v1.package')];
    expect(datePageByFiles(page, kept, theirs).variants).toEqual(['WW_Moonberry_Animations_NoSound.package']);

    // Their update arrives as v2. Even with v0 already on a saved skipped list, v2 starts ticked;
    // the no-sound edition, whose name only shares their pack's start, still starts unticked.
    const files = [
      { target: '/mods/WW_Moonberry_Animations_v2.package', kind: 'add' },
      { target: '/mods/WW_Moonberry_Animations_NoSound.package', kind: 'add' },
    ];
    const skipped = ['ww_moonberry_animations_v0.package', 'ww_moonberry_animations_nosound.package'];
    expect(startUnticked(files, skipped, theirs)).toEqual(['/mods/WW_Moonberry_Animations_NoSound.package']);
    expect(startUnticked(files, [], theirs)).toEqual([]);
  });

  it('adds what was left out and forgets what has been installed since', () => {
    const after = updateSkipped(undefined, ['WW_Moonberry_Animations_NoSound.package', 'WW_Moonberry_Thornwood.package'], []);
    expect(after).toEqual(['ww_moonberry_animations_nosound.package', 'ww_moonberry_thornwood.package']);
    // They installed the no-sound edition's next version: it isn't left out any more.
    expect(updateSkipped(after, [], ['WW_Moonberry_Animations_NoSound_v2.package'])).toEqual(['ww_moonberry_thornwood.package']);
    expect(updateSkipped(['ww_moonberry_thornwood.package'], [], ['WW_Moonberry_Thornwood.package'])).toBeUndefined();
    // Installed in the same go as it was left out (two copies on the page): theirs, not skipped.
    expect(updateSkipped(undefined, ['WW_Moonberry_Velvet.package'], ['ww_moonberry_velvet.package'])).toBeUndefined();
  });

  it('only ever remembers mod files', () => {
    // An install left a zip and a preview unticked: neither is worth remembering.
    expect(updateSkipped(undefined, ['WW_Moonberry_Extras.zip', 'preview.jpg', 'WW_Moonberry_NoSound.package'], [])).toEqual(['ww_moonberry_nosound.package']);
    // Nor does a check note them as variants.
    const withZip = [...listed, { href: 'r=4', name: 'WW_Moonberry_Animations_All.zip', updatedAt: at('2026-07-30T13:30:28Z') }];
    expect(datePageByFiles(page, withZip, [local('WW_Moonberry_Animations.package')]).variants).toEqual(['WW_Moonberry_Animations_NoSound.package']);
  });
});

describe('telling from dates alone that an update has nothing new', () => {
  // Their copy of the pack is from Sep 14; the list says when each file was posted.
  const theirs = [local('WW_Moonberry_Animations.package')];

  it("counts a file of theirs posted no later than their copy as current, so it isn't downloaded", () => {
    const list = [
      { href: 'r=1', name: 'WW_Moonberry_Animations.package', updatedAt: at('2026-07-30T13:30:28Z') },
      { href: 'r=2', name: 'WW_Moonberry_Juniper_Petal.package', updatedAt: at('2026-07-30T13:30:28Z') },
      { href: 'r=3', name: 'WW_Moonberry_Thornwood.package' },
    ];
    // Juniper Petal isn't theirs, and Thornwood has no date: neither is known to be current.
    expect(currentByDate(list, theirs)).toEqual(['ww_moonberry_animations.package']);
  });

  it('never counts a file posted after their copy, even by an hour', () => {
    const list = [{ href: 'r=1', name: 'WW_Moonberry_Animations.package', updatedAt: at('2026-09-14T06:36:12Z') }];
    expect(currentByDate(list, theirs)).toEqual([]);
    // A copy installed by hand keeps the creator's older build date, so it is downloaded and compared.
    expect(currentByDate(list, [{ ...theirs[0]!, mtimeMs: at('2026-09-01T00:00:00Z') }])).toEqual([]);
  });

  it("lets this creator's own copy decide, and another creator's only for a name this one lacks", () => {
    const list = [{ href: 'r=1', name: 'English.package', updatedAt: at('2026-09-10T00:00:00Z') }];
    const another = [{ ...local('English.package'), mtimeMs: at('2026-09-20T00:00:00Z') }];
    // Only another creator has an English.package: that copy is all there is to go on.
    expect(currentByDate(list, theirs, another)).toEqual(['english.package']);
    // This creator has their own, older one: theirs decides, whatever another creator holds.
    const own = [...theirs, { ...local('English.package'), mtimeMs: at('2026-09-01T00:00:00Z') }];
    expect(currentByDate(list, own, another)).toEqual([]);
  });
});
