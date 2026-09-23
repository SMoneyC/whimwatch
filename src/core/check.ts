import { basename } from 'node:path';
import type {
  CheckProgress,
  CheckResult,
  CoreResult,
  CreatorResult,
  Listing,
  LocalFile,
  RemoteInfo,
  SourceId,
  UpdateSite,
} from '../shared/types.js';
import { applyMutedSources } from '../shared/muted.js';
import { UPDATE_SITES } from '../shared/types.js';
import { creatorStatus, isNewer, outdatedRemotes } from './compare.js';
import { type CreatorGroup, groupByCreator, matchName, normalizeName } from './creators.js';
import { BrowserUnavailableError, CancelledError, type Fetcher, isChallengePage, throwIfCancelled, VerificationRequiredError } from './fetcher.js';
import { readGameInfo } from './game.js';
import { classifyRemotes, datePacks } from './ownership.js';
import { datePageByFiles } from './pack-files.js';
import { BUNDLED_OVERRIDES, type Overrides } from './overrides.js';
import { type ScanCache, scanDirs } from './scanner.js';
import { checkLoversLab, parseDownloadChooser } from './sources/loverslab.js';
import { checkPatreon } from './sources/patreon.js';
import type { SourceChecker, SourceFindings } from './sources/types.js';
import { classifyUrl, linkKey, patreonVanity } from './sources/urls.js';
import { checkWickedCc, discoverWickedCc } from './sources/wickedcc.js';
import { type DirectoryEntry, fetchWwModPage, WWMOD_DOWNLOAD_URL, type WwModPage } from './sources/wwmod.js';

export const CORE_KEY = '__wickedwhims__';
const DISCOVERY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CREATOR_CONCURRENCY = 6;

export interface CreatorLinkPrefs {
  rejected: string[];
  manual: string[];
  /** Pages marked as seen on their own, by link key — see RemoteInfo.seenAt. */
  seen?: Record<string, number>;
  /** Sites not to check for this creator, on top of the ones turned off for everyone. */
  mutedSources?: UpdateSite[];
  /** Files on their pages the user said no thanks to (RemoteInfo.newFiles), by lower-case name. */
  ignoredFiles?: string[];
}

export type DiscoveryCache = Record<string, { at: number; urls: string[] }>;

export interface CheckOptions {
  dirs: string[];
  fetcher: Fetcher;
  overrides?: Overrides;
  scanCache?: ScanCache;
  linkPrefs?: Record<string, CreatorLinkPrefs>;
  dismissed?: Record<string, number>;
  discoveryCache?: DiscoveryCache;
  /** Sites not to contact. Their pages are only noted on the creator (see CreatorResult.mutedSources). */
  mutedSources?: UpdateSite[];
  /**
   * Asked again just before each page is fetched, so a site turned off while the check runs (for
   * everyone or for this creator) is never contacted from then on, not only from the next check.
   */
  isMuted?: (creatorKey: string, site: SourceId) => boolean;
  onProgress?: (progress: CheckProgress) => void;
  /** Called as each creator finishes, for incremental UI updates. */
  onCreator?: (creator: CreatorResult) => void;
  now?: () => number;
  /** Aborting stops the check with CancelledError; nothing partial is returned. */
  signal?: AbortSignal;
}

export interface CheckOutput {
  result: CheckResult;
  scanCache: ScanCache;
  discoveryCache: DiscoveryCache;
}

const CHECKERS: Record<Exclude<SourceId, 'wwmod'>, SourceChecker> = {
  wickedcc: checkWickedCc,
  loverslab: checkLoversLab,
  patreon: checkPatreon,
};

const SOURCE_ORDER: SourceId[] = ['wickedcc', 'loverslab', 'patreon'];

