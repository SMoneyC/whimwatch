import type { CreatorStatus, RemoteInfo } from '../shared/types.js';

/** Timezones and upload delays make same-day dates unreliable, so allow a day. */
export const TOLERANCE_MS = 24 * 60 * 60 * 1000;

export function newestRemote(remotes: RemoteInfo[]): number | undefined {
  let newest: number | undefined;
  for (const r of remotes) {
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
): { status: CreatorStatus; remoteUpdatedAt?: number } {
  const remoteUpdatedAt = newestRemote(remotes);
  if (remoteUpdatedAt === undefined) {
    const status = remotes.some((r) => r.status === 'needs-verification') ? 'needs-verification' : 'unknown';
    return { status };
  }
  return { status: isNewer(remoteUpdatedAt, localUpdatedAt, dismissedAt) ? 'update-available' : 'up-to-date', remoteUpdatedAt };
}

/**
 * The date to mark as seen after checking one source dated `checked`: that
 * date, or a later one from a source posted within the same day (the same
 * release). Sources dated later than that stay visible as updates.
 */
export function seenUpTo(remotes: RemoteInfo[], checked: number): number {
  return Math.max(
    checked,
    ...remotes.flatMap((r) => (r.status === 'ok' && r.updatedAt !== undefined && r.updatedAt <= checked + TOLERANCE_MS ? [r.updatedAt] : [])),
  );
}

export function isNewer(remote: number, local: number, dismissedAt?: number): boolean {
  if (dismissedAt !== undefined && dismissedAt >= remote) return false;
  return remote > local + TOLERANCE_MS;
}
