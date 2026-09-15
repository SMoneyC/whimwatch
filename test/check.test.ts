import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CORE_KEY, runCheck } from '../src/core/check.js';
import { creatorStatus, TOLERANCE_MS } from '../src/core/compare.js';
import type { Fetcher, HttpResponse } from '../src/core/fetcher.js';
import { SNIPPET_TUNING_TYPE } from '../src/core/scanner.js';
import { applyMutedSources, needsCheckAfterUnmute } from '../src/shared/muted.js';
import type { CheckResult, CreatorResult, RemoteInfo, UpdateSite } from '../src/shared/types.js';
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
}

const withDate = (html: string, iso: string): string => html.replaceAll('2026-08-28T12:04:47+00:00', iso);

const ROUTES = {
  'https://wickedwhimsmod.com/download': pages.WWMOD_DOWNLOAD,
  'https://wicked.cc/animations/azmodan22/sex-animations/': withDate(pages.WICKEDCC_PACK, '2024-12-20T00:00:00+00:00').replace(/https:\/\/www\.patreon\.com\/tester/, 'https://www.patreon.com/someone-else'),
  'https://www.loverslab.com/files/file/3528-azmodan22-animations/': pages.LOVERSLAB_FILE,
  'https://www.loverslab.com/files/file/8755-kikis-animations/': pages.CHALLENGE,
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
    await pkg('WW_Azmodan22.package', 'azmodan22', '2025-01-01');
    await pkg('WW_Tester.package', '!Tester', '2025-07-01');
    await pkg('WW_Kiki.package', 'Kiki Chain', '2025-09-16');
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
    expect(byName.azmodan22!.remotes.map((r) => [r.listing.source, r.status])).toEqual([
      ['wickedcc', 'ok'],
      ['loverslab', 'ok'],
    ]);
    expect(byName.azmodan22!.status).toBe('up-to-date');
    expect(byName.azmodan22!.remotes[1]!.version).toBe('2.6');

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
    expect(byName['Kiki Chain']!.status).toBe('needs-verification');

    expect(byName.Nobody!.status).toBe('unknown');
  });

  it('honours rejected links, manual links, dismissals and the discovery cache', async () => {
    const fetcher = new FakeFetcher(ROUTES);
    const { result } = await runCheck({
      dirs: [mods],
      fetcher,
      linkPrefs: {
        tester: { rejected: ['https://www.patreon.com/tester'], manual: [] },
        nobody: { rejected: [], manual: ['https://www.loverslab.com/files/file/3528-azmodan22-animations/'] },
      },
      dismissed: { tester: Date.parse('2026-08-28T12:04:47Z'), [CORE_KEY]: 0 },
      discoveryCache: { kikichain: { at: Date.now(), urls: [] } },
    });
    const byName = Object.fromEntries(result.creators.map((c) => [c.name, c]));
    expect(byName.Tester!.remotes.map((r) => r.listing.source)).toEqual(['wickedcc']);
    expect(byName.Tester!.status).toBe('up-to-date');
    expect(byName.Nobody!.remotes[0]!.listing.origin).toBe('manual');
    expect(fetcher.calls).not.toContain('https://wicked.cc/animations/kiki-chain/');
  });

  it('never contacts turned-off sites, and notes them on the creators that have pages there', async () => {
    const fetcher = new FakeFetcher(ROUTES);
    const { result } = await runCheck({ dirs: [mods], fetcher, mutedSources: ['loverslab', 'patreon'] });
    const byName = Object.fromEntries(result.creators.map((c) => [c.name, c]));
    expect(fetcher.calls.filter((u) => /loverslab\.com|patreon\.com/.test(u))).toEqual([]);

    expect(byName.azmodan22!.remotes.map((r) => r.listing.source)).toEqual(['wickedcc']);
    expect(byName.azmodan22!.mutedSources).toEqual(['loverslab']);
    // The pack page links a Patreon, which is only noted; the wicked.cc date alone decides.
    expect(byName.Tester!.remotes.map((r) => r.listing.source)).toEqual(['wickedcc']);
    expect(byName.Tester!.mutedSources).toEqual(['patreon']);
    expect(byName.Tester!.remoteUpdatedAt).toBe(Date.parse('2026-08-28T12:04:47Z'));
    expect(byName['Kiki Chain']).toMatchObject({ remotes: [], mutedSources: ['loverslab'], status: 'unknown' });
    expect(byName.Nobody!.mutedSources).toBeUndefined();
  });

  it('turns sites off for single creators, and matches removed Patreon pages in any address form', async () => {
    const fetcher = new FakeFetcher(ROUTES);
    const { result } = await runCheck({
      dirs: [mods],
      fetcher,
      linkPrefs: {
        azmodan22: { rejected: [], manual: [], mutedSources: ['loverslab'] },
        tester: { rejected: ['https://patreon.com/cw/Tester/'], manual: [] },
      },
    });
    const byName = Object.fromEntries(result.creators.map((c) => [c.name, c]));
    expect(fetcher.calls).not.toContain('https://www.loverslab.com/files/file/3528-azmodan22-animations/');
    expect(byName.azmodan22).toMatchObject({ mutedSources: ['loverslab'] });
    expect(byName.azmodan22!.remotes.map((r) => r.listing.source)).toEqual(['wickedcc']);
    // Another creator's LoversLab page is still checked.
    expect(fetcher.calls).toContain('https://www.loverslab.com/files/file/8755-kikis-animations/');
    // Removed as patreon.com/cw/Tester, found again as www.patreon.com/tester: still removed.
    expect(byName.Tester!.remotes.map((r) => r.listing.source)).toEqual(['wickedcc']);
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
    const kiki = result.creators.find((c) => c.name === 'Kiki Chain')!;
    expect(kiki.remotes[0]).toMatchObject({ status: 'error', error: 'LoversLab can only be checked from the desktop app' });
    expect(kiki.status).toBe('unknown');
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