export async function runCheck(opts: CheckOptions): Promise<CheckOutput> {
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const progress = (phase: CheckProgress['phase'], done: number, total: number, message: string): void =>
    opts.onProgress?.({ phase, done, total, message });

  progress('scan', 0, 0, 'Scanning mods folders');
  const scan = await scanDirs(opts.dirs, {
    cache: opts.scanCache,
    onProgress: (done, total, path) => progress('scan', done, total, basename(path)),
  });

  throwIfCancelled(opts.signal);
  progress('directory', 0, 1, 'Reading the WickedWhims download page');
  let ww: WwModPage | undefined;
  let wwError: string | undefined;
  try {
    ww = await fetchWwModPage(opts.fetcher);
  } catch (err) {
    wwError = (err as Error).message;
  }

  const overrides = opts.overrides ?? BUNDLED_OVERRIDES;
  const groups = groupByCreator(scan.files, overrides.aliases);
  const plans = groups.map((group) => {
    const prefs = opts.linkPrefs?.[group.key] ?? { rejected: [], manual: [] };
    return {
      group,
      prefs,
      muted: new Set<SourceId>([...(opts.mutedSources ?? []), ...(prefs.mutedSources ?? [])]),
      listings: [] as Listing[],
      mutedFound: new Set<SourceId>(),
    };
  });
  const mutedNow = (plan: (typeof plans)[number], site: SourceId): boolean => {
    if (!opts.isMuted?.(plan.group.key, site)) return false;
    plan.mutedFound.add(site);
    return true;
  };
  const adder = (plan: (typeof plans)[number]): ((listing: Listing) => void) => listingAdder(plan.listings, plan.prefs, plan.muted, plan.mutedFound);
  for (const plan of plans) {
    const add = adder(plan);
    for (const entry of directoryEntriesFor(plan.group, ww?.directory ?? [])) entry.links.forEach(add);
    for (const url of overrides.creators[plan.group.key]?.links ?? []) addUrl(add, url, 'override');
    for (const url of plan.prefs.manual) addUrl(add, url, 'manual');
  }

  const discoveryCache: DiscoveryCache = { ...opts.discoveryCache };
  const needsDiscovery = plans.filter((p) => !p.listings.some((l) => l.source === 'wickedcc'));
  let discovered = 0;
  await mapLimit(needsDiscovery, CREATOR_CONCURRENCY, async (plan) => {
    throwIfCancelled(opts.signal);
    const key = plan.group.key;
    const cached = discoveryCache[key];
    // With wicked.cc off it isn't searched, but pages found earlier still show that it has this creator.
    // Only asked here: a page found in the cache is noted as not checked when it comes up below.
    const offline = plan.muted.has('wickedcc') || Boolean(opts.isMuted?.(key, 'wickedcc'));
    let urls = cached && (offline || now() - cached.at < DISCOVERY_TTL_MS) ? cached.urls : offline ? [] : undefined;
    if (!urls) {
      try {
        urls = (await discoverWickedCc(creatorNames(plan.group), opts.fetcher)).map((l) => l.url);
        discoveryCache[key] = { at: now(), urls };
      } catch (err) {
        if (err instanceof CancelledError) throw err;
        urls = [];
      }
    }
    const add = adder(plan);
    for (const url of urls) addUrl(add, url, 'discovered');
    progress('discover', ++discovered, needsDiscovery.length, plan.group.name);
  });

  let checked = 0;
  const totalListings = (): number => plans.reduce((n, p) => n + p.listings.length, 0);
  const creators = await mapLimit(plans, CREATOR_CONCURRENCY, async (plan) => {
    const remotes: RemoteInfo[] = [];
    const add = adder(plan);
    plan.listings.sort((a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source));
    // Listings can grow while iterating: pages link to the creator's Patreon.
    for (let i = 0; i < plan.listings.length; i++) {
      const listing = plan.listings[i]!;
      throwIfCancelled(opts.signal);
      if (mutedNow(plan, listing.source)) {
        progress('check', ++checked, totalListings(), `${plan.group.name}: ${listing.source}`);
        continue;
      }
      const { info, findings } = await checkListing(listing, opts.fetcher, now, opts.signal);
      if (findings?.expandTo?.length) {
        // An index page: check the packs it lists instead of the index itself.
        for (const url of findings.expandTo) addUrl(add, url, listing.origin);
      } else {
        remotes.push(info);
      }
      for (const link of findings?.patreonLinks ?? []) {
        if (vanityMatches(link, plan.group)) addUrl(add, link, 'discovered');
      }
      progress('check', ++checked, totalListings(), `${plan.group.name}: ${listing.source}`);
    }
    await datePagesByFiles(plan.group, remotes, opts);
    const creator = toCreatorResult(plan.group, remotes, opts.dismissed?.[plan.group.key], plan.prefs.seen);
    const mutedSources = UPDATE_SITES.filter((site) => plan.mutedFound.has(site));
    if (mutedSources.length) creator.mutedSources = mutedSources;
    opts.onCreator?.(creator);
    return creator;
  });

  const result: CheckResult = {
    startedAt,
    finishedAt: now(),
    dirs: opts.dirs,
    core: coreResult(scan.files, ww, wwError, opts.dismissed?.[CORE_KEY]),
    creators,
    unrecognizedCount: unrecognizedFiles(scan.files, groups).length,
    game: await readGameInfo(opts.dirs),
  };
  progress('done', 1, 1, 'Check complete');
  return { result, scanCache: scan.cache, discoveryCache };
}

export function unrecognizedFiles(files: LocalFile[], groups: CreatorGroup[]): LocalFile[] {
  const grouped = new Set(groups.flatMap((g) => g.files));
  return files.filter((f) => f.kind !== 'ww-core' && !grouped.has(f));
}

