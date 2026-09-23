import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catchUpCreator, CORE_KEY, refreshCreatorStatus, runCheck } from '../src/core/check.js';
import { creatorStatus, TOLERANCE_MS } from '../src/core/compare.js';
import { CancelledError, type Fetcher, type HttpResponse } from '../src/core/fetcher.js';
import { SNIPPET_TUNING_TYPE } from '../src/core/scanner.js';
import { linkKey } from '../src/core/sources/urls.js';
import { applyMutedSources, needsCheckAfterUnmute } from '../src/shared/muted.js';
import { type CheckResult, type CreatorResult, type RemoteInfo, UPDATE_SITES, type UpdateSite } from '../src/shared/types.js';
import { buildDbpf, wwTuningXml } from './helpers/dbpf-builder.js';
import * as pages from './fixtures/pages.js';

class FakeFetcher implements Fetcher {
  calls: string[] = [];
  constructor(private routes: Record<string, string | { status: number; body?: string }>, private withBrowser = true) {}

  private respond(url: string): HttpResponse {
    this.calls.push(url);
    const route = this.routes[url] ?? this.routes[url.replace(/\/$/, '')] ?? this.routes[`${url}/`];
    if (route === undefined) return { status: 404, url, body: 'not found', headers: {} };
    const { status, body } = typeof route === 'string' ? { status: 200, body: route } : { body: '', ...route };
    return { status, url, body, headers: {} };
  }

  get = async (url: string) => this.respond(url);
  head = async (url: string) => ({ ...this.respond(url), body: '' });
  browserGet = async (url: string) => {
    if (!this.withBrowser) throw new Error('no browser');
    return this.respond(url);
  };
  browserFetch = async (_page: string, api: string) => {
    const res = this.respond(api);
    return { status: res.status, body: res.body };
  };
  browserProbe = async (_page: string, url: string) => {
    const res = this.respond(url);
    return { status: res.status, type: 'text/html', body: res.body };
  };
}

const withDate = (html: string, iso: string): string => html.replaceAll('2026-08-28T12:04:47+00:00', iso);

const ROUTES = {
  'https://wickedwhimsmod.com/download': pages.WWMOD_DOWNLOAD,
  'https://wicked.cc/animations/moonberry/sex-animations/': withDate(pages.WICKEDCC_PACK, '2024-12-20T00:00:00+00:00').replace(/https:\/\/www\.patreon\.com\/tester/, 'https://www.patreon.com/someone-else'),
  'https://www.loverslab.com/files/file/3528-moonberry-animations/': pages.LOVERSLAB_FILE,
  'https://www.loverslab.com/files/file/8755-willows-animations/': pages.CHALLENGE,
  'https://wicked.cc/animations/tester/': pages.WICKEDCC_CREATOR_INDEX,
  'https://wicked.cc/animations/tester/testers-animations': pages.WICKEDCC_PACK,
  'https://www.patreon.com/tester': pages.PATREON_PAGE,
  [`https://www.patreon.com/api/posts?${new URLSearchParams({
    'filter[campaign_id]': '10577235',
    'filter[contains_exclusive_posts]': 'true',
    sort: '-published_at',
    'page[count]': '10',
    'fields[post]': 'title,published_at,current_user_can_view,url,post_type',
  })}`]: pages.PATREON_POSTS,
};

