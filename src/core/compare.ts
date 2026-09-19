import type { CreatorStatus, RemoteInfo } from '../shared/types.js';
import { isNewer, ownedRemotes, outdatedRemotes, TOLERANCE_MS } from '../shared/updatable.js';

export { isNewer, outdatedRemotes, TOLERANCE_MS };

export function newestRemote(remotes: RemoteInfo[]): number | undefined {
  let newest: number | undefined;
  for (const r of ownedRemotes(remotes)) {
    if (r.status === 'ok' && r.updatedAt !== undefined && (newest === undefined || r.updatedAt > newest)) {
      newest = r.updatedAt;
    }
  }
  return newest;
}

export function creatorStatus(
  localUpdatedAt: number,
  remotes: RemoteInfo[],
  dismissedAt?: number,
): { status: CreatorStatus; remoteUpdatedAt?: number; behindBy?: number } {
  const newest = newestRemote(remotes);
  if (newest === undefined) {
    const status = remotes.some((r) => r.status === 'needs-verification') ? 'needs-verification' : 'unknown';
    return { status };
  }
  const outdated = outdatedRemotes(remotes, localUpdatedAt, dismissedAt);
  // When something needs updating, the date shown is that page's — not the creator's newest page,
  // which may be a pack you already have and would name the wrong release on the row.
  if (outdated.length) {
    return {
      status: 'update-available',
      remoteUpdatedAt: Math.max(...outdated.map((r) => r.updatedAt!)),
      behindBy: Math.max(...outdated.map((r) => r.updatedAt! - (r.yoursAt ?? localUpdatedAt))),
    };
  }
  return { status: 'up-to-date', remoteUpdatedAt: newest };
}

/**
 * Which mark a "Mark as seen" click should write: the one page the user pointed at, or one date
 * across the whole creator.
 *
 * Ownership deliberately isn't required for the per-page mark. Only packs carrying WickedWhims
 * tuning have an author in the file; a plain CAS pack has none and reaches its creator by filename
 * instead, so it never gets a yoursAt of its own. On real data that was 4 pages of 18, so requiring
 * yoursAt sent most marks to the creator-wide branch, leaving a single date that the creator's next
 * post immediately outruns — the "I mark it as seen and it keeps coming back" report.
 */
export function seenMark(
  creator: { remotes: RemoteInfo[]; remoteUpdatedAt?: number } | undefined,
  listingUrl?: string,
): { page?: string; at: number } | undefined {
  const page = listingUrl ? creator?.remotes.find((r) => r.listing.url === listingUrl) : undefined;
  if (page?.updatedAt !== undefined) return { page: page.listing.url, at: page.updatedAt };
  // A page carrying no date of its own (a Patreon creator page, say) can't be marked on its own.
  // Fall back to the creator rather than returning nothing, or the button does nothing at all.
  const checked = creator?.remoteUpdatedAt;
  return checked === undefined ? undefined : { at: seenUpTo(creator?.remotes ?? [], checked) };
}

/**
 * The date to mark as seen after checking one source dated `checked`: that
 * date, or a later one from a source posted within the same day (the same
 * release). Sources dated later than that stay visible as updates.
 */
export function seenUpTo(remotes: RemoteInfo[], checked: number): number {
  return Math.max(
    checked,
    ...ownedRemotes(remotes).flatMap((r) => (r.status === 'ok' && r.updatedAt !== undefined && r.updatedAt <= checked + TOLERANCE_MS ? [r.updatedAt] : [])),
  );
}

