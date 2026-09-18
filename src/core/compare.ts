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

