import type { RemoteInfo } from '../shared/types.js';
import { ownedRemotes, rankRemotes, sameDay, updatableRemotes } from '../shared/updatable.js';
import { throwIfCancelled } from './fetcher.js';

export interface SourceChoiceOptions {
  signedIn: (site: 'loverslab' | 'patreon') => boolean;
  /** Only sources that need no sign-in (automatic installs never use accounts). */
  publicOnly?: boolean;
  /** A source the user picked; returned only if it's downloadable. */
  listingUrl?: string;
  /** Asks a site how many files a source offers; only called to break same-day ties. */
  countFiles: (remote: RemoteInfo) => Promise<number>;
  signal?: AbortSignal;
  onCompare?: () => void;
}

/**
 * Picks the source to update from: one the user can download from, the
 * newest by day, then the one offering the most files.
 */
export async function chooseRemote(remotes: RemoteInfo[], opts: SourceChoiceOptions): Promise<RemoteInfo | undefined> {
  const signedIn = (site: 'loverslab' | 'patreon'): boolean => !opts.publicOnly && opts.signedIn(site);
  // Left to itself this picks the newest page, which for a creator with a page per pack is often a
  // pack the user doesn't have. Asking for one by name still works: that's how a new pack is got.
  const options = updatableRemotes(opts.listingUrl ? remotes : ownedRemotes(remotes), signedIn);
  if (opts.listingUrl) return options.find((r) => r.listing.url === opts.listingUrl);
  const best = options[0];
  if (!best) return undefined;
  const tied = options.filter((r) => sameDay(r, best));
  if (tied.length < 2) return best;

  opts.onCompare?.();
  const counts = new Map<string, number>();
  for (const remote of tied) {
    throwIfCancelled(opts.signal);
    counts.set(remote.listing.url, remote.fileCount ?? (await opts.countFiles(remote).catch(() => 0)));
  }
  throwIfCancelled(opts.signal);
  return rankRemotes(tied, counts)[0];
}
