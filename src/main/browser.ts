import { BrowserWindow, session, type Session, type WebContents } from 'electron';
import {
  CancelledError,
  createNodeFetcher,
  type Fetcher,
  HostQueue,
  type HttpResponse,
  isChallengePage,
  politeGap,
  VerificationRequiredError,
} from '../core/fetcher.js';
import type { BrowserSite } from '../shared/api.js';
import { allowHiddenRequest, SITE_DOMAINS } from './request-filter.js';
import { SiteSessionMode } from './session-mode.js';

export type { BrowserSite };

export const SITES: Record<BrowserSite, { label: string; origin: string; loginUrl: string; sessionCookie: string }> = {
  loverslab: {
    label: 'LoversLab',
    origin: 'https://www.loverslab.com',
    loginUrl: 'https://www.loverslab.com/login/',
    sessionCookie: 'ips4_member_id',
  },
  patreon: {
    label: 'Patreon',
    origin: 'https://www.patreon.com',
    loginUrl: 'https://www.patreon.com/login',
    sessionCookie: 'session_id',
  },
};

const CHALLENGE_TIMEOUT_MS = 25_000;
const LOAD_TIMEOUT_MS = 45_000;

export function siteForUrl(url: string): BrowserSite | undefined {
  const host = new URL(url).hostname;
  if (host.endsWith('loverslab.com')) return 'loverslab';
  if (host.endsWith('patreon.com')) return 'patreon';
  return undefined;
}

