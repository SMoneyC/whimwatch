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
import { SiteAccess, type SiteBrowser } from './site-access.js';

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
/** How often the open verification window is looked at to see whether the check has passed. */
const VERIFICATION_POLL_MS = 1000;
/** How long to keep looking, so a window left open all day doesn't poll all day. */
const VERIFICATION_WATCH_MS = 10 * 60 * 1000;

export function siteForUrl(url: string): BrowserSite | undefined {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    // A window that failed to load has no address worth the name.
    return undefined;
  }
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
export class BrowserPool implements SiteBrowser {
  private windows = new Map<BrowserSite, BrowserWindow>();
  private http = createNodeFetcher(new HostQueue(politeGap));
  private disposing = false;
  private filteredSessions = new WeakSet<Session>();
  /** Whose turn it is, and which sites are waiting for a human check. Testable without a browser. */
  private access = new SiteAccess(this, { onVerificationNeeded: (site) => this.onVerificationNeeded?.(site) });
  /** Sites whose window is open for the user to pass a check in, with what it takes to stop watching. */
  private watchers = new Map<
    BrowserSite,
    {
      timer: NodeJS.Timeout;
      win: BrowserWindow;
      onClose: () => void;
      onStart: (details: { isMainFrame: boolean }) => void;
      onFail: (event: unknown, code: number, description: string, url: string, isMainFrame: boolean) => void;
    }
  >();
  /** Called when a site needs the user to complete a challenge. */
  onVerificationNeeded?: (site: BrowserSite) => void;
  /** Called once the user has passed it and the site can be used again. */
  onVerificationPassed?: (site: BrowserSite) => void;

  fetcher(): Fetcher {
    return this.access.fetcher(this.http, siteForUrl);
  }

  /** What a page of this site is called when something has to be said about it. */
  label(site: BrowserSite): string {
    return SITES[site].label;
  }

  /** Whether the site's window is on screen, i.e. the user is working in it. */
  onScreen(site: BrowserSite): boolean {
    const win = this.windows.get(site);
    return Boolean(win && !win.isDestroyed() && win.isVisible());
  }

  /**
   * Lets the sites be tried again, e.g. when the user starts a new check. A site
   * whose window is open for the user to work in keeps its hold: the check they
   * started is why it's on screen.
   */
  clearVerification(site?: BrowserSite): void {
    const sites = site ? [site] : [...ALL_SITES];
    for (const s of sites) if (!this.watchers.has(s)) this.access.clearVerification(s);
  }