export function toCreatorResult(group: CreatorGroup, found: RemoteInfo[], dismissedAt?: number, seen?: Record<string, number>): CreatorResult {
  const localUpdatedAt = Math.max(...group.files.map((f) => f.mtimeMs));
  // Pages for packs the user doesn't have are marked here, where their files and pages are both in
  // hand, and are left out of the status by creatorStatus: a new pack is not an update.
  const remotes = markSeenPages(datePacks(group, classifyRemotes(group, found)), seen);
  const { status, remoteUpdatedAt, behindBy } = creatorStatus(localUpdatedAt, remotes, dismissedAt);
  return {
    key: group.key,
    name: group.name,
    files: group.files,
    localUpdatedAt,
    remotes,
    remoteUpdatedAt,
    behindBy,
    status,
    dismissedAt,
  };
}

/** What the user has chosen for one creator, as it stands now. */
export interface CreatorChoices {
  rejected: readonly string[];
  /** Sites turned off for every creator. */
  mutedSources: readonly UpdateSite[];
  /** Sites turned off for this creator only. */
  creatorMuted: readonly UpdateSite[];
  seen?: Record<string, number>;
  dismissedAt?: number;
}

/**
 * Brings a creator the running check has just finished up to date with what the user chose while it
 * ran: the check planned the creator with the choices from when it started. Returns the pages taken
 * out as removed, so an Undo still waiting in a toast can put them back.
 */
export function catchUpCreator(creator: CreatorResult, choices: CreatorChoices): RemoteInfo[] {
  const rejected = new Set(choices.rejected.map(linkKey));
  const isRejected = (r: RemoteInfo): boolean => rejected.has(linkKey(r.listing.url));
  const removed = creator.remotes.filter(isRejected);
  creator.remotes = creator.remotes.filter((r) => !isRejected(r));
  applyMutedSources({ creators: [creator] }, choices.mutedSources, { [creator.key]: choices.creatorMuted });
  refreshCreatorStatus(creator, choices.seen, choices.dismissedAt);
  return removed;
}

/** Re-derives a creator's status from its pages and the current "seen" marks, without a new check. */
export function refreshCreatorStatus(creator: CreatorResult, seen: Record<string, number> | undefined, dismissedAt: number | undefined): void {
  // Marking one page as seen changes only that page, so re-apply them before comparing.
  creator.remotes = markSeenPages(creator.remotes, seen);
  const { status, remoteUpdatedAt, behindBy } = creatorStatus(creator.localUpdatedAt, creator.remotes, dismissedAt);
  Object.assign(creator, { status, remoteUpdatedAt, behindBy, dismissedAt });
}

/**
 * Copies the per-page "seen" dates onto the pages they belong to, and takes them off pages whose mark
 * is gone: an undone mark left in place kept the page hidden until the next check.
 */
export function markSeenPages(remotes: RemoteInfo[], seen: Record<string, number> | undefined): RemoteInfo[] {
  return remotes.map((r) => {
    const at = seen?.[linkKey(r.listing.url)];
    if (at === r.seenAt) return r;
    if (at !== undefined) return { ...r, seenAt: at };
    const { seenAt: _undone, ...page } = r;
    return page;
  });
}

export function coreResult(files: LocalFile[], ww: WwModPage | undefined, error: string | undefined, dismissedAt?: number): CoreResult {
  const installed =
    files.find((f) => f.kind === 'ww-core' && /\.ts4script$/i.test(f.path)) ?? files.find((f) => f.kind === 'ww-core');
  const status =
    !installed || ww?.releasedAt === undefined
      ? 'unknown'
      : isNewer(ww.releasedAt, installed.mtimeMs, dismissedAt)
        ? 'update-available'
        : 'up-to-date';
  return {
    installed,
    installedFiles: files.filter((f) => f.kind === 'ww-core'),
    latestVersion: ww?.version,
    releasedAt: ww?.releasedAt,
    gameVersions: ww?.gameVersions,
    supportedGameVersions: ww?.supportedGameVersions,
    downloadPageUrl: ww?.coreLinks.find((u) => u.includes('wicked.cc')) ?? WWMOD_DOWNLOAD_URL,
    status,
    error,
  };
}

/**
 * Re-dates the creator's LoversLab pages that look newer than their files by the pages' own file
 * lists (see pack-files.ts). One extra request per such page, and only where the page's download
 * button opens that list: on a single-file entry it is the download itself. It is asked again on
 * every check while the page's own date is newer than the user's files, since that date is what
 * makes the page look behind; nothing is cached across checks.
 */