/** Chrome-like UA for this OS; the default Electron UA advertises "Electron/x". */
export function browserUserAgent(): string {
  const chrome = process.versions.chrome?.split('.')[0] ?? '144';
  const os =
    process.platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : process.platform === 'darwin'
        ? 'Macintosh; Intel Mac OS X 10_15_7'
        : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome}.0.0.0 Safari/537.36`;
}

const hardened = new WeakSet<Session>();
const sessionMode = new SiteSessionMode();
const ALL_SITES: BrowserSite[] = ['loverslab', 'patreon'];

/**
 * Chooses whether the LoversLab/Patreon browsers keep anything on disk.
 * In-memory sessions write no cache, cookies or site storage, so sign-ins last
 * until the app closes. Takes effect now if no page, sign-in or download has
 * used a session yet (always the case during first-run setup); otherwise from
 * the next launch. Returns whether it took effect.
 */
export function configureSiteSessions(opts: { persist: boolean }): boolean {
  return sessionMode.trySet(opts.persist);
}

export function siteSessionsPersist(): boolean {
  return sessionMode.persist;
}

/** The session for reading its state (cookies, cache size) without committing to the current mode. */
export function siteSession(site: BrowserSite): Session {
  return hardenedSession(site, sessionMode.persist);
}

/** The session for loading pages, signing in or downloading: from here on the mode is fixed until restart. */
export function useSiteSession(site: BrowserSite): Session {
  sessionMode.markUsed();
  return siteSession(site);
}

/**
 * Sessions to clear on exit or from Settings. In memory mode that includes the
 * on-disk sessions too, which may still hold data from an earlier launch.
 */
export function sessionsToClear(): { session: Session; domains: string[] }[] {
  const modes = sessionMode.persist ? [true] : [false, true];
  return modes.flatMap((persist) => ALL_SITES.map((site) => ({ session: hardenedSession(site, persist), domains: SITE_DOMAINS[site] })));
}

function hardenedSession(site: BrowserSite, persist: boolean): Session {
  const ses = session.fromPartition(persist ? `persist:${site}` : `whimwatch-memory-${site}`);
  if (!hardened.has(ses)) {
    hardened.add(ses);
    ses.setUserAgent(browserUserAgent());
    denyPermissions(ses);
  }
  return ses;
}

/**
 * Third-party pages run in these sessions; Electron grants every permission
 * (notifications, camera, location…) unless told otherwise.
 */
export function denyPermissions(ses: Session): void {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setSpellCheckerEnabled(false);
}

/**
 * One hidden window per site, reused for every request so Cloudflare clearance
 * and sign-in cookies carry over. Requests are serialized per site by the queue.
 */
export class BrowserPool {
  private windows = new Map<BrowserSite, BrowserWindow>();
  private queue = new HostQueue(politeGap);
  private http = createNodeFetcher(this.queue);
  private disposing = false;
  private filteredSessions = new WeakSet<Session>();
  /** Called when a site needs the user to complete a challenge. */
  onVerificationNeeded?: (site: BrowserSite) => void;

  fetcher(): Fetcher {
    return {
      get: this.http.get,
      head: this.http.head,
      browserGet: (url) => this.queue.run(url, () => this.load(url)),
      browserFetch: (pageUrl, apiUrl) => this.queue.run(apiUrl, () => this.fetchInPage(pageUrl, apiUrl)),
    };
  }

  window(site: BrowserSite): BrowserWindow {
    let win = this.windows.get(site);
    if (win && !win.isDestroyed()) return win;
    const ses = useSiteSession(site);
    this.filterHiddenRequests(site, ses);
    win = new BrowserWindow({
      show: false,
      width: 1100,
      height: 800,
      title: `${SITES[site].label} — WhimWatch`,
      autoHideMenuBar: true,
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        spellcheck: false,
      },
    });
    // Closing the verification window just hides it; the session lives on.
    win.on('close', (event) => {
      if (!this.disposing) {
        event.preventDefault();
        win!.hide();
      }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.windows.set(site, win);
    return win;
  }

  /**
   * Hidden windows only need page HTML: images, media, fonts, embeds and
   * third-party trackers are skipped (see allowHiddenRequest). Visible windows (a
   * human completing a check or signing in) and downloads load normally.
   */
  private filterHiddenRequests(site: BrowserSite, ses: Session): void {
    if (this.filteredSessions.has(ses)) return;
    this.filteredSessions.add(ses);
    ses.webRequest.onBeforeRequest((details, callback) => {
      const hidden = [...this.windows.values()].some(
        (w) => !w.isDestroyed() && !w.isVisible() && w.webContents.id === details.webContentsId,
      );
      callback({ cancel: hidden && !allowHiddenRequest(site, details.url, details.resourceType) });
    });
  }

  /** Reveals the site's window so the user can pass a challenge by hand. */
  showVerification(site: BrowserSite, url = SITES[site].origin): void {
    const win = this.window(site);
    win.show();
    win.focus();
    // Load (or reload) now that it's visible, so images and challenge widgets aren't skipped.
    if (win.webContents.getURL()) win.webContents.reload();
    else void win.loadURL(url);
  }

  dispose(): void {
    this.disposing = true;
    for (const win of this.windows.values()) if (!win.isDestroyed()) win.destroy();
    this.windows.clear();
  }

  /** Cancels queued requests and closes the hidden windows so in-flight page loads stop now. */
  cancelAll(): void {
    this.queue.cancelPending();
    for (const site of [...this.windows.keys()]) {
      if (!this.windows.get(site)?.isVisible()) this.reset(site);
    }
  }

  /** Drops the hidden window so the next request starts from fresh cookies (after sign-out). */
  reset(site: BrowserSite): void {
    const win = this.windows.get(site);
    this.windows.delete(site);
    if (win && !win.isDestroyed()) win.destroy();
  }

  private async load(url: string): Promise<HttpResponse> {
    const site = siteForUrl(url);
    if (!site) throw new Error(`No browser session for ${url}`);
    const win = this.window(site);
    const wc = win.webContents;

    let status = 0;
    const onNavigate = (_e: unknown, _url: string, code: number): void => {
      if (code) status = code;
    };
    wc.on('did-navigate', onNavigate);
    try {
      await navigate(wc, url);

      // A challenge page replaces itself once passed, so wait for a parsed, non-challenge document.
      const deadline = Date.now() + CHALLENGE_TIMEOUT_MS;
      let page = await pageState(wc);
      while ((page.loading || isChallengePage(page.html)) && Date.now() < deadline) {
        await sleep(1000);
        page = await pageState(wc);
      }
      if (isChallengePage(page.html)) {
        wc.stop();
        this.onVerificationNeeded?.(site);
        throw new VerificationRequiredError(SITES[site].label);
      }
      if (page.loading) {
        wc.stop();
        throw new Error(`Timed out loading ${url}`);
      }
      return { status: status || 200, url: wc.getURL(), body: page.html, headers: {} };
    } finally {
      wc.off('did-navigate', onNavigate);
    }
  }

  /** Runs a script in a page of the site (loading `pageUrl` first if needed), queued like other requests. */
  runInPage<T>(pageUrl: string, script: string): Promise<T> {
    return this.queue.run(pageUrl, () => this.evaluate<T>(pageUrl, script));
  }

  /**
   * Fetches `url` from inside the site's page. HTML comes back as text; for
   * anything else only the status and type are returned (the body is not read),
   * so probing a download link never triggers a download.
   */
  probeInPage(pageUrl: string, url: string): Promise<{ status: number; type: string; body: string }> {
    return this.runInPage(
      pageUrl,
      `fetch(${JSON.stringify(url)}, { credentials: 'include' }).then(async (r) => {
        const type = r.headers.get('content-type') || '';
        if (!type.includes('text/html')) { if (r.body) r.body.cancel(); return { status: r.status, type, body: '' }; }
        return { status: r.status, type, body: await r.text() };
      })`,
    );
  }

  private async evaluate<T>(pageUrl: string, script: string): Promise<T> {
    const site = siteForUrl(pageUrl);
    if (!site) throw new Error(`No browser session for ${pageUrl}`);
    const win = this.window(site);
    if (!win.webContents.getURL().startsWith(new URL(pageUrl).origin)) await this.load(pageUrl);
    return (await win.webContents.executeJavaScript(script, true)) as T;
  }

  private fetchInPage(pageUrl: string, apiUrl: string): Promise<{ status: number; body: string }> {
    return this.evaluate(
      pageUrl,
      `fetch(${JSON.stringify(apiUrl)}, { credentials: 'include', headers: { Accept: 'application/vnd.api+json' } })
        .then(async (r) => ({ status: r.status, body: await r.text() }))`,
    );
  }
}

/**
 * Starts a navigation and resolves once the main document is parsed. Waiting
 * for every image and embed is slow, and dead embeds can stall a page for good.
 */
function navigate(wc: WebContents, url: string): Promise<void> {
  wc.stop(); // never let a previous, stalled page redirect over this one
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      wc.off('dom-ready', onReady);
      wc.off('did-fail-load', onFail);
      wc.off('destroyed', onDestroyed);
    };
    const onDestroyed = (): void => {
      cleanup();
      reject(new CancelledError());
    };
    const onReady = (): void => {
      cleanup();
      resolve();
    };
    const onFail = (_e: unknown, code: number, description: string, failedUrl: string, isMainFrame: boolean): void => {
      // -3 (ERR_ABORTED): superseded by a redirect, e.g. a challenge passing.
      if (!isMainFrame || code === -3) return;
      cleanup();
      reject(new Error(`${description || 'Load failed'} (${code}) loading ${failedUrl}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      wc.stop();
      reject(new Error(`Timed out loading ${url}`));
    }, LOAD_TIMEOUT_MS);
    wc.on('dom-ready', onReady);
    wc.on('did-fail-load', onFail);
    wc.once('destroyed', onDestroyed);
    // Outcome is tracked through the events above; the promise also rejects on aborts.
    wc.loadURL(url).catch(() => undefined);
  });
}

async function pageState(wc: WebContents): Promise<{ html: string; loading: boolean }> {
  if (wc.isDestroyed()) throw new CancelledError();
  try {
    return (await wc.executeJavaScript(
      '({ html: document.documentElement.outerHTML, loading: document.readyState === "loading" })',
      true,
    )) as { html: string; loading: boolean };
  } catch {
    // The document is being replaced mid-navigation.
    return { html: '', loading: true };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