describe('runCheck', () => {
  let mods: string;

  const pkg = async (name: string, author: string, date: string, cls?: string): Promise<void> => {
    const path = join(mods, name);
    await writeFile(path, buildDbpf([{ type: SNIPPET_TUNING_TYPE, data: wwTuningXml({ authors: [author], cls }) }]));
    await utimes(path, new Date(date), new Date(date));
  };

  beforeAll(async () => {
    mods = await mkdtemp(join(tmpdir(), 'whimwatch-check-'));
    await pkg('WW_Moonberry.package', 'moonberry', '2025-01-01');
    await pkg('WW_Tester.package', '!Tester', '2025-07-01');
    await pkg('WW_Willow.package', 'Willow Bank', '2025-09-16');
    await pkg('Unlisted.package', 'Nobody', '2025-01-01');
    const core = join(mods, 'TURBODRIVER_WickedWhims_Scripts.ts4script');
    await writeFile(core, 'zip');
    await utimes(core, new Date('2026-05-23T17:13:00Z'), new Date('2026-05-23T17:13:00Z'));
  });
  afterAll(() => rm(mods, { recursive: true, force: true }));

  it('discovers links, checks sources and computes statuses', async () => {
    const fetcher = new FakeFetcher(ROUTES);
    const { result, discoveryCache } = await runCheck({ dirs: [mods], fetcher });
    const byName = Object.fromEntries(result.creators.map((c) => [c.name, c]));

    expect(result.core).toMatchObject({ latestVersion: '185k', status: 'up-to-date', gameVersions: '1.127.41 (August 25)' });

    // Animator-section links only: the "Bondage Devices" box is ignored for animation packs.
    expect(byName.moonberry!.remotes.map((r) => [r.listing.source, r.status])).toEqual([
      ['wickedcc', 'ok'],
      ['loverslab', 'ok'],
    ]);
    expect(byName.moonberry!.status).toBe('up-to-date');
    expect(byName.moonberry!.remotes[1]!.version).toBe('2.6');

    // Not in the directory: found via wicked.cc creator index, then Patreon via the pack page.
    const tester = byName.Tester!;
    expect(tester.remotes.map((r) => [r.listing.source, r.listing.origin])).toEqual([
      ['wickedcc', 'discovered'],
      ['patreon', 'discovered'],
    ]);
    expect(tester.status).toBe('update-available');
    expect(tester.remoteUpdatedAt).toBe(Date.parse('2026-09-05T15:58:19Z'));
    expect(tester.remotes[1]).toMatchObject({ locked: true, title: 'August Animations [Turn Me On]' });
    expect(discoveryCache.tester?.urls).toEqual(['https://wicked.cc/animations/tester/testers-animations']);

    // Directory match on a multi-word name; its only link is blocked by a challenge.
    expect(byName['Willow Bank']!.status).toBe('needs-verification');

    expect(byName.Nobody!.status).toBe('unknown');
  });

  it('honours rejected links, manual links, dismissals and the discovery cache', async () => {
    const fetcher = new FakeFetcher(ROUTES);
    const { result } = await runCheck({
      dirs: [mods],
      fetcher,
      linkPrefs: {
        tester: { rejected: ['https://www.patreon.com/tester'], manual: [] },
        nobody: { rejected: [], manual: ['https://www.loverslab.com/files/file/3528-moonberry-animations/'] },
      },
      dismissed: { tester: Date.parse('2026-08-28T12:04:47Z'), [CORE_KEY]: 0 },
      discoveryCache: { willowbank: { at: Date.now(), urls: [] } },
    });
    const byName = Object.fromEntries(result.creators.map((c) => [c.name, c]));
    expect(byName.Tester!.remotes.map((r) => r.listing.source)).toEqual(['wickedcc']);
    expect(byName.Tester!.status).toBe('up-to-date');
    expect(byName.Nobody!.remotes[0]!.listing.origin).toBe('manual');
    expect(fetcher.calls).not.toContain('https://wicked.cc/animations/willow-chain/');
  });

  it('never contacts turned-off sites, and notes them on the creators that have pages there', async () => {
    const fetcher = new FakeFetcher(ROUTES);
    const { result } = await runCheck({ dirs: [mods], fetcher, mutedSources: ['loverslab', 'patreon'] });
    const byName = Object.fromEntries(result.creators.map((c) => [c.name, c]));
    expect(fetcher.calls.filter((u) => /loverslab\.com|patreon\.com/.test(u))).toEqual([]);

    expect(byName.moonberry!.remotes.map((r) => r.listing.source)).toEqual(['wickedcc']);
    expect(byName.moonberry!.mutedSources).toEqual(['loverslab']);
    // The pack page links a Patreon, which is only noted; the wicked.cc date alone decides.
    expect(byName.Tester!.remotes.map((r) => r.listing.source)).toEqual(['wickedcc']);
    expect(byName.Tester!.mutedSources).toEqual(['patreon']);
    expect(byName.Tester!.remoteUpdatedAt).toBe(Date.parse('2026-08-28T12:04:47Z'));
    expect(byName['Willow Bank']).toMatchObject({ remotes: [], mutedSources: ['loverslab'], status: 'unknown' });
    expect(byName.Nobody!.mutedSources).toBeUndefined();
  });

  it('turns sites off for single creators, and matches removed Patreon pages in any address form', async () => {
    const fetcher = new FakeFetcher(ROUTES);
    const { result } = await runCheck({
      dirs: [mods],
      fetcher,
      linkPrefs: {
        moonberry: { rejected: [], manual: [], mutedSources: ['loverslab'] },
        tester: { rejected: ['https://patreon.com/cw/Tester/'], manual: [] },
      },
    });
    const byName = Object.fromEntries(result.creators.map((c) => [c.name, c]));
    expect(fetcher.calls).not.toContain('https://www.loverslab.com/files/file/3528-moonberry-animations/');
    expect(byName.moonberry).toMatchObject({ mutedSources: ['loverslab'] });
    expect(byName.moonberry!.remotes.map((r) => r.listing.source)).toEqual(['wickedcc']);
    // Another creator's LoversLab page is still checked.
    expect(fetcher.calls).toContain('https://www.loverslab.com/files/file/8755-willows-animations/');
    // Removed as patreon.com/cw/Tester, found again as www.patreon.com/tester: still removed.
    expect(byName.Tester!.remotes.map((r) => r.listing.source)).toEqual(['wickedcc']);
  });

  it('never contacts a site turned off while the check runs, from then on', async () => {
    const fetcher = new FakeFetcher(ROUTES);
    const off = new Set<string>();
    const { result } = await runCheck({
      dirs: [mods],
      fetcher,
      isMuted: (key, site) => off.has(`${key}:${site}`),
      // Tester's Patreon is only found on their wicked.cc page, so it's turned off before it comes up.
      onProgress: (p) => {
        if (p.message === 'Tester: wickedcc') off.add('tester:patreon');
      },
    });
    const tester = result.creators.find((c) => c.name === 'Tester')!;
    expect(fetcher.calls.filter((u) => u.includes('patreon.com'))).toEqual([]);
    expect(tester.remotes.map((r) => r.listing.source)).toEqual(['wickedcc']);
    // Noted, so turning it back on says it's checked from the next check.
    expect(tester.mutedSources).toEqual(['patreon']);
    expect(result.creators.find((c) => c.name === 'moonberry')!.mutedSources).toBeUndefined();
  });

  it('with wicked.cc turned off during the check, skips the search and notes only creators with a page there', async () => {
    const fetcher = new FakeFetcher(ROUTES);
    const { result } = await runCheck({
      dirs: [mods],
      fetcher,
      isMuted: (_key, site) => site === 'wickedcc',
      discoveryCache: { tester: { at: 0, urls: ['https://wicked.cc/animations/tester/testers-animations'] } },
    });
    expect(fetcher.calls.filter((u) => u.includes('wicked.cc'))).toEqual([]);
    expect(result.creators.find((c) => c.name === 'Tester')).toMatchObject({ remotes: [], mutedSources: ['wickedcc'] });
    expect(result.creators.find((c) => c.name === 'Nobody')!.mutedSources).toBeUndefined();
  });

  it("keeps going when a page's window is closed under it, and stops only for Cancel", async () => {
    const lab = 'https://www.loverslab.com/files/file/3528-moonberry-animations/';
    const cutOff = (fetcher: FakeFetcher, onCut?: () => void): FakeFetcher => {
      const load = fetcher.browserGet;
      fetcher.browserGet = async (url: string) => {
        if (url !== lab) return load(url);
        onCut?.();
        // What the pool throws when the site's window is destroyed mid-load (signing out).
        throw new CancelledError();
      };
      return fetcher;
    };

    const { result } = await runCheck({ dirs: [mods], fetcher: cutOff(new FakeFetcher(ROUTES)), signal: new AbortController().signal });
    const moonberry = result.creators.find((c) => c.key === 'moonberry')!;
    expect(moonberry.remotes.find((r) => r.listing.url === lab)).toMatchObject({ status: 'error' });
    expect(moonberry.remotes.find((r) => r.listing.source === 'wickedcc')).toMatchObject({ status: 'ok' });

    // The user's Cancel: the same error, with the check's own signal aborted.
    const abort = new AbortController();
    await expect(runCheck({ dirs: [mods], fetcher: cutOff(new FakeFetcher(ROUTES), () => abort.abort()), signal: abort.signal })).rejects.toBeInstanceOf(CancelledError);
  });

  it('dates a LoversLab page by its files, and keeps a new pack on it apart from theirs', async () => {
    const lab = 'https://www.loverslab.com/files/file/3528-moonberry-animations/';
    const chooser = `${lab}?do=download`;
    // The entry was edited on Sep 18; their pack's own file is older than their copy (2025-01-01), and
    // the only newer file is a pack they don't have.
    const edited = (page: string): string => page.replace('2024-04-10T21:52:40+0000', '2026-09-18T11:16:48+0000');
    const routes = {
      ...ROUTES,
      [lab]: edited(pages.LOVERSLAB_FILE_SEVERAL),
      [chooser]: pages.LOVERSLAB_CHOOSER_DATED.replace('WW_Moonberry_Animations.package', 'WW_Moonberry.package').replace('2026-07-30T13:30:28Z', '2024-12-01T10:00:00Z'),
    };
    const fetcher = new FakeFetcher(routes);
    const { result } = await runCheck({ dirs: [mods], fetcher });
    const moonberry = result.creators.find((c) => c.key === 'moonberry')!;
    expect(moonberry.status).toBe('up-to-date');
    expect(moonberry.remotes.find((r) => r.listing.url === lab)).toMatchObject({
      updatedAt: Date.parse('2024-12-01T10:00:00Z'),
      newFiles: [{ name: 'WW_Moonberry_Juniper_Petal.package', updatedAt: Date.parse('2026-09-11T11:55:39Z') }],
    });
    // The list was read once, and no file was ever asked for.
    expect(fetcher.calls.filter((u) => u === chooser)).toHaveLength(1);
    expect(fetcher.calls.filter((u) => /[?&]r=/.test(u))).toEqual([]);

    // A single-file entry's button is the download: never followed, and the page keeps its date.
    const single = new FakeFetcher({ ...routes, [lab]: edited(pages.LOVERSLAB_FILE_SINGLE) });
    const { result: plain } = await runCheck({ dirs: [mods], fetcher: single });
    expect(plain.creators.find((c) => c.key === 'moonberry')!.status).toBe('update-available');
    expect(single.calls.filter((u) => u.includes('do=download'))).toEqual([]);
  });

  it('with wicked.cc off, uses pages found earlier without searching it again', async () => {
    const fetcher = new FakeFetcher(ROUTES);
    const { result, discoveryCache } = await runCheck({
      dirs: [mods],
      fetcher,
      mutedSources: ['wickedcc'],
      discoveryCache: { tester: { at: 0, urls: ['https://wicked.cc/animations/tester/testers-animations'] } },
    });
    expect(fetcher.calls.filter((u) => u.includes('wicked.cc'))).toEqual([]);
    expect(result.creators.find((c) => c.name === 'Tester')).toMatchObject({ remotes: [], mutedSources: ['wickedcc'] });
    expect(discoveryCache.tester?.at).toBe(0);
  });

  it('reports browser-only sources as errors without a browser', async () => {
    const fetcher = new FakeFetcher(ROUTES);
    const { result } = await runCheck({ dirs: [mods], fetcher: { get: fetcher.get, head: fetcher.head } });
    const willow = result.creators.find((c) => c.name === 'Willow Bank')!;
    expect(willow.remotes[0]).toMatchObject({ status: 'error', error: 'LoversLab can only be checked from the desktop app' });
    expect(willow.status).toBe('unknown');
  });
});

