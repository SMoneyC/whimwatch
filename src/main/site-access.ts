import { type Fetcher, HostQueue, type HttpResponse, isChallengePage, politeGap, VerificationRequiredError } from '../core/fetcher.js';
import type { BrowserSite } from '../shared/api.js';
import { VerificationGate } from './verification.js';

/**
 * The browser bits this needs, as little of them as possible. BrowserPool is
 * the real one, on top of Electron windows; tests stand in their own, which is
 * the point: when a page is loaded, and whether it's loaded at all, is decided
 * here, where it can be checked without a browser.
 */
export interface SiteBrowser {
  label(site: BrowserSite): string;
  /** Whether the site's window is on screen, i.e. the user is working in it. */
  onScreen(site: BrowserSite): boolean;
  /** Loads the page in the site's window and returns it once parsed. */
  loadPage(site: BrowserSite, url: string): Promise<HttpResponse>;
  /** Runs a script in a page of the site, loading it first if the window is elsewhere. */
  runScript<T>(site: BrowserSite, pageUrl: string, script: string): Promise<T>;
}

export interface SiteAccessHooks {
  /** A site wants a human check; said once per run, or again after the user waves it away. */
  onVerificationNeeded?: (site: BrowserSite) => void;
}

/**
 * Everything between "a check wants this page" and the browser loading it:
 * whose turn it is, which sites are held back waiting for a human check, and
 * when to say so.
 *
 * A site that asks for a human check is left alone until it's passed. The hold
 * is looked at twice — before queueing, so the rest of a check fails fast
 * instead of waiting out the polite gap, and again once the queue gets to the
 * request, because a whole check's worth of them can be handed over before the
 * first one discovers the challenge.
 */
export class SiteAccess {
  private queue = new HostQueue(politeGap);
  private gate = new VerificationGate();

  constructor(
    private readonly browser: SiteBrowser,
    private readonly hooks: SiteAccessHooks = {},
  ) {}

  /** Wraps a plain fetcher with the browser-backed ways of reading a site. */
  fetcher(http: Pick<Fetcher, 'get' | 'head'>, siteOf: (url: string) => BrowserSite | undefined): Fetcher {
    return {
      get: http.get,
      head: http.head,
      browserGet: (url) => this.run(siteOf(url), url, (site) => this.loadPage(site, url)),
      browserFetch: (pageUrl, apiUrl) =>
        this.run(siteOf(pageUrl), apiUrl, (site) =>
          this.browser.runScript<{ status: number; body: string }>(
            site,
            pageUrl,
            `fetch(${JSON.stringify(apiUrl)}, { credentials: 'include', headers: { Accept: 'application/vnd.api+json' } })
              .then(async (r) => ({ status: r.status, body: await r.text() }))`,
          ),
        ),
    };
  }

  /** Runs a script in a page of the site, held back and queued like any other request. */
  runInPage<T>(site: BrowserSite | undefined, pageUrl: string, script: string): Promise<T> {
    return this.run(site, pageUrl, (s) => this.browser.runScript<T>(s, pageUrl, script));
  }

  /** Whether the site must be left alone: waiting for a human check, or on screen for the user. */
  heldBack(site: BrowserSite): VerificationRequiredError | undefined {
    if (!this.browser.onScreen(site) && !this.gate.isArmed(site)) return undefined;
    // Every page turned away passes through here, so this is where saying so belongs. It stays
    // at once per run by itself: arm() only reports the first, until the user waves the notice
    // away and remind() lets it be said again.
    this.requestVerification(site);
    return new VerificationRequiredError(this.browser.label(site));
  }

  /** Tells the user a site wants a human check: once, until they act on it. */
  requestVerification(site: BrowserSite): void {
    if (this.gate.arm(site)) this.hooks.onVerificationNeeded?.(site);
  }

  /** The user passed the check, or something started that should try the site again. */
  clearVerification(site: BrowserSite): void {
    this.gate.clear(site);
  }

  /** Says it again next time the site is held back, after the user waved the notice away. */
  remindVerification(site: BrowserSite): void {
    this.gate.remind(site);
  }

  isHeldBack(site: BrowserSite): boolean {
    return this.gate.isArmed(site);
  }

  cancelPending(): void {
    this.queue.cancelPending();
  }

  private run<T>(site: BrowserSite | undefined, queueUrl: string, task: (site: BrowserSite) => Promise<T>): Promise<T> {
    if (!site) return Promise.reject(new Error(`No browser session for ${queueUrl}`));
    const held = this.heldBack(site);
    if (held) return Promise.reject(held);
    return this.queue.run(queueUrl, () => {
      // Asked again: the queue runs this long after it was handed over.
      const now = this.heldBack(site);
      if (now) throw now;
      return task(site);
    });
  }

  private async loadPage(site: BrowserSite, url: string): Promise<HttpResponse> {
    const page = await this.browser.loadPage(site, url);
    if (isChallengePage(page.body)) {
      this.requestVerification(site);
      throw new VerificationRequiredError(this.browser.label(site));
    }
    return page;
  }
}
