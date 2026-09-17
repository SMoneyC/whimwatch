import type { AppSnapshot, BrowserSite } from '../../shared/api';
import type { CoreResult, CreatorResult, RemoteInfo, SourceId } from '../../shared/types';
import { updatableRemote, updatableRemotes } from '../../shared/updatable';
import { SOURCE_LABEL } from './format';

export const CORE_KEY = '__wickedwhims__';

export interface Candidate {
  key: string;
  name: string;
  /** Where the update would come from, e.g. "wicked.cc". */
  source: string;
}

export interface Ineligible {
  key: string;
  name: string;
  reason: string;
  /** The site to sign in to, when that's the fix. */
  signIn?: BrowserSite;
}

type SignedIn = (site: BrowserSite) => boolean;

export const signedInCheck =
  (snapshot: AppSnapshot): SignedIn =>
  (site) =>
    snapshot.accounts.some((a) => a.site === site && a.signedIn);

export function downloadableRemote(remotes: RemoteInfo[], snapshot: AppSnapshot): RemoteInfo | undefined {
  return updatableRemote(remotes, signedInCheck(snapshot));
}

export interface DownloadOption {
  url: string;
  label: string;
  /** The page's own name, when the site gives one and page titles aren't hidden. */
  title?: string;
  updatedAt?: number;
  version?: string;
  fileCount?: number;
}

/** Sources an update can be downloaded from right now, newest (the default) first. */
export function downloadOptions(key: string, snapshot: AppSnapshot): DownloadOption[] {
  const result = snapshot.lastResult;
  if (!result) return [];
  if (key === CORE_KEY) {
    const url = result.core.downloadPageUrl;
    return url?.includes('wicked.cc') ? [{ url, label: 'wicked.cc', updatedAt: result.core.releasedAt, version: result.core.latestVersion }] : [];
  }
  const creator = result.creators.find((c) => c.key === key);
  return (creator ? updatableRemotes(creator.remotes, signedInCheck(snapshot)) : []).map((r) => ({
    url: r.listing.url,
    label: SOURCE_LABEL[r.listing.source],
    // A creator can have a dozen pages on one site, where "wicked.cc" twelve times tells you nothing.
    title: snapshot.settings.hidePageTitles ? undefined : r.title,
    updatedAt: r.updatedAt,
    version: r.version,
    fileCount: r.fileCount,
  }));
}

export function coreUpdatable(core: CoreResult): boolean {
  return Boolean(core.installed && core.status === 'update-available' && core.downloadPageUrl?.includes('wicked.cc'));
}

/** Why an available update can't be downloaded right now, and the fix when there is one. */
function blocker(c: CreatorResult, signedIn: SignedIn): { reason: string; signIn?: BrowserSite; url?: string } {
  const ok = c.remotes.filter((r) => r.status === 'ok');
  const newest = [...ok].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
  if (ok.some((r) => r.listing.source === 'loverslab') && !signedIn('loverslab')) return { reason: 'Sign in to LoversLab', signIn: 'loverslab' };
  if (ok.some((r) => r.listing.source === 'patreon') && !signedIn('patreon')) return { reason: 'Sign in to Patreon', signIn: 'patreon' };
  if (ok.some((r) => r.listing.source === 'patreon' && r.locked)) return { reason: 'The Patreon post is for patrons only', url: newest?.listing.url };
  return { reason: 'No download link found', url: newest?.listing.url };
}

/** Splits available updates into ones "Update all" can install now and ones it can't (with why). */
export function updateCandidates(core: CoreResult | undefined, creators: CreatorResult[], snapshot: AppSnapshot) {
  const eligible: Candidate[] = [];
  const ineligible: Ineligible[] = [];
  if (core && coreUpdatable(core)) eligible.push({ key: CORE_KEY, name: 'WickedWhims', source: 'wicked.cc' });

  const signedIn = signedInCheck(snapshot);
  for (const c of creators) {
    if (c.status !== 'update-available') continue;
    const remote = updatableRemote(c.remotes, signedIn);
    if (remote) {
      eligible.push({ key: c.key, name: c.name, source: SOURCE_LABEL[remote.listing.source] });
      continue;
    }
    const { reason, signIn } = blocker(c, signedIn);
    ineligible.push({ key: c.key, name: c.name, reason, signIn });
  }
  return { eligible, ineligible };
}