describe('creatorStatus', () => {
  const remote = (updatedAt: number, status: RemoteInfo['status'] = 'ok'): RemoteInfo => ({
    listing: { source: 'wickedcc', url: 'https://wicked.cc/x', origin: 'directory' },
    checkedAt: 0,
    status,
    updatedAt,
  });
  const local = Date.UTC(2026, 0, 10);

  it('flags newer remotes beyond the tolerance', () => {
    expect(creatorStatus(local, [remote(local + TOLERANCE_MS + 1)]).status).toBe('update-available');
    expect(creatorStatus(local, [remote(local + TOLERANCE_MS - 1)]).status).toBe('up-to-date');
  });

  it('uses the newest successful remote', () => {
    const r = creatorStatus(local, [remote(local - 1000), remote(local + 10 * TOLERANCE_MS, 'error')]);
    expect(r).toEqual({ status: 'up-to-date', remoteUpdatedAt: local - 1000 });
  });

  it('respects dismissals until something newer appears', () => {
    const newer = local + 5 * TOLERANCE_MS;
    expect(creatorStatus(local, [remote(newer)], newer).status).toBe('up-to-date');
    expect(creatorStatus(local, [remote(newer + TOLERANCE_MS)], newer).status).toBe('update-available');
  });

  it('distinguishes verification from unknown', () => {
    expect(creatorStatus(local, [remote(0, 'needs-verification')]).status).toBe('needs-verification');
    expect(creatorStatus(local, []).status).toBe('unknown');
  });
});

