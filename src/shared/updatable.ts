import { formatShortDate } from './dates.js';
import { SOURCE_LABEL } from './labels.js';
import type { RemoteInfo, SourceId } from './types.js';

/**
 * The source an update would be downloaded from: the newest successful
 * listing that offers a download the user can access (wicked.cc always;
 * LoversLab/Patreon only when signed in).
 */
export function updatableRemote(remotes: RemoteInfo[], signedIn: (site: 'loverslab' | 'patreon') => boolean): RemoteInfo | undefined {
  return updatableRemotes(remotes, signedIn)[0];
}

/** Every source the update could be downloaded from right now, best first (see rankRemotes). */
export function updatableRemotes(remotes: RemoteInfo[], signedIn: (site: 'loverslab' | 'patreon') => boolean): RemoteInfo[] {
  return rankRemotes(remotes
    .filter(
      (r) =>
        r.status === 'ok' &&
        r.downloadUrl !== undefined &&
        (r.listing.source === 'wickedcc' ||
          (r.listing.source === 'loverslab' && signedIn('loverslab')) ||
          (r.listing.source === 'patreon' && signedIn('patreon') && !r.locked)),
    ));
}

const DAY_MS = 24 * 60 * 60 * 1000;
const day = (t?: number): number => (t === undefined ? -1 : Math.floor(t / DAY_MS));

/** Sources updated on the same calendar day (UTC) as `a`. */
export function sameDay(a: RemoteInfo, b: RemoteInfo): boolean {
  return day(a.updatedAt) === day(b.updatedAt);
}

/**
 * Sites updated more than a day after the listing at `listingUrl`, newest first, one entry per site.
 * When that listing's download matches the installed files, these are why the creator still shows
 * an update.
 */
export function laterSources(remotes: RemoteInfo[], listingUrl: string): RemoteInfo[] {
  const checked = remotes.find((r) => r.listing.url === listingUrl)?.updatedAt;
  if (checked === undefined) return [];
  const newest = new Map<SourceId, RemoteInfo & { updatedAt: number }>();
  for (const r of remotes) {
    if (r.status !== 'ok' || r.updatedAt === undefined || r.updatedAt <= checked + DAY_MS) continue;
    const kept = newest.get(r.listing.source);
    if (!kept || r.updatedAt > kept.updatedAt) newest.set(r.listing.source, { ...r, updatedAt: r.updatedAt });
  }
  return [...newest.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** "Patreon was updated later, on Sep 14" or "Patreon (Sep 14) and wicked.cc (Sep 2) were updated later". */
export function laterSourcesText(later: RemoteInfo[], now = Date.now()): string {
  const [only] = later;
  if (!only) return '';
  if (later.length === 1) return `${SOURCE_LABEL[only.listing.source]} was updated later, on ${formatShortDate(only.updatedAt, now)}`;
  const parts = later.map((r) => `${SOURCE_LABEL[r.listing.source]} (${formatShortDate(r.updatedAt, now)})`);
  return `${[parts.slice(0, -1).join(', '), parts.at(-1)].join(' and ')} were updated later`;
}

/**
 * Orders downloadable sources: most recent day first, then most files
 * (`fileCounts` by listing URL, else RemoteInfo.fileCount), then exact time.
 * Unknown counts rank below known ones.
 */
export function rankRemotes(remotes: RemoteInfo[], fileCounts?: Map<string, number>): RemoteInfo[] {
  const count = (r: RemoteInfo): number => fileCounts?.get(r.listing.url) ?? r.fileCount ?? 0;
  return [...remotes].sort(
    (a, b) => day(b.updatedAt) - day(a.updatedAt) || count(b) - count(a) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
  );
}
