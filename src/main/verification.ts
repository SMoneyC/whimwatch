import type { BrowserSite } from '../shared/api.js';

/**
 * Which sites are waiting for the user to pass a human check.
 *
 * While a site is held back nothing else loads a page from it. One check can
 * hold dozens of pages for the same site, and each one would otherwise start its
 * own challenge: in the shared site window that means navigating away from the
 * challenge the user is part way through, over and over, and waiting out a
 * timeout every time.
 *
 * Telling the user is tracked apart from holding the site, so the notice is said
 * once rather than once per page, and can be said again after they wave it away.
 */
export class VerificationGate {
  private armed = new Set<BrowserSite>();
  private told = new Set<BrowserSite>();

  /** Holds the site back. Returns whether the user should be told now. */
  arm(site: BrowserSite): boolean {
    this.armed.add(site);
    if (this.told.has(site)) return false;
    this.told.add(site);
    return true;
  }

  isArmed(site: BrowserSite): boolean {
    return this.armed.has(site);
  }

  /** After the check is passed, or when the user starts something new that should try again. */
  clear(site?: BrowserSite): void {
    if (!site) {
      this.armed.clear();
      this.told.clear();
      return;
    }
    this.armed.delete(site);
    this.told.delete(site);
  }

  /**
   * Keeps the site held back, but says so again next time something is turned
   * away: the user dismissed the notice without passing the check, and every
   * page of that site is still going nowhere.
   */
  remind(site: BrowserSite): void {
    this.told.delete(site);
  }
}