describe('catching up a creator the check just finished', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const local = Date.UTC(2026, 8, 1);
  const page = (source: UpdateSite, slug: string, updatedAt = local + 10 * DAY): RemoteInfo => ({
    listing: { source, url: `https://${source}.test/${slug}`, origin: 'directory' },
    checkedAt: 0,
    status: 'ok',
    updatedAt,
  });
  // As the check hands it over: built with the choices from when the check started.
  const finished = (): CreatorResult => {
    const remotes = [page('wickedcc', 'juniper-petal', local - DAY), page('patreon', 'thornwood')];
    return { key: 'amberlily', name: 'Amberlily', files: [], localUpdatedAt: local, remotes, ...creatorStatus(local, remotes) };
  };
  const none = { rejected: [], mutedSources: [], creatorMuted: [] };

  it('starts out behind, as the check left it', () => {
    expect(finished().status).toBe('update-available');
  });

  it('leaves out a page removed meanwhile, and hands it back for Undo', () => {
    const c = finished();
    const removed = catchUpCreator(c, { ...none, rejected: ['https://patreon.test/thornwood/'] });
    expect(removed.map((r) => r.listing.url)).toEqual(['https://patreon.test/thornwood']);
    expect(c.remotes.map((r) => r.listing.source)).toEqual(['wickedcc']);
    expect(c.status).toBe('up-to-date');
  });

  it('sets aside a site turned off meanwhile, for that creator or everyone', () => {
    for (const choices of [{ ...none, creatorMuted: ['patreon' as const] }, { ...none, mutedSources: ['patreon' as const] }]) {
      const c = finished();
      catchUpCreator(c, choices);
      expect(c).toMatchObject({ mutedSources: ['patreon'], status: 'up-to-date' });
      expect(c.mutedRemotes!.map((r) => r.listing.source)).toEqual(['patreon']);
    }
  });

  it('keeps a page marked as seen meanwhile hidden, even with no link choices when the check started', () => {
    const c = finished();
    catchUpCreator(c, { ...none, seen: { [linkKey('https://patreon.test/thornwood')]: local + 10 * DAY } });
    expect(c.status).toBe('up-to-date');
    expect(c.remotes.find((r) => r.listing.source === 'patreon')!.seenAt).toBe(local + 10 * DAY);
  });

  it('shows a page again once its mark is undone, one page or all of them', () => {
    const key = linkKey('https://patreon.test/thornwood');
    for (const after of [{ [linkKey('https://wicked.cc.test/other')]: 1 }, {}, undefined]) {
      const c = finished();
      refreshCreatorStatus(c, { [key]: local + 10 * DAY }, undefined);
      expect(c.status).toBe('up-to-date');
      // History's Undo removes that page's mark; the row's "Undo mark as seen" removes them all.
      refreshCreatorStatus(c, after, undefined);
      expect(c.status).toBe('update-available');
      expect(c.remotes.every((r) => r.seenAt === undefined)).toBe(true);
    }
  });

  it('keeps a creator-wide mark made meanwhile', () => {
    const c = finished();
    catchUpCreator(c, { ...none, dismissedAt: local + 10 * DAY });
    expect(c).toMatchObject({ status: 'up-to-date', dismissedAt: local + 10 * DAY });
  });
});

