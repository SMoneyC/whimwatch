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
import { UPDATE_SITES } from '../shared/types.js';
import { creatorStatus, isNewer } from './compare.js';
import { type CreatorGroup, groupByCreator, matchName, normalizeName } from './creators.js';
import { BrowserUnavailableError, CancelledError, type Fetcher, throwIfCancelled, VerificationRequiredError } from './fetcher.js';
import { readGameInfo } from './game.js';
import { classifyRemotes, datePacks } from './ownership.js';
import { BUNDLED_OVERRIDES, type Overrides } from './overrides.js';
import { type ScanCache, scanDirs } from './scanner.js';
import { checkLoversLab } from './sources/loverslab.js';
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
    const offline = plan.muted.has('wickedcc');
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
      const { info, findings } = await checkListing(listing, opts.fetcher, now);
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

/** Copies the per-page "seen" dates onto the pages they belong to. */
export function markSeenPages(remotes: RemoteInfo[], seen: Record<string, number> | undefined): RemoteInfo[] {
  if (!seen || !Object.keys(seen).length) return remotes;
  return remotes.map((r) => {
    const at = seen[linkKey(r.listing.url)];
    return at === undefined ? r : { ...r, seenAt: at };
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

async function checkListing(
  listing: Listing,
  fetcher: Fetcher,
  now: () => number,
): Promise<{ info: RemoteInfo; findings?: SourceFindings }> {
  const checkedAt = now();
  if (listing.source === 'wwmod') return { info: { listing, checkedAt, status: 'error', error: 'Unsupported link' } };
  try {
    const { status, author: _author, patreonLinks, expandTo, ...rest } = await CHECKERS[listing.source](listing, fetcher);
    return { info: { listing, checkedAt, status: status ?? 'ok', ...rest }, findings: { patreonLinks, expandTo } };
  } catch (err) {
    if (err instanceof CancelledError) throw err;
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
