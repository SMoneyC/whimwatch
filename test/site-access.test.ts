import { describe, expect, it } from 'vitest';
import { VerificationRequiredError } from '../src/core/fetcher.js';
import { SiteAccess, type SiteBrowser } from '../src/main/site-access.js';
import type { BrowserSite } from '../src/shared/api.js';
import * as pages from './fixtures/pages.js';

/**
 * Stands in for the Electron windows. Everything that decides whether a site is
 * touched at all lives in SiteAccess, so these are the paths that used to need a
 * browser and a human with a stopwatch to check.
 */
class FakeBrowser implements SiteBrowser {
  loaded: string[] = [];
  onScreenSites = new Set<BrowserSite>();
  /** Sites serving a challenge rather than the page asked for, until it's passed. */
  challenging = new Set<BrowserSite>(['patreon']);

  label(site: BrowserSite): string {
    return site === 'patreon' ? 'Patreon' : 'LoversLab';
  }

  onScreen(site: BrowserSite): boolean {
    return this.onScreenSites.has(site);
  }

  async loadPage(site: BrowserSite, url: string): Promise<{ status: number; url: string; body: string; headers: Record<string, string> }> {
    this.loaded.push(url);
    return { status: 200, url, body: this.challenging.has(site) ? pages.CHALLENGE : '<html><title>a page</title></html>', headers: {} };
  }

  async runScript<T>(site: BrowserSite, pageUrl: string): Promise<T> {
    this.loaded.push(`script:${pageUrl}`);
    return undefined as T;
  }
}

const setup = (): { browser: FakeBrowser; access: SiteAccess; told: BrowserSite[] } => {
  const browser = new FakeBrowser();
  const told: BrowserSite[] = [];
  const access = new SiteAccess(browser, { onVerificationNeeded: (site) => told.push(site) });
  return { browser, access, told };
};

const siteOf = (url: string): BrowserSite | undefined => (url.includes('patreon') ? 'patreon' : url.includes('loverslab') ? 'loverslab' : undefined);
const patreon = (path: string): string => `https://www.patreon.com${path}`;

describe('reaching a site that wants a human check', () => {
  it('loads one page, not one per creator, when a whole check is already in flight', async () => {
    const { browser, access, told } = setup();
    const fetcher = access.fetcher({ get: unused, head: unused }, siteOf);

    // What a real check does: several creators' pages handed over together, before any of them
    // has come back with a challenge.
    const results = await Promise.allSettled(['/a', '/b', '/c', '/d', '/e', '/f'].map((p) => fetcher.browserGet!(patreon(p))));

    expect(browser.loaded).toEqual([patreon('/a')]);
    expect(results.every((r) => r.status === 'rejected' && r.reason instanceof VerificationRequiredError)).toBe(true);
    expect(told).toEqual(['patreon']);
  });

  it('leaves alone a window the user is working in, and says so', async () => {
    const { browser, access, told } = setup();
    browser.onScreenSites.add('patreon');

    await expect(access.fetcher({ get: unused, head: unused }, siteOf).browserGet!(patreon('/a'))).rejects.toBeInstanceOf(VerificationRequiredError);
    expect(browser.loaded).toEqual([]);
    expect(told).toEqual(['patreon']);
  });

  it('says it again after the user waves the notice away, but still only once', async () => {
    const { access, told } = setup();
    const get = (p: string): Promise<unknown> => access.fetcher({ get: unused, head: unused }, siteOf).browserGet!(patreon(p)).catch(() => undefined);

    await get('/a');
    await get('/b');
    expect(told).toEqual(['patreon']);

    // The banner is closed without the check being passed: the site is still held back, so the
    // next page turned away is worth saying again.
    access.remindVerification('patreon');
    await get('/c');
    await get('/d');
    expect(told).toEqual(['patreon', 'patreon']);
  });

  // Real requests wait out the gap between them, which is the point of the queue; only the
  // held-back ones are meant to be quick.
  it('holds back only the site that asked, and lets it through once the check is passed', { timeout: 20_000 }, async () => {
    const { browser, access } = setup();
    const fetcher = access.fetcher({ get: unused, head: unused }, siteOf);
    await fetcher.browserGet!(patreon('/a')).catch(() => undefined);

    // LoversLab never challenged anything, so its own pages carry on.
    await expect(fetcher.browserGet!('https://www.loverslab.com/files/file/1-x/')).resolves.toMatchObject({ status: 200 });
    await expect(fetcher.browserGet!(patreon('/b'))).rejects.toBeInstanceOf(VerificationRequiredError);
    // Reading a page's own data is held back the same way, window or not.
    await expect(access.runInPage('patreon', patreon('/b'), 'x')).rejects.toBeInstanceOf(VerificationRequiredError);

    browser.challenging.delete('patreon');
    access.clearVerification('patreon');
    await expect(fetcher.browserGet!(patreon('/c'))).resolves.toMatchObject({ status: 200 });
    expect(access.isHeldBack('patreon')).toBe(false);
  });
});

const unused = async (): Promise<never> => {
  throw new Error('the plain fetcher is not used here');
};