describe('turning sites off and on between checks', () => {
  const remote = (source: UpdateSite): RemoteInfo => ({ listing: { source, url: `https://${source}.test/`, origin: 'directory' }, checkedAt: 0, status: 'ok', updatedAt: 1 });
  const result = (creators: Partial<CreatorResult>[]): CheckResult =>
    ({ creators: creators.map((c, i) => ({ key: `c${i}`, name: `C${i}`, files: [], localUpdatedAt: 0, status: 'unknown', remotes: [], ...c })) }) as CheckResult;

  it('sets results aside and brings them back in site order', () => {
    const r = result([{ remotes: [remote('wickedcc'), remote('loverslab'), remote('patreon')] }]);
    applyMutedSources(r, ['loverslab', 'patreon']);
    expect(r.creators[0]).toMatchObject({ remotes: [remote('wickedcc')], mutedSources: ['loverslab', 'patreon'], mutedRemotes: [remote('loverslab'), remote('patreon')] });
    expect(needsCheckAfterUnmute(r.creators, 'patreon')).toBe(false);

    applyMutedSources(r, []);
    expect(r.creators[0]!.remotes.map((x) => x.listing.source)).toEqual(['wickedcc', 'loverslab', 'patreon']);
    expect(r.creators[0]!.mutedSources).toBeUndefined();
    expect(r.creators[0]!.mutedRemotes).toBeUndefined();
  });

  it('notes every site turned off, even for a creator with no pages anywhere', () => {
    const r = result([{ remotes: [] }, { remotes: [remote('wickedcc')] }]);
    applyMutedSources(r, [], { c0: [...UPDATE_SITES] });
    expect(r.creators[0]).toMatchObject({ allSitesOff: true, remotes: [] });
    // Nothing had a page, so nothing is listed as set aside.
    expect(r.creators[0]!.mutedSources).toBeUndefined();
    expect(r.creators[1]!.allSitesOff).toBeUndefined();

    applyMutedSources(r, ['wickedcc', 'loverslab', 'patreon']);
    expect(r.creators.every((c) => c.allSitesOff)).toBe(true);
    // Turning one back on for everyone clears it where that site isn't also off just for them.
    applyMutedSources(r, ['loverslab', 'patreon'], { c0: [...UPDATE_SITES] });
    expect(r.creators.map((c) => c.allSitesOff)).toEqual([true, undefined]);
  });

  it('knows when a site was already off during the check, so turning it on needs a new one', () => {
    const r = result([{ mutedSources: ['patreon'] }, { remotes: [remote('wickedcc')] }]);
    expect(needsCheckAfterUnmute(r.creators, 'patreon')).toBe(true);
    expect(needsCheckAfterUnmute(r.creators, 'loverslab')).toBe(false);
    applyMutedSources(r, []);
    expect(r.creators[0]).toMatchObject({ remotes: [] });
    expect(r.creators[0]!.mutedSources).toBeUndefined();
  });

  it('turns a site off for one creator without touching the others', () => {
    const r = result([{ remotes: [remote('wickedcc'), remote('patreon')] }, { remotes: [remote('patreon')] }]);
    applyMutedSources(r, [], { c0: ['patreon'] });
    expect(r.creators[0]).toMatchObject({ remotes: [remote('wickedcc')], mutedSources: ['patreon'] });
    expect(r.creators[1]).toMatchObject({ remotes: [remote('patreon')] });
    expect(r.creators[1]!.mutedSources).toBeUndefined();

    // Off for everyone as well: turning it back on for everyone still leaves it off for c0.
    applyMutedSources(r, ['patreon'], { c0: ['patreon'] });
    applyMutedSources(r, [], { c0: ['patreon'] });
    expect(r.creators[0]!.remotes).toEqual([remote('wickedcc')]);
    expect(r.creators[1]!.remotes).toEqual([remote('patreon')]);
  });
});
