import { BrowserWindow, dialog, type WebContents } from 'electron';
import type { AccountStatus } from '../shared/api.js';
import { t } from '../shared/i18n/index.js';
import { type BrowserPool, type BrowserSite, browserUserAgent, SITES, siteSession, useSiteSession } from './browser.js';
import { openUrl } from './open.js';
import { afterNavigation, PASSWORD_HELP } from './sign-in-provider.js';

export async function accountStatus(site: BrowserSite): Promise<AccountStatus> {
  const { origin, sessionCookie, label } = SITES[site];
  const cookies = await siteSession(site).cookies.get({ url: origin, name: sessionCookie });
  const value = cookies[0]?.value;
  return { site, label, signedIn: Boolean(value && value !== '0') };
}

/**
 * Opens the site's own login page in the site's session. The app never sees
 * the password; it only keeps the cookies the site sets. Resolves when the
 * window closes.
 */
export function signIn(site: BrowserSite, parent?: BrowserWindow): Promise<AccountStatus> {
  const win = new BrowserWindow({
    width: 520,
    height: 760,
    parent,
    modal: false,
    title: t().main.signInTitle(SITES[site].label),
    autoHideMenuBar: true,
    webPreferences: { session: useSiteSession(site), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  const guide = new SignInGuide(site, win);
  guide.watch(win, win.webContents);
  void win.loadURL(SITES[site].loginUrl);

  return new Promise((resolve) => {
    const poll = setInterval(() => {
      void accountStatus(site).then((status) => {
        if (status.signedIn && !win.isDestroyed()) win.close();
      });
    }, 1500);
    win.on('closed', () => {
      clearInterval(poll);
      void accountStatus(site).then(resolve);
    });
  });
}

/**
 * Watches a sign-in window, and the pop-ups it opens, for the one screen the
 * user can't get past by themselves: the sign-in service saying it won't run
 * inside an app. Says what to do instead, and does it.
 */
class SignInGuide {
  /**
   * Which windows have been told, latched while each sits on the dead end, so
   * it's said once per window rather than once per navigation event. Per window,
   * not per sign-in: going back to the login page in one window shouldn't make a
   * pop-up left open on Google eligible to interrupt again.
   */
  private explained = new WeakSet<WebContents>();
  /** Never two of these at once, however many windows are in the same state. */
  private asking = false;

  constructor(
    private readonly site: BrowserSite,
    private readonly main: BrowserWindow,
  ) { }

  /**
   * Sign-in pop-ups stay real windows of the same session. "Continue with
   * Google" and the like open one and wait for it to report back through
   * window.opener; loading it over the page that opened it instead leaves that
   * page waiting for a window that never existed.
   */
  watch(win: BrowserWindow, wc: WebContents): void {
    wc.setUserAgent(browserUserAgent());
    wc.setWindowOpenHandler(({ url }) => {
      if (!/^https:\/\//i.test(url)) return { action: 'deny' };
      // Session and hardening are inherited from the window that opened it.
      return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 700, parent: this.main, autoHideMenuBar: true } };
    });
    wc.on('did-create-window', (child) => {
      // That inheritance is what keeps a sign-in inside the site's own session, where its cookies
      // are cleared on exit like the rest. If a future Electron ever stops doing it, the pop-up
      // would quietly sign in somewhere we don't clear: close it rather than let that happen.
      if (child.webContents.session !== wc.session) {
        console.warn('Sign-in pop-up opened outside the site session; closing it.');
        child.close();
        return;
      }
      this.watch(child, child.webContents);
    });
    const onNavigate = (url: string): void => {
      // Explained on reaching Google's sign-in rather than its refusal page: waiting for the
      // refusal would miss the times it never loads.
      const { forget, explain } = afterNavigation(url, this.explained.has(wc));
      if (forget) this.explained.delete(wc);
      if (explain) this.explain(win, wc);
    };
    wc.on('did-navigate', (_event, url) => onNavigate(url));
    // Unlike did-navigate, this one also fires for frames inside the page — and the
    // site's login page embeds Google's button in one.
    wc.on('did-redirect-navigation', (details) => {
      if (details.isMainFrame) onNavigate(details.url);
    });
    // Addresses a navigation event can miss: a pop-up's first page, which can load before this
    // watch is attached, and pages that change their address without loading. Read by address, as
    // above, never by what the page says: Google words its refusal in the user's own language.
    wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) onNavigate(url);
    });
    wc.on('did-finish-load', () => {
      if (!wc.isDestroyed()) onNavigate(wc.getURL());
    });
  }

  private explain(win: BrowserWindow, wc: WebContents): void {
    if (this.asking || this.explained.has(wc)) return;
    this.explained.add(wc);
    this.asking = true;
    void this.offerPassword(win)
      .catch(() => undefined)
      .finally(() => {
        this.asking = false;
      });
  }

  private async offerPassword(win: BrowserWindow): Promise<void> {
    const { label, loginUrl } = SITES[this.site];
    const target = win.isDestroyed() ? this.main : win;
    if (target.isDestroyed()) return;
    const m = t().main;
    const { response } = await dialog.showMessageBox(target, {
      type: 'info',
      title: m.googleTitle,
      message: m.googleMessage,
      detail: m.googleDetail(label, this.site === 'patreon' ? m.passwordPath.patreon : m.passwordPath.other),
      buttons: [m.googleOpen(label), m.googleBack(label), m.googleLeave],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (response === 0) {
      await openUrl(PASSWORD_HELP[this.site] ?? loginUrl).catch(() => undefined);
      return;
    }
    // "Leave it open" changes nothing, in case this is one of the times it does go through.
    if (response !== 1) return;
    if (win !== this.main && !win.isDestroyed()) win.close();
    if (!this.main.isDestroyed()) void this.main.loadURL(loginUrl);
  }
}

export async function signOut(site: BrowserSite, pool: BrowserPool): Promise<AccountStatus> {
  pool.reset(site);
  await siteSession(site).clearStorageData();
  return accountStatus(site);
}
