import { type CheckResult, type CreatorResult, type RemoteInfo, UPDATE_SITES, type UpdateSite } from './types.js';

/**
 * Applies the turned-off sites (for everyone, plus each creator's own) to saved results without a new
 * check. Results from a site that was just turned off are set aside; ones set aside earlier come back
 * when it's turned on again. A site that was already off during the check has nothing to bring back
 * until the next check. Statuses aren't recomputed here.
 */
export function applyMutedSources(
  result: Pick<CheckResult, 'creators'>,
  mutedSources: readonly UpdateSite[],
  creatorMuted: Record<string, readonly UpdateSite[] | undefined> = {},
): void {
  for (const creator of result.creators) {
    const muted = new Set<string>([...mutedSources, ...(creatorMuted[creator.key] ?? [])]);
    const isMuted = (r: RemoteInfo): boolean => muted.has(r.listing.source);
    const restored = (creator.mutedRemotes ?? []).filter((r) => !isMuted(r));
    const mutedRemotes = [...(creator.mutedRemotes ?? []).filter(isMuted), ...creator.remotes.filter(isMuted)];
    const remotes = [...creator.remotes.filter((r) => !isMuted(r)), ...restored];
    if (restored.length) remotes.sort((a, b) => siteOrder(a) - siteOrder(b));
    const before = new Set(creator.mutedSources);
    const mutedSites = UPDATE_SITES.filter((site) => muted.has(site) && (before.has(site) || mutedRemotes.some((r) => r.listing.source === site)));

    creator.remotes = remotes;
    if (mutedRemotes.length) creator.mutedRemotes = mutedRemotes;
    else delete creator.mutedRemotes;
    if (mutedSites.length) creator.mutedSources = mutedSites;
    else delete creator.mutedSources;
  }
}

/** Whether turning `site` back on for these creators leaves some without its results until the next check. */
export function needsCheckAfterUnmute(creators: readonly CreatorResult[], site: UpdateSite): boolean {
  return creators.some((c) => c.mutedSources?.includes(site) && !c.mutedRemotes?.some((r) => r.listing.source === site));
}

const siteOrder = (r: RemoteInfo): number => UPDATE_SITES.indexOf(r.listing.source as UpdateSite);