  /** Says it again next time the site is held back, after the user waved the notice away. */
  remindVerification(site: BrowserSite): void {
    this.access.remindVerification(site);
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

  /**
   * Reveals the site's window so the user can pass a challenge by hand. It
   * starts on the site's own front page, not the creator page the check stopped
   * on: passing clears the whole site, and a creator's page has no business
   * being put on screen.
   */
  showVerification(site: BrowserSite): void {
    const win = this.window(site);
    win.show();
    win.focus();
    // Now that it's visible, images and challenge widgets aren't skipped.
    void win.loadURL(SITES[site].origin).catch(() => undefined);
    this.watchVerification(site, win);
  }

  /**
   * Watches the open window until the challenge is gone, then puts the window
   * away and lets the site be used again. A check that is still running carries
   * on with that site by itself.
   *
   * Watching ends when the user closes the window, not when it stops being
   * visible: minimizing it is not giving up, and what isVisible() makes of a
   * minimized window differs by platform.
   */
  private watchVerification(site: BrowserSite, win: BrowserWindow): void {
    this.stopWatching(site);
    const wc = win.webContents;
    // Closed without passing: the next check the user starts tries the site again.
    const onClose = (): void => this.stopWatching(site);
    // Chromium's own error page keeps the address it failed to reach and holds no challenge, so
    // without this it reads as a page of the site with nothing wrong: passed. It isn't.
    let failed = false;
    const onStart = (details: { isMainFrame: boolean }): void => {
      if (details.isMainFrame) failed = false;
    };
    const onFail = (_e: unknown, code: number, _desc: string, _url: string, isMainFrame: boolean): void => {
      // -3 (ERR_ABORTED): superseded by another navigation, e.g. a challenge passing.
      if (isMainFrame && code !== -3) failed = true;
    };
    win.on('close', onClose);
    wc.on('did-start-navigation', onStart);
    wc.on('did-fail-load', onFail);
    const deadline = Date.now() + VERIFICATION_WATCH_MS;
    const timer = setInterval(() => {
      if (win.isDestroyed() || Date.now() > deadline) {
        this.stopWatching(site);
        return;
      }
      if (failed) return;
      void pageState(wc).then(
        (page) => {
          if (win.isDestroyed() || !this.watchers.has(site) || failed) return;
          // A page of the site, parsed, with no challenge on it. Anything else — a challenge
          // still running, a page from somewhere else — is not proof of passing.
          if (page.loading || isChallengePage(page.html) || siteForUrl(wc.getURL()) !== site) return;
          this.stopWatching(site);
          this.access.clearVerification(site);
          win.hide();
          this.onVerificationPassed?.(site);
        },
        () => undefined,
      );
    }, VERIFICATION_POLL_MS);
    this.watchers.set(site, { timer, win, onClose, onStart, onFail });
  }

  private stopWatching(site: BrowserSite): void {
    const watcher = this.watchers.get(site);
    if (!watcher) return;
    clearInterval(watcher.timer);
    if (!watcher.win.isDestroyed()) {
      watcher.win.off('close', watcher.onClose);
      watcher.win.webContents.off('did-start-navigation', watcher.onStart);
      watcher.win.webContents.off('did-fail-load', watcher.onFail);
    }
    this.watchers.delete(site);
  }

  dispose(): void {
    this.disposing = true;
    for (const site of [...this.watchers.keys()]) this.stopWatching(site);
    for (const win of this.windows.values()) if (!win.isDestroyed()) win.destroy();
    this.windows.clear();
  }

  /** Cancels queued requests and closes the hidden windows so in-flight page loads stop now. */
  cancelAll(): void {
    this.access.cancelPending();
    for (const site of [...this.windows.keys()]) {
      if (!this.windows.get(site)?.isVisible()) this.reset(site);
    }
  }

  /**
   * Drops the hidden window so the next request starts from fresh cookies (after
   * sign-out, or when a check is cancelled). The site starts over in every
   * sense, so any hold on it goes too: otherwise cancelling a check left the
   * site held back with nothing on screen to act on.
   */
  reset(site: BrowserSite): void {
    const win = this.windows.get(site);
    this.windows.delete(site);
    this.stopWatching(site);
    this.access.clearVerification(site);
    if (win && !win.isDestroyed()) win.destroy();
  }

  /**
   * Loads the page in the site's window and returns it once parsed. Whether it
   * should be loaded at all was decided before this was called (see SiteAccess);
   * a challenge that outlasts its welcome is reported as one there too.
   */
  async loadPage(site: BrowserSite, url: string): Promise<HttpResponse> {
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
      // Still a challenge after all that waiting: stop, and let SiteAccess make it a
      // VerificationRequiredError and hold the site back.
      if (page.loading && !isChallengePage(page.html)) {
        wc.stop();
        throw new Error(`Timed out loading ${url}`);
      }
      if (isChallengePage(page.html)) wc.stop();
      return { status: status || 200, url: wc.getURL(), body: page.html, headers: {} };
    } finally {
      wc.off('did-navigate', onNavigate);
    }
  }

  /** Runs a script in a page of the site (loading `pageUrl` first if needed), queued like other requests. */
  runInPage<T>(pageUrl: string, script: string): Promise<T> {
    return this.access.runInPage<T>(siteForUrl(pageUrl), pageUrl, script);
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

  /**
   * Runs a script in a page of the site, loading it first if the window is
   * elsewhere. Whether the site may be touched at all was decided in SiteAccess,
   * including for the load this may need.
   */
  async runScript<T>(site: BrowserSite, pageUrl: string, script: string): Promise<T> {
    const win = this.window(site);
    if (!win.webContents.getURL().startsWith(new URL(pageUrl).origin)) {
      const page = await this.loadPage(site, pageUrl);
      // The page it landed on is a challenge: nothing run in it would mean anything.
      if (isChallengePage(page.body)) {
        this.access.requestVerification(site);
        throw new VerificationRequiredError(SITES[site].label);
      }
    }
    return (await win.webContents.executeJavaScript(script, true)) as T;
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