/** What a row shows: one status, never two markers for the same thing. */
export type RowStatus = 'update' | 'current' | 'verify' | 'missing' | 'failed' | 'off';

export const ROW_STATUS_LABEL: Record<RowStatus, string> = {
  update: 'Update ready',
  current: 'Up to date',
  verify: 'Needs a check',
  missing: 'No page found',
  failed: "Couldn't check",
  off: 'Not checked',
};

export function rowStatus(c: CreatorResult): RowStatus {
  switch (c.status) {
    case 'update-available':
      return 'update';
    case 'up-to-date':
      return 'current';
    case 'needs-verification':
      return 'verify';
    default:
      if (c.remotes.some((r) => r.status === 'error')) return 'failed';
      // Every page it has is on a site the user turned off: nothing to fix.
      return c.mutedSources?.length && !c.remotes.length ? 'off' : 'missing';
  }
}

/** "Patreon", "LoversLab and Patreon" */
export function siteList(sites: SourceId[]): string {
  const labels = sites.map((s) => SOURCE_LABEL[s]);
  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}` : (labels[0] ?? '');
}

export type RowAction =
  | { kind: 'update' }
  | { kind: 'sign-in'; site: BrowserSite }
  | { kind: 'open'; url: string }
  | { kind: 'verify'; site: BrowserSite }
  | { kind: 'add-page' }
  | { kind: 'none' };

/** The one button a row offers. */
export function rowAction(c: CreatorResult, snapshot: AppSnapshot): RowAction {
  const status = rowStatus(c);
  if (status === 'update') {
    if (downloadableRemote(c.remotes, snapshot)) return { kind: 'update' };
    const { signIn, url } = blocker(c, signedInCheck(snapshot));
    if (signIn) return { kind: 'sign-in', site: signIn };
    return url ? { kind: 'open', url } : { kind: 'none' };
  }
  if (status === 'verify') {
    const site = c.remotes.find((r) => r.status === 'needs-verification')?.listing.source;
    return site === 'loverslab' || site === 'patreon' ? { kind: 'verify', site } : { kind: 'none' };
  }
  if (status === 'missing') return { kind: 'add-page' };
  return { kind: 'none' };
}

/** "New release 3 days ago", "Released 2 months ago"… (the middle column of a row). */
export function rowSummary(c: CreatorResult, timeAgo: (t: number) => string): string {
  switch (rowStatus(c)) {
    case 'update':
      return c.remoteUpdatedAt !== undefined ? `New release ${timeAgo(c.remoteUpdatedAt)}` : 'New release';
    case 'current':
      if (c.dismissedAt !== undefined && c.remoteUpdatedAt !== undefined && c.remoteUpdatedAt > c.localUpdatedAt + 86_400_000) return 'Marked as seen';
      return c.remoteUpdatedAt !== undefined ? `Released ${timeAgo(c.remoteUpdatedAt)}` : 'Up to date';
    case 'verify': {
      const site = c.remotes.find((r) => r.status === 'needs-verification')?.listing.source;
      return `${site ? SOURCE_LABEL[site] : 'A site'} wants a human check`;
    }
    case 'missing':
      return 'No download page found';
    case 'failed': {
      const site = c.remotes.find((r) => r.status === 'error')?.listing.source;
      return `Couldn't reach ${site ? SOURCE_LABEL[site] : 'the site'}`;
    }
    case 'off': {
      const sites = c.mutedSources ?? [];
      return `${siteList(sites)} ${sites.length === 1 ? 'is' : 'are'} turned off`;
    }
  }
}

export type SortOrder = 'newest' | 'outdated' | 'name';

export function sortCreators(list: CreatorResult[], order: SortOrder): CreatorResult[] {
  const byName = (a: CreatorResult, b: CreatorResult): number => a.name.localeCompare(b.name);
  return [...list].sort((a, b) => {
    if (order === 'name') return byName(a, b);
    if (order === 'outdated') {
      const gap = (c: CreatorResult): number => (c.remoteUpdatedAt ?? 0) - c.localUpdatedAt;
      return gap(b) - gap(a) || byName(a, b);
    }
    return (b.remoteUpdatedAt ?? 0) - (a.remoteUpdatedAt ?? 0) || byName(a, b);
  });
}
