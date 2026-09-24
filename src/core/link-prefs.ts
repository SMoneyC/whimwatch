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
  return wasManual;
}

/** Brings a removed page back: found again by the next check, or re-added if the user had added it. */
export function restoreLink(prefs: CreatorLinkPrefs, link: string): void {
  const same = (u: string): boolean => linkKey(u) === linkKey(link);
  prefs.rejected = prefs.rejected.filter((u) => !same(u));
  const added = prefs.rejectedManual?.find(same);
  if (added && !prefs.manual.some(same)) prefs.manual.push(added);
  prefs.rejectedManual = prefs.rejectedManual?.filter((u) => !same(u));
  if (!prefs.rejectedManual?.length) delete prefs.rejectedManual;
}
