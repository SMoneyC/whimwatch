import type { RemoteInfo } from '../shared/types.js';
import type { CreatorLinkPrefs } from './check.js';
import { linkKey } from './sources/urls.js';

/**
 * Removes a page from a creator ("Not this creator's page", or "Not interested" in a pack). A page
 * the user added by hand is noted as such, in the saved prefs rather than only for the toast's Undo:
 * brought back later with "Show again", it has to be added back too, since no check would find it.
 * Returns whether it was one they added.
 */
export function removeLink(prefs: CreatorLinkPrefs, link: string): boolean {
  const same = (u: string): boolean => linkKey(u) === linkKey(link);
  const wasManual = prefs.manual.some(same);
  prefs.manual = prefs.manual.filter((u) => !same(u));
  if (!prefs.rejected.some(same)) prefs.rejected.push(link);
  if (wasManual && !prefs.rejectedManual?.some(same)) prefs.rejectedManual = [...(prefs.rejectedManual ?? []), link];
  if (prefs.addedAt) {
    const { [linkKey(link)]: _gone, ...rest } = prefs.addedAt;
    prefs.addedAt = rest;
    if (!Object.keys(rest).length) delete prefs.addedAt;
  }
  return wasManual;
}

/**
 * Brings a removed page back: found again by the next check, or re-added if the user had added it,
 * as a page added now, since nothing has read it since it was removed.
 */
export function restoreLink(prefs: CreatorLinkPrefs, link: string, now = Date.now()): void {
  const same = (u: string): boolean => linkKey(u) === linkKey(link);
  prefs.rejected = prefs.rejected.filter((u) => !same(u));
  const added = prefs.rejectedManual?.find(same);
  if (added && !prefs.manual.some(same)) {
    prefs.manual.push(added);
    prefs.addedAt = { ...prefs.addedAt, [linkKey(added)]: now };
  }
  prefs.rejectedManual = prefs.rejectedManual?.filter((u) => !same(u));
  if (!prefs.rejectedManual?.length) delete prefs.rejectedManual;
}

/**
 * Pages the user added that nothing has read yet, for the creator's details to list. A page counts
 * as read once it is among the creator's pages (in whatever form its address was kept), or once a
 * check that started after it was added has finished: a check replaces an added wicked.cc index with
 * the packs it lists, so the index itself is never among the pages, and would otherwise wait
 * forever. Started, not finished: a check already running when the page was added planned without it.
 */
export function unreadLinks(prefs: CreatorLinkPrefs | undefined, pages: readonly RemoteInfo[], checkStartedAt: number | undefined): string[] {
  const read = new Set(pages.map((r) => linkKey(r.listing.url)));
  return (prefs?.manual ?? []).filter((u) => {
    const added = prefs?.addedAt?.[linkKey(u)];
    return !read.has(linkKey(u)) && (added === undefined || checkStartedAt === undefined || added > checkStartedAt);
  });
}
