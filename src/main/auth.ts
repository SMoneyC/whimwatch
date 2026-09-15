import { BrowserWindow } from 'electron';
import type { AccountStatus } from '../shared/api.js';
import { type BrowserPool, type BrowserSite, browserUserAgent, SITES, siteSession, useSiteSession } from './browser.js';

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
    title: `Sign in to ${SITES[site].label}`,
    autoHideMenuBar: true,
    webPreferences: { session: useSiteSession(site), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  win.webContents.setUserAgent(browserUserAgent());
  win.webContents.setWindowOpenHandler(({ url }) => {
    // OAuth pop-ups (e.g. "Continue with Google") stay inside the same session.
    void win.loadURL(url);
    return { action: 'deny' };
  });
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

export async function signOut(site: BrowserSite, pool: BrowserPool): Promise<AccountStatus> {
  pool.reset(site);
  await siteSession(site).clearStorageData();
  return accountStatus(site);
}
