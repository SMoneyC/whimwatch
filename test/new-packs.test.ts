import { describe, expect, it } from 'vitest';
import { markSeenPages, toCreatorResult } from '../src/core/check.js';
import { linkKey } from '../src/core/sources/urls.js';
import { creatorStatus, outdatedRemotes, seenMark, seenUpTo, TOLERANCE_MS } from '../src/core/compare.js';
import { type CreatorGroup, fileNameKey, groupByCreator } from '../src/core/creators.js';
import { classifyRemotes, datePacks, packFiles, packOwnership, packWords } from '../src/core/ownership.js';
import { chooseRemote } from '../src/core/source-choice.js';
import { type HistoryItem, isNewPackInstall, undoRestoresFiles } from '../src/renderer/src/history.js';
import type { InstallRecord, LocalFile, PackageKind, RemoteInfo } from '../src/shared/types.js';
import { newPacks, ownedRemotes, updatableRemotes } from '../src/shared/updatable.js';

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

const page = (title: string, url = title.toLowerCase().replace(/\W+/g, '-')): RemoteInfo => ({
  listing: { source: 'wickedcc', url: `https://wicked.cc/clothing/moonberry/${url}`, origin: 'directory' },
  checkedAt: 0,
  status: 'ok',
  updatedAt: Date.parse('2026-06-01'),
  title,
  downloadUrl: `https://wicked.cc/dl/${url}`,
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

describe('telling a new pack from an update', () => {
  const names = [
    'moonberryverbenalacelingerietopremake',
    'moonberrymarigolddress1',
    'moonberryjuniperpetaloverlayacne',
    'moonberryaura101bottomww',
  ];
  const owns = (title: string): ReturnType<typeof packOwnership> => packOwnership(title, names, 'moonberry');

  it('drops the creator, the site and the release from a page name', () => {
    expect(packWords('Verbena Lace Lingerie REMAKE', 'moonberry')).toEqual(['verbena', 'lace', 'lingerie']);
    expect(packWords('Marigold Dress ~UNDRESSABLE~', 'moonberry')).toEqual(['marigold', 'dress']);
    expect(packWords('AURA V10.2 ✦ 2026-02-24 UPDATE', 'moonberry')).toEqual(['aura']);
    expect(packWords('Rowan Overlay V1 EXTRAS [ UPDATED 16/01 ]', 'moonberry')).toEqual(['rowan', 'extras']);
    // A creator's catalogue page, where every word is the creator or the site.
    expect(packWords('Moon Berry Animations for WickedWhims', 'moonberry')).toEqual([]);
  });

  it('calls a pack theirs when every word of its name is in their files', () => {
    expect(owns('Verbena Lace Lingerie REMAKE')).toBe('yes');
    expect(owns('Marigold Dress ~UNDRESSABLE~')).toBe('yes');
    expect(owns('Juniper Petal Overlay ~AURA V9~')).toBe('yes');
    expect(owns('Aura V10.1 ✦ UPDATE')).toBe('yes');
  });

  it('calls it new when not one distinctive word of it is there', () => {
    expect(owns('Sorbet Set')).toBe('no');
    expect(owns('Cinder Shorts REMAKE ~UNDRESSABLE~')).toBe('no');
    expect(owns('Harbor Twill Jeans REMAKE ~UNDRESSABLE~')).toBe('no');
    expect(owns('Rowan Dusk Overlays V1 [ UPDATED 6/1 ]')).toBe('no');
  });

  it('says nothing when it is half right, which counts as theirs', () => {
    // "dress" is in their files and "pop" is not: not enough either way.
    expect(owns('Ash Dress REMAKE ~UNDRESSABLE~')).toBeUndefined();
    expect(owns('Translucent Petal Dress ~UNDRESSABLE~')).toBeUndefined();
    // Nothing matches, but "dusk" is too short to hang a verdict on.
    expect(owns('Dusk Overlay Update V4')).toBeUndefined();
    expect(owns('')).toBeUndefined();
    expect(packOwnership('Sorbet Set', [], 'moonberry')).toBeUndefined();
  });
});

describe('an update to one pack is not hidden by a newer file from another', () => {
  const group = (files: LocalFile[]): CreatorGroup => ({ key: 'moonberry', name: 'Moonberry', files });
  const dated = (title: string, at: string): RemoteInfo => ({ ...page(title), updatedAt: Date.parse(at) });

  it('matches a page to the files that carry its name', () => {
    const files = [
      file('Moonberry_juniperpetaloverlay-acne.package'),
      file('Moonberry_juniperpetaloverlay-dimple.package'),
      file('Moonberry_marigolddress1.package'),
    ];
    expect(packFiles('Juniper Petal Overlay ~AURA V9~', files, 'moonberry').map((f) => f.relPath)).toEqual([
      'Moonberry_juniperpetaloverlay-acne.package',
      'Moonberry_juniperpetaloverlay-dimple.package',
    ]);
    // Every word has to be in the one file's own name, not spread across the folder.
    expect(packFiles('Marigold Lingerie', files, 'moonberry')).toEqual([]);
    // A catalogue title names no pack, so it matches nothing and the creator-wide date is used.
    expect(packFiles('Moonberry Animations for WickedWhims', files, 'moonberry')).toEqual([]);
  });

  it('is what the reported bug was: a pack of yours updated before your newest file', () => {
    const files = [
      file('Moonberry_juniperpetal.package', { at: '2024-11-08' }), // the pack that has an update waiting
      file('Moonberry_sorbetbelttop.package', { at: '2026-09-18' }), // something else of theirs, got today
    ];
    const remotes = [dated('Juniper Petal', '2024-12-15'), dated('Sorbet', '2026-09-01')];
    const c = toCreatorResult(group(files), remotes);

    expect(c.status).toBe('update-available');
    // The row names the page that needs updating, not the creator's newest page.
    expect(c.remoteUpdatedAt).toBe(Date.parse('2024-12-15'));
    expect(outdatedRemotes(c.remotes, c.localUpdatedAt).map((r) => r.title)).toEqual(['Juniper Petal']);
    // Before per-pack dating this compared 2024-12-15 against 2026-09-18 and said "up to date".
    expect(creatorStatus(c.localUpdatedAt, remotes).status).toBe('up-to-date');
  });

  it('still calls a pack current when your files for it are newer', () => {
    const files = [file('Moonberry_verbenalacelingerietop.package', { at: '2026-09-17' })];
    const c = toCreatorResult(group(files), [dated('Verbena Lace Lingerie REMAKE', '2026-09-16')]);
    expect(c.status).toBe('up-to-date');
  });

  it('falls back to the creator date for a page that names no pack of yours', () => {
    const files = [file('Moonberry_thing.package', { at: '2026-01-01' })];
    const c = toCreatorResult(group(files), [dated('Anims for WickedWhims', '2026-06-01')]);
    expect(c.remotes[0]!.yoursAt).toBeUndefined();
    expect(c.status).toBe('update-available');
  });

  it('stops being an update once you install it, without waiting for a new check', () => {
    // The staleness a reviewer found: after an install, rescanLocal refreshes the files and re-runs
    // datePacks. Skipping that second step left the page dated against the pre-install file for ever.
    const before = [file('Moonberry_juniperpetal.package', { at: '2024-11-08' })];
    const remotes = [dated('Juniper Petal', '2024-12-15')];
    expect(toCreatorResult(group(before), remotes).status).toBe('update-available');

    const after = [file('Moonberry_juniperpetal.package', { at: '2026-09-18' })];
    const redated = datePacks(group(after), toCreatorResult(group(before), remotes).remotes);
    const local = Math.max(...after.map((f) => f.mtimeMs));
    expect(creatorStatus(local, redated).status).toBe('up-to-date');
    // Without re-dating, the stale yoursAt shadows the newly raised file date.
    expect(creatorStatus(local, toCreatorResult(group(before), remotes).remotes).status).toBe('update-available');
  });

  it('marks one pack as seen without burying another that is behind', () => {
    const files = [file('Moonberry_juniperpetal.package', { at: '2024-11-08' }), file('Moonberry_sorbet.package', { at: '2026-08-01' })];
    const remotes = [dated('Juniper Petal', '2024-12-15'), dated('Sorbet', '2026-09-01')];
    // "Update all" takes the newest page that's behind, finds the files identical, and marks it seen.
    const seen = { [linkKey(remotes[1]!.listing.url)]: Date.parse('2026-09-01') };
    const c = toCreatorResult(group(files), remotes, undefined, seen);
    expect(outdatedRemotes(c.remotes, c.localUpdatedAt).map((r) => r.title)).toEqual(['Juniper Petal']);
    // Recorded creator-wide instead, the older pack would have gone with it.
    const buried = toCreatorResult(group(files), remotes, Date.parse('2026-09-01'));
    expect(outdatedRemotes(buried.remotes, buried.localUpdatedAt, buried.dismissedAt)).toEqual([]);
  });

  it('measures how far behind the furthest-behind pack is', () => {
    const files = [file('Moonberry_juniperpetal.package', { at: '2024-11-08' }), file('Moonberry_sorbet.package', { at: '2026-09-18' })];
    const c = toCreatorResult(group(files), [dated('Juniper Petal', '2024-12-15')]);
    expect(c.behindBy).toBe(Date.parse('2024-12-15') - Date.parse('2024-11-08'));
  });
});

describe('History tells getting a pack apart from updating one', () => {
  const record = (over: Partial<InstallRecord> = {}): InstallRecord => ({
    id: 'i1',
    creatorKey: 'moonberry',
    name: 'Moonberry',
    at: 0,
    backupDir: '/backups/i1',
    operations: [{ kind: 'add', target: '/Mods/Moonberry_sorbetbelttop.package' }],
    ...over,
  });
  const entry = (r: InstallRecord): HistoryItem => ({ kind: 'install', id: r.id, at: r.at, record: r });

  it('only calls it a new pack when the install said so', () => {
    expect(isNewPackInstall(entry(record({ newPack: true })))).toBe(true);
    // The case that made deriving this from the operations wrong: an ordinary update that happens
    // to add a file and replace nothing.
    expect(isNewPackInstall(entry(record()))).toBe(false);
  });

  it('never calls an Update all run a new pack', () => {
    const batch: HistoryItem = { kind: 'batch', id: 'b1', at: 0, records: [record({ newPack: true }), record({ id: 'i2' })] };
    expect(isNewPackInstall(batch)).toBe(false);
  });

  it('knows undoing a pack removes files rather than putting any back', () => {
    expect(undoRestoresFiles([record()])).toBe(false);
    expect(undoRestoresFiles([record({ operations: [{ kind: 'replace', target: '/Mods/a.package', backup: '/backups/i1/a.package' }] })])).toBe(true);
    // Mixed: something was replaced, so something really does come back.
    expect(
      undoRestoresFiles([
        record({
          operations: [
            { kind: 'add', target: '/Mods/new.package' },
            { kind: 'replace', target: '/Mods/old.package', backup: '/backups/i1/old.package' },
          ],
        }),
      ]),
    ).toBe(true);
  });
});

describe('what a new pack does to a creator', () => {
  const group = (files: LocalFile[]): CreatorGroup => ({ key: 'moonberry', name: 'Moonberry', files });
  const files = [file('Moonberry_marigolddress1.package', { author: 'Moonberry', at: '2026-01-01' })];

  it('only reads wicked.cc pages, and only when there is more than one', () => {
    const single = classifyRemotes(group(files), [page('Sorbet Set')]);
    expect(single[0]!.owned).toBeUndefined();

    const thread: RemoteInfo = { ...page('Sorbet Set'), listing: { source: 'loverslab', url: 'https://www.loverslab.com/x', origin: 'directory' } };
    const marked = classifyRemotes(group(files), [thread, page('Marigold Dress'), page('Cinder Shorts')]);
    expect(marked.map((r) => r.owned)).toEqual([undefined, 'yes', 'no']);
  });

  it('gives up rather than leave a creator with pages but nothing to compare', () => {
    // Every page reads as new: the names didn't work here, so none of the verdicts is trusted.
    const all = classifyRemotes(group(files), [page('Sorbet Set'), page('Cinder Shorts')]);
    expect(all.map((r) => r.owned)).toEqual([undefined, undefined]);
    expect(toCreatorResult(group(files), all).status).not.toBe('unknown');

    // With a page left that does count, the dates still come from somewhere.
    const kept = classifyRemotes(group(files), [page('Sorbet Set'), page('Cinder Shorts'), page('Marigold Dress')]);
    expect(kept.map((r) => r.owned)).toEqual(['no', 'no', 'yes']);
  });

  it('keeps a new pack out of the status, the newest date and Update all', () => {
    const local = Date.parse('2026-01-01');
    const theirs = { ...page('Marigold Dress'), updatedAt: local };
    const fresh = { ...page('Cinder Shorts'), updatedAt: local + 10 * TOLERANCE_MS };
    const result = toCreatorResult({ ...group(files), files: [{ ...files[0]!, mtimeMs: local }] }, [theirs, fresh]);

    expect(result.remotes.map((r) => r.owned)).toEqual(['yes', 'no']);
    expect(result.status).toBe('up-to-date');
    expect(result.remoteUpdatedAt).toBe(local);
    // Without the classification it is an update, which is the 0.1.1 behaviour being fixed.
    expect(creatorStatus(local, [theirs, { ...fresh, owned: undefined }]).status).toBe('update-available');
  });

  it('never lets a new pack be the source an update is taken from', async () => {
    const theirs = { ...page('Marigold Dress'), updatedAt: Date.parse('2026-01-01') };
    const pack: RemoteInfo = { ...page('Cinder Shorts'), updatedAt: Date.parse('2026-06-01'), owned: 'no' };
    const opts = { signedIn: () => true, countFiles: async () => 1 };

    // Newest first would pick the pack they don't have.
    expect(await chooseRemote([theirs, pack], opts)).toBe(theirs);
    // Unless it's the page they asked for: that's how getting a new pack works.
    expect(await chooseRemote([theirs, pack], { ...opts, listingUrl: pack.listing.url })).toBe(pack);

    expect(ownedRemotes([theirs, pack])).toEqual([theirs]);
    expect(newPacks([theirs, pack])).toEqual([pack]);
    expect(updatableRemotes(ownedRemotes([theirs, pack]), () => true)).toEqual([theirs]);
  });

  it('does not let a new pack drag the "marked as seen" date forward', () => {
    const checked = Date.parse('2026-01-01');
    const pack: RemoteInfo = { ...page('Cinder Shorts'), updatedAt: checked + TOLERANCE_MS / 2, owned: 'no' };
    expect(seenUpTo([pack], checked)).toBe(checked);
    expect(seenUpTo([{ ...pack, owned: 'yes' }], checked)).toBe(checked + TOLERANCE_MS / 2);
  });
});

describe('marking one pack as seen when the creator has no author metadata', () => {
  // Plain CAS packs: no WickedWhims tuning, so they reach the creator by filename and no remote
  // here gets a yoursAt of its own.
  const dated = (title: string, at: string): RemoteInfo => ({ ...page(title), updatedAt: Date.parse(at) });
  const creator = {
    remotes: [dated('Lace Slip', '2026-09-16T22:38:44Z'), dated('Velvet Dress', '2026-09-11T06:04:17Z'), dated('Sorbet Set', '2026-09-04T05:32:31Z')],
    remoteUpdatedAt: Date.parse('2026-09-16T22:38:44Z'),
  };
  const velvet = creator.remotes[1]!.listing.url;

  it('marks the page the user pointed at, not the whole creator', () => {
    const mark = seenMark(creator, velvet);
    expect(mark?.page).toBe(velvet);
    expect(mark?.at).toBe(Date.parse('2026-09-11T06:04:17Z'));
  });

  it('does not need yoursAt to do it', () => {
    // Requiring ownership here is what sent every one of this creator's marks creator-wide.
    expect(creator.remotes.every((r) => r.yoursAt === undefined)).toBe(true);
    expect(seenMark(creator, velvet)?.page).toBeDefined();
  });

  it('still marks creator-wide when no page was named', () => {
    const mark = seenMark(creator);
    expect(mark?.page).toBeUndefined();
    expect(mark?.at).toBe(Date.parse('2026-09-16T22:38:44Z'));
  });

  it('falls back to the creator when the page carries no date of its own', () => {
    // A Patreon creator page has no release date; returning nothing made the button do nothing.
    const noDate = { ...page('Creator page'), updatedAt: undefined } as RemoteInfo;
    const c = { remotes: [...creator.remotes, noDate], remoteUpdatedAt: creator.remoteUpdatedAt };
    const mark = seenMark(c, noDate.listing.url);
    expect(mark?.page).toBeUndefined();
    expect(mark?.at).toBe(Date.parse('2026-09-16T22:38:44Z'));
  });

  it('lets a later mark-all clear a page carrying an older mark of its own', () => {
    // The page moved on after it was marked, then everything was marked seen at a later date.
    const moved = { ...creator.remotes[1]!, updatedAt: Date.parse('2026-09-20T00:00:00Z'), seenAt: Date.parse('2026-09-11T06:04:17Z') };
    const markAll = Date.parse('2026-09-25T00:00:00Z');
    expect(outdatedRemotes([moved], 0, markAll)).toEqual([]);
    // Without the later creator-wide mark it is still genuinely behind.
    expect(outdatedRemotes([moved], 0).map((r) => r.title)).toEqual(['Velvet Dress']);
  });

  it('leaves the creator\u2019s other packs alone', () => {
    const marked = markSeenPages(creator.remotes, { [linkKey(velvet)]: Date.parse('2026-09-11T06:04:17Z') });
    expect(outdatedRemotes(marked, 0).map((r) => r.title)).toEqual(['Lace Slip', 'Sorbet Set']);
  });
});