async function datePagesByFiles(group: CreatorGroup, remotes: RemoteInfo[], opts: CheckOptions): Promise<void> {
  const probe = opts.fetcher.browserProbe;
  if (!probe) return;
  const draft = toCreatorResult(group, remotes, opts.dismissed?.[group.key], opts.linkPrefs?.[group.key]?.seen);
  const behind = outdatedRemotes(draft.remotes, draft.localUpdatedAt, draft.dismissedAt).filter((r) => r.listing.source === 'loverslab' && r.chooserUrl);
  for (const page of behind) {
    throwIfCancelled(opts.signal);
    if (opts.isMuted?.(group.key, 'loverslab')) return;
    try {
      const res = await probe(page.listing.url, page.chooserUrl!);
      if (res.status !== 200 || !res.body || isChallengePage(res.body)) continue;
      const at = remotes.findIndex((r) => r.listing.url === page.listing.url);
      if (at >= 0) remotes[at] = datePageByFiles(remotes[at]!, parseDownloadChooser(res.body, page.chooserUrl!), group.files);
    } catch (err) {
      // Only the user's Cancel stops the check; anything else leaves the page's own date in place.
      if (err instanceof CancelledError && (!opts.signal || opts.signal.aborted)) throw err;
    }
  }
}

async function checkListing(
  listing: Listing,
  fetcher: Fetcher,
  now: () => number,
  signal?: AbortSignal,
): Promise<{ info: RemoteInfo; findings?: SourceFindings }> {
  const checkedAt = now();
  if (listing.source === 'wwmod') return { info: { listing, checkedAt, status: 'error', error: 'Unsupported link' } };
  try {
    const { status, author: _author, patreonLinks, expandTo, ...rest } = await CHECKERS[listing.source](listing, fetcher);
    return { info: { listing, checkedAt, status: status ?? 'ok', ...rest }, findings: { patreonLinks, expandTo } };
  } catch (err) {
    if (err instanceof CancelledError) {
      // Only the user's Cancel stops the check. A page cut off from outside it (signing out, or
      // clearing browsing data, closes the site's window) is that page's problem: failing the whole
      // check for it reported "Check failed: Cancelled" to someone who never pressed Cancel.
      // The check then carries on, so a site signed out of or cleared mid-check gets fresh cookies
      // from its next page: the check the user started still wants that site. Quitting cancels the
      // check first, so its clean-up on exit is never followed by more pages.
      if (!signal || signal.aborted) throw err;
      return { info: { listing, checkedAt, status: 'error', error: 'Interrupted by signing out or clearing browsing data. Checked again next time.' } };
    }
    if (err instanceof VerificationRequiredError) {
      return { info: { listing, checkedAt, status: 'needs-verification', error: err.message } };
    }
    const message = err instanceof BrowserUnavailableError ? err.message : `Check failed: ${(err as Error).message}`;
    return { info: { listing, checkedAt, status: 'error', error: message } };
  }
}

/**
 * Directory entries for a creator. Animation packs use the "Animators"
 * sections only, so an animator's props or clothing pages don't count as
 * updates to their animations; CAS packages use the other sections.
 */
function directoryEntriesFor(group: CreatorGroup, directory: DirectoryEntry[]): DirectoryEntry[] {
  const match = matchName(group.key, directory);
  if (!match) return [];
  const key = normalizeName(match.name);
  const entries = directory.filter((e) => normalizeName(e.name) === key);
  const animation = group.files.some((f) => f.kind === 'ww-animation');
  const relevant = entries.filter((e) => /animator/i.test(e.section) === animation);
  return relevant.length ? relevant : entries;
}

function creatorNames(group: CreatorGroup): string[] {
  const names = new Set([group.name]);
  for (const f of group.files) for (const a of Object.keys(f.authors)) names.add(a);
  return [...names];
}

function vanityMatches(url: string, group: CreatorGroup): boolean {
  const vanity = patreonVanity(url);
  if (!vanity) return false;
  const v = normalizeName(vanity);
  return creatorNames(group).some((name) => {
    const n = normalizeName(name);
    const [short, long] = v.length <= n.length ? [v, n] : [n, v];
    return short.length >= 4 && long.startsWith(short);
  });
}

export function listingKey(listing: Listing): string {
  return linkKey(listing.url);
}

function listingAdder(listings: Listing[], prefs: CreatorLinkPrefs, muted: Set<SourceId>, mutedFound: Set<SourceId>): (listing: Listing) => void {
  const rejected = new Set(prefs.rejected.map(linkKey));
  return (listing) => {
    if (rejected.has(linkKey(listing.url))) return;
    if (muted.has(listing.source)) {
      mutedFound.add(listing.source);
      return;
    }
    const key = listingKey(listing);
    if (!listings.some((l) => listingKey(l) === key)) listings.push(listing);
  };
}

function addUrl(add: (l: Listing) => void, url: string, origin: Listing['origin']): void {
  const source = classifyUrl(url);
  if (source && source !== 'wwmod') add({ source, url, origin });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]!);
      }
    }),
  );
  return results;
}
