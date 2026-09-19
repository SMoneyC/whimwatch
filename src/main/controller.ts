import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  type BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  Menu,
  type MenuItemConstructorOptions,
  nativeTheme,
  Notification,
  safeStorage,
} from 'electron';
import { isNewerRelease, latestRelease } from '../core/app-update.js';
import { dirSize, expiredBackups, hasLiveBackup, listDirNames, orphanBackupDirs, removeDir } from '../core/backups.js';
import { CORE_KEY, coreResult, markSeenPages, runCheck, unrecognizedFiles } from '../core/check.js';
import { creatorStatus, isNewer, outdatedRemotes, seenUpTo } from '../core/compare.js';
import { groupByCreator } from '../core/creators.js';
import { datePacks } from '../core/ownership.js';
import { BUNDLED_OVERRIDES, loadOverrides, type Overrides } from '../core/overrides.js';
import { filesFromCache, rescanPaths, type ScanCache, scanDirs } from '../core/scanner.js';
import { classifyUrl, linkKey, linkProblem, normalizeUserUrl } from '../core/sources/urls.js';
import { APP_ID, REPO_SLUG } from '../shared/config.js';
import { type AppState, loadScanCache, loadState, SaveQueue, saveState, writeJsonAtomic } from '../core/store.js';
import {
  type AccountStatus,
  type AppEvent,
  type AppSnapshot,
  type BatchState,
  type BrowserSite,
  EVENT_CHANNEL,
  type FolderPreview,
  type OtherFile,
} from '../shared/api.js';
import { applyMutedSources } from '../shared/muted.js';
import {
  type AppSettings,
  type CheckProgress,
  type CheckResult,
  type CreatorStatus,
  type InstallRecord,
  type LocalFile,
  type RemoteInfo,
  type SeenEvent,
  UPDATE_SITES,
  type UpdateSite,
} from '../shared/types.js';
import { SOURCE_LABEL } from '../shared/labels.js';
import { accountStatus, signIn, signOut } from './auth.js';
import { BrowserPool, configureSiteSessions, siteSessionsPersist } from './browser.js';
import { describeModsDirs, detectModsDirs } from './modsdir.js';
import { installedBrowsers, openPrivate } from './browsers.js';
import { recentLogLines } from './log.js';
import { openFolder, openUrl, revealFile } from './open.js';
import { removeAfterExit } from './privacy.js';

/** One "mark as seen": a whole creator, or one page of theirs. */
interface SeenMark {
  key: string;
  /** A listing URL when the mark is about that pack alone. */
  page?: string;
  at: number;
}

export class AppController {
  readonly pool = new BrowserPool();
  /** Runs after each successful check (used for automatic installs). */
  afterCheck?: (result: CheckResult) => Promise<void>;
  /** Whether an update is downloading or installing (backups must not be touched then). */
  updatesBusy: () => boolean = () => false;
  private state!: AppState;
  private running = false;
  private progress?: CheckProgress;
  private window?: BrowserWindow;
  private overrides: Overrides = BUNDLED_OVERRIDES;
  private accounts: AccountStatus[] = [];
  private batch?: BatchState;
  private checkAbort?: AbortController;
  private checkMessage?: AppSnapshot['checkMessage'];
  private saves = new SaveQueue();
  private scanCache: ScanCache = {};
  private scanCacheSaves = new SaveQueue();
  /** Last send time per throttled event stream. */
  private lastEmit = new Map<string, number>();
  /** Text shown in the diagnostics preview; copy and save use exactly this. */
  private diagnostics?: string;
  private weakCookieStorage = false;
  /** Set once the user confirmed "Remove all data": nothing else should run on the way out. */
  removingData = false;
  /** The link removed last, so its toast can put it back. */
  private lastRejected?: { key: string; url: string; wasManual: boolean; remotes: RemoteInfo[] };
  private registeredShortcut?: string;

  private constructor(
    private readonly statePath: string,
    /** Each update gets its own subfolder here. */
    readonly backupRoot: string,
  ) {}

  static async create(statePath: string, backupRoot: string): Promise<AppController> {
    const controller = new AppController(statePath, backupRoot);
    controller.scanCache = await loadScanCache(controller.scanCachePath, statePath);
    controller.state = await loadState(statePath);
    controller.pool.onVerificationNeeded = (site) => controller.emit({ type: 'verification-needed', site });
    controller.pool.onVerificationPassed = (site) => controller.emit({ type: 'verification-passed', site });
    controller.weakCookieStorage = weakCookieStorage();
    await controller.refreshAccounts();
    return controller;
  }

  isSignedIn(site: BrowserSite): boolean {
    return this.accounts.some((a) => a.site === site && a.signedIn);
  }

  private async refreshAccounts(): Promise<AccountStatus[]> {
    this.accounts = await Promise.all((['loverslab', 'patreon'] as const).map(accountStatus));
    return this.accounts;
  }

  attachWindow(win: BrowserWindow): void {
    this.window = win;
    this.applyWindowSettings();
    // The page's own focus events can go missing (e.g. when the window is already active before it
    // loads), which left the privacy screen up until the user switched away and back.
    win.on('focus', () => this.emit({ type: 'window-focus', focused: true }));
    win.on('blur', () => this.emit({ type: 'window-focus', focused: false }));
    win.once('closed', () => {
      if (this.window === win) this.window = undefined;
    });
  }

  isWindowFocused(): boolean {
    return Boolean(this.window && !this.window.isDestroyed() && this.window.isFocused());
  }

  /** Follows the theme setting everywhere, including the window background before the page paints. */
  applyTheme(): void {
    nativeTheme.themeSource = this.state.settings.theme;
  }

  /** The privacy screen also keeps the window out of screenshots and screen sharing (Windows and macOS). */
  private applyWindowSettings(): void {
    if (this.window && !this.window.isDestroyed()) this.window.setContentProtection(this.state.settings.privacyScreen);
  }

  /** Registers (or drops) the system-wide quick-hide shortcut. Throws if the shortcut can't be used. */
  applyQuickHide(): void {
    if (this.registeredShortcut) globalShortcut.unregister(this.registeredShortcut);
    this.registeredShortcut = undefined;
    const { quickHide, quickHideShortcut } = this.state.settings;
    if (!quickHide) return;
    let registered: boolean;
    try {
      registered = globalShortcut.register(quickHideShortcut, () => this.toggleHidden());
    } catch {
      registered = false;
    }
    if (!registered) throw new Error("That shortcut is already used by another app or can't be used. Choose a different one.");
    this.registeredShortcut = quickHideShortcut;
  }

  /** Quick hide: out of sight at once (not even in the taskbar); the same shortcut or reopening WhimWatch brings it back. */
  toggleHidden(): void {
    const win = this.window;
    if (!win || win.isDestroyed()) return;
    if (win.isVisible() && !win.isMinimized()) {
      win.hide();
      this.emit({ type: 'hidden' });
    } else {
      win.show();
      win.focus();
    }
  }

  emit(event: AppEvent): void {
    if (this.throttled(event)) return;
    // While a window closes, Windows can still report a blur after its page is gone, and sending to
    // that page throws "Object has been destroyed" as an error dialog.
    const win = this.window;
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send(EVENT_CHANNEL, event);
  }

  /**
   * Scans and downloads report progress per file or chunk, thousands of times a
   * second. Send at most ~10 per second per stream, but never drop a change of
   * phase/stage or a finish.
   */
  private throttled(event: AppEvent): boolean {
    let stream: string;
    let boundary: boolean;
    if (event.type === 'progress') {
      stream = `check:${event.progress.phase}`;
      boundary = event.progress.phase === 'done' || event.progress.done <= 1 || event.progress.done === event.progress.total;
    } else if (event.type === 'update-progress') {
      stream = `update:${event.progress.creatorKey}:${event.progress.stage}`;
      boundary = event.progress.stage !== 'downloading';
    } else {
      return false;
    }
    const now = Date.now();
    if (!boundary && now - (this.lastEmit.get(stream) ?? 0) < 100) return true;
    this.lastEmit.set(stream, now);
    return false;
  }

  private get scanCachePath(): string {
    return join(dirname(this.statePath), 'scan-cache.json');
  }

  private saveScanCache(): Promise<void> {
    const cache = this.scanCache;
    return this.scanCacheSaves.run(() => writeJsonAtomic(this.scanCachePath, cache));
  }

  setBatch(batch: BatchState): void {
    this.batch = batch;
    this.emit({ type: 'batch', batch });
    // Progress on the taskbar icon, so "Run in background" still shows how far it got.
    if (this.window && !this.window.isDestroyed()) {
      const finished = batch.items.filter((i) => i.state !== 'queued' && i.state !== 'working').length;
      this.window.setProgressBar(batch.running ? Math.max(0.02, finished / Math.max(1, batch.items.length)) : -1);
    }
  }

  async snapshot(): Promise<AppSnapshot> {
    const s = this.state;
    return {
      appVersion: app.getVersion(),
      dirs: s.dirs,
      settings: s.settings,
      lastResult: s.lastResult,
      running: this.running,
      progress: this.progress,
      accounts: await this.refreshAccounts(),
      installs: s.installs,
      manualLinks: Object.fromEntries(Object.entries(s.linkPrefs).map(([k, v]) => [k, v.manual])),
      rejectedLinks: Object.fromEntries(Object.entries(s.linkPrefs).map(([k, v]) => [k, v.rejected])),
      creatorMutedSources: Object.fromEntries(Object.entries(s.linkPrefs).flatMap(([k, v]) => (v.mutedSources?.length ? [[k, v.mutedSources]] : []))),
      browsers: (await installedBrowsers()).map(({ id, name, privateLabel, isDefault }) => ({ id, name, privateLabel, isDefault })),
      backupRoot: this.backupRoot,
      batch: this.batch,
      checkMessage: this.checkMessage,
      appUpdate: isNewerRelease(s.appRelease, app.getVersion())
        ? { version: s.appRelease!.version, url: s.appRelease!.url, hidden: s.appRelease!.version === s.dismissedAppVersion || undefined }
        : undefined,
      // With no appUpdate beside it, this is when WhimWatch last found nothing newer.
      appUpdateCheckedAt: s.appRelease?.checkedAt,
      dismissedGameWarnings: s.dismissedGameWarnings,
      sessionsInMemory: !siteSessionsPersist(),
      weakCookieStorage: this.weakCookieStorage,
      seenHistory: s.seenHistory,
      firstCheckNotice: s.firstCheckNotice,
      platform: process.platform === 'win32' || process.platform === 'darwin' ? process.platform : 'linux',
    };
  }

  /** Persists state and pushes a fresh snapshot to the window. */
  async commit(): Promise<AppSnapshot> {
    if (!this.removingData) await this.saves.run(() => saveState(this.statePath, this.state));
    const snapshot = await this.snapshot();
    this.emit({ type: 'snapshot', snapshot });
    return snapshot;
  }

  get currentState(): AppState {
    return this.state;
  }

  /**
   * Looks for a newer WhimWatch release: on launch at most once a day, and
   * whenever the user asks. `force` is that ask, so it ignores both the
   * once-a-day gate and the setting — a button that quietly does nothing for
   * 24 hours, or because a setting they didn't come here to change is off, is
   * the failure this release spent its time removing. It also reports a
   * failure rather than swallowing it, and un-hides a version waved away
   * earlier: asking again is asking about whatever is out there now. The
   * automatic check stays off when the setting is off.
   */
  async checkAppUpdate(force = false): Promise<AppSnapshot> {
    const last = this.state.appRelease?.checkedAt ?? 0;
    if (!force && (!this.state.settings.checkAppUpdates || Date.now() - last < 24 * 60 * 60 * 1000)) return this.snapshot();
    try {
      const release = await latestRelease(REPO_SLUG);
      this.state.appRelease = release ? { ...release, checkedAt: Date.now() } : { version: '0', url: '', checkedAt: Date.now() };
      if (force) this.state.dismissedAppVersion = undefined;
      return await this.commit();
    } catch (err) {
      const message = (err as Error).message;
      if (force) throw new Error(`Couldn't ask GitHub for the latest version: ${message}`, { cause: err });
      console.warn('App update check failed:', message);
      return this.snapshot();
    }
  }

  async dismissAppUpdate(version: unknown): Promise<AppSnapshot> {
    if (typeof version === 'string') this.state.dismissedAppVersion = version;
    return this.commit();
  }

  async maybeCheckOnLaunch(): Promise<void> {
    const { settings, dirs, lastResult } = this.state;
    if (!settings.checkOnLaunch || !dirs.length) return;
    if (lastResult && Date.now() - lastResult.finishedAt < settings.recheckAfterMinutes * 60_000) return;
    await this.startCheck();
  }

  async startCheck(): Promise<void> {
    if (this.running || !this.state.dirs.length) return;
    this.running = true;
    this.progress = { phase: 'scan', done: 0, total: 0, message: 'Starting' };
    const abort = (this.checkAbort = new AbortController());
    this.checkMessage = undefined;
    // A site that wanted a human check last time is worth trying again now.
    this.pool.clearVerification();
    await this.commit();
    try {
      const fetcher = this.pool.fetcher();
      this.overrides = await loadOverrides(fetcher).catch(() => BUNDLED_OVERRIDES);
      const { result, scanCache, discoveryCache } = await runCheck({
        dirs: this.state.dirs,
        fetcher,
        overrides: this.overrides,
        scanCache: this.scanCache,
        linkPrefs: this.state.linkPrefs,
        dismissed: this.state.dismissed,
        discoveryCache: this.state.discovery,
        mutedSources: this.state.settings.mutedSources,
        onProgress: (progress) => {
          this.progress = progress;
          this.emit({ type: 'progress', progress });
        },
        onCreator: (creator) => this.emit({ type: 'creator', creator }),
        signal: abort.signal,
      });
      const first = !this.state.lastResult;
      this.state.lastResult = result;
      // In case a site was turned off while the check ran.
      applyMutedSources(result, this.state.settings.mutedSources, this.creatorMutedSources());
      this.refreshStatuses();
      // The first check flags hand-installed packs as updates; the home screen explains that once.
      this.state.firstCheckNotice = first && result.creators.some((c) => c.status === 'update-available');
      this.scanCache = scanCache;
      await this.saveScanCache();
      this.state.discovery = discoveryCache;
      this.notifyUpdates(result);
    } catch (err) {
      // The previous results stay: nothing is saved from an interrupted or failed check.
      if (abort.signal.aborted) {
        this.checkMessage = { tone: 'info', text: 'Check cancelled. Showing the results from the previous check.' };
      } else {
        console.error('Check failed', err);
        this.checkMessage = { tone: 'error', text: `Check failed: ${(err as Error).message}` };
      }
    } finally {
      this.running = false;
      this.checkAbort = undefined;
      this.progress = undefined;
      await this.commit();
    }
    const result = this.state.lastResult;
    if (this.checkMessage) return;
    if (this.state.settings.autoInstall && result && this.afterCheck) await this.afterCheck(result);
  }

  cancelCheck(): void {
    if (!this.checkAbort) return;
    this.checkAbort.abort();
    this.pool.cancelAll();
  }

  async recordInstall(record: InstallRecord): Promise<AppSnapshot> {
    this.state.installs = [...this.state.installs, record].slice(-50);
    await this.rescanLocal(record.operations.map((o) => o.target));
    await this.pruneBackups();
    return this.commit();
  }

  /**
   * Deletes backups older than the "keep backups" setting, plus backup folders
   * no record points to (e.g. records beyond the 50 kept).
   */
  async pruneBackups(): Promise<void> {
    const now = Date.now();
    for (const record of expiredBackups(this.state.installs, this.state.settings.keepBackupsDays, now)) {
      await removeDir(record.backupDir);
      record.backupDeletedAt = now;
    }
    const names = await listDirNames(this.backupRoot);
    for (const dir of orphanBackupDirs(names, this.backupRoot, this.state.installs, now, 60 * 60 * 1000)) await removeDir(dir);
  }

  async clearBackups(): Promise<AppSnapshot> {
    if (this.updatesBusy()) throw new Error('Wait for the current update to finish first.');
    const now = Date.now();
    for (const record of this.state.installs.filter(hasLiveBackup)) {
      await removeDir(record.backupDir);
      record.backupDeletedAt = now;
    }
    for (const dir of orphanBackupDirs(await listDirNames(this.backupRoot), this.backupRoot, [], now)) await removeDir(dir);
    return this.commit();
  }

  async replaceInstall(record: InstallRecord): Promise<AppSnapshot> {
    this.state.installs = this.state.installs.map((i) => (i.id === record.id ? record : i));
    await this.rescanLocal(record.operations.map((o) => o.target));
    return this.commit();
  }

  /**
   * Re-reads local files after an install or undo, keeping the last remote
   * results. Only the changed paths are looked at when the cache allows it.
   */
  private async rescanLocal(changedPaths: string[]): Promise<void> {
    const result = this.state.lastResult;
    if (!result) return;
    let files: LocalFile[];
    const cached = filesFromCache(this.scanCache);
    if (cached) {
      this.scanCache = await rescanPaths(changedPaths, this.state.dirs, this.scanCache);
      files = filesFromCache(this.scanCache) ?? cached;
    } else {
      const scan = await scanDirs(this.state.dirs, { cache: this.scanCache });
      this.scanCache = scan.cache;
      files = scan.files;
    }
    await this.saveScanCache();
    const groups = new Map(groupByCreator(files, this.overrides.aliases).map((g) => [g.key, g]));
    for (const creator of result.creators) {
      const group = groups.get(creator.key);
      if (!group) continue;
      creator.files = group.files;
      creator.localUpdatedAt = Math.max(...group.files.map((f) => f.mtimeMs));
      // yoursAt dates each page against the files that came from it, and those files just changed.
      // Left alone it keeps the pre-install date and the page stays flagged for ever.
      creator.remotes = datePacks(group, creator.remotes);
    }
    const core = coreResult(files, undefined, result.core.error, this.state.dismissed[CORE_KEY]);
    Object.assign(result.core, { installed: core.installed, installedFiles: core.installedFiles });
    this.refreshStatuses();
  }

  /**
   * Bug-report details: versions, settings, last check summary and the end of
   * the log. No creator names or page addresses, and the home folder is hidden.
   */
  async getDiagnostics(): Promise<string> {
    const s = this.state;
    const result = s.lastResult;
    const errorsBySource: Record<string, number> = {};
    for (const c of result?.creators ?? []) {
      for (const r of c.remotes) if (r.status !== 'ok') errorsBySource[`${r.listing.source} ${r.status}`] = (errorsBySource[`${r.listing.source} ${r.status}`] ?? 0) + 1;
    }
    const lines = [
      `WhimWatch ${app.getVersion()} · Electron ${process.versions.electron} · Chrome ${process.versions.chrome} · Node ${process.versions.node}`,
      `OS: ${process.platform} ${process.getSystemVersion()} (${process.arch})`,
      `Mods folders: ${describeModsDirs(s.dirs, { home: homedir(), documents: app.getPath('documents'), platform: process.platform })}`,
      `Settings: ${JSON.stringify(s.settings)}`,
      `Signed in: ${this.accounts.map((a) => `${a.label} ${a.signedIn ? 'yes' : 'no'}`).join(', ')} · site sessions ${siteSessionsPersist() ? 'on disk' : 'in memory'}${this.weakCookieStorage ? ' · no keyring' : ''}`,
      result
        ? `Last check: ${new Date(result.finishedAt).toISOString()} · ${result.creators.length} creators · ${result.creators.filter((c) => c.status === 'update-available').length} updates · ${result.unrecognizedCount} other files`
        : 'Last check: none',
      `Source problems: ${JSON.stringify(errorsBySource)}`,
      `Game: ${JSON.stringify(result?.game ?? {})} · WickedWhims ${result?.core.latestVersion ?? '?'}`,
      '',
      'Recent log:',
      ...recentLogLines(40),
    ];
    this.diagnostics = lines.join('\n');
    return this.diagnostics;
  }

  /** Written next to the window's files by the renderer build (scripts/third-party-licenses.ts). */
  async getLicenses(): Promise<string> {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'renderer', 'licenses');
    try {
      const [own, others] = await Promise.all([readFile(join(dir, 'LICENSE.txt'), 'utf8'), readFile(join(dir, 'THIRD_PARTY_LICENSES.txt'), 'utf8')]);
      return `WhimWatch\n\n${own.trim()}\n\n\n${others}`;
    } catch {
      return 'The licence list is created when WhimWatch is built (npm run build). See LICENSE and THIRD_PARTY_NOTICES.md in the source code.';
    }
  }

  async copyDiagnostics(): Promise<void> {
    clipboard.writeText(this.diagnostics ?? (await this.getDiagnostics()));
  }

  async saveDiagnostics(): Promise<boolean> {
    const text = this.diagnostics ?? (await this.getDiagnostics());
    const options = {
      title: 'Save diagnostics',
      defaultPath: join(app.getPath('downloads'), 'whimwatch-diagnostics.txt'),
      filters: [{ name: 'Text', extensions: ['txt'] }],
    };
    const res = this.window ? await dialog.showSaveDialog(this.window, options) : await dialog.showSaveDialog(options);
    if (res.canceled || !res.filePath) return false;
    await writeFile(res.filePath, text, 'utf8');
    return true;
  }

  /**
   * After a confirmation, quits and deletes everything WhimWatch keeps outside
   * the Mods folder: settings, results, sign-ins, browsing data, backups, logs
   * and downloads.
   */
  async removeAllData(updater: { isBusy(): boolean; readonly tempRoot: string }): Promise<void> {
    if (updater.isBusy()) throw new Error('Wait for the current update to finish first.');
    const backups = await dirSize(this.backupRoot);
    const options = {
      type: 'warning' as const,
      title: 'Remove all WhimWatch data',
      message: 'Remove all WhimWatch data from this computer?',
      detail: [
        'WhimWatch will close, then delete:',
        '• settings, check results and your link choices',
        '• LoversLab and Patreon sign-ins and browsing data',
        `• backups of replaced mod files${backups ? ` (${Math.max(1, Math.round(backups / 1024 / 1024))} MB)` : ''}, so past updates can't be undone`,
        '• logs and leftover downloads',
        '',
        'Your Mods folder is not changed. Like any deleted file, these may be recoverable with disk tools until the space is reused.',
      ].join('\n'),
      buttons: ['Remove everything and quit', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    };
    const { response } = this.window ? await dialog.showMessageBox(this.window, options) : await dialog.showMessageBox(options);
    if (response !== 0) return;
    this.removingData = true;
    this.cancelCheck();
    removeAfterExit(dataFolders(this.backupRoot, updater.tempRoot), APP_ID, app.getPath('temp'));
    app.quit();
  }

  /** The files counted as "other" in the last check, listed only when the user expands them. */
  async listOtherFiles(): Promise<OtherFile[]> {
    const files = filesFromCache(this.scanCache) ?? (await scanDirs(this.state.dirs, { cache: this.scanCache })).files;
    return unrecognizedFiles(files, groupByCreator(files, this.overrides.aliases))
      .map((f) => ({ path: f.path, relPath: f.relPath, error: f.error }))
      .sort((a, b) => a.relPath.localeCompare(b.relPath));
  }

  detectModsDirs(): Promise<string[]> {
    return detectModsDirs(app.getPath('documents'));
  }

  async chooseDirectory(): Promise<string | undefined> {
    const options = { title: 'Choose a Mods folder', properties: ['openDirectory' as const] };
    const res = this.window ? await dialog.showOpenDialog(this.window, options) : await dialog.showOpenDialog(options);
    return res.canceled ? undefined : res.filePaths[0];
  }

  async setDirs(dirs: unknown): Promise<AppSnapshot> {
    const list = strings(dirs).filter((d) => existsSync(d));
    this.state.dirs = [...new Set(list)];
    return this.commit();
  }

  async updateSettings(patch: unknown): Promise<AppSnapshot> {
    const p = (patch ?? {}) as Partial<AppSettings>;
    const s = this.state.settings;
    if (typeof p.checkOnLaunch === 'boolean') s.checkOnLaunch = p.checkOnLaunch;
    if (typeof p.checkAppUpdates === 'boolean') s.checkAppUpdates = p.checkAppUpdates;
    if (typeof p.autoInstall === 'boolean') s.autoInstall = p.autoInstall;
    if (typeof p.recheckAfterMinutes === 'number' && p.recheckAfterMinutes >= 0) s.recheckAfterMinutes = Math.round(p.recheckAfterMinutes);
    if (typeof p.privateLinks === 'boolean') s.privateLinks = p.privateLinks;
    if (typeof p.clearBrowsingDataOnExit === 'boolean') s.clearBrowsingDataOnExit = p.clearBrowsingDataOnExit;
    if (typeof p.forgetSignInsOnExit === 'boolean') s.forgetSignInsOnExit = p.forgetSignInsOnExit;
    // Right away when possible (e.g. discreet settings picked during setup, before the first check).
    configureSiteSessions({ persist: !(s.clearBrowsingDataOnExit && s.forgetSignInsOnExit) });
    if (typeof p.notificationNames === 'boolean') s.notificationNames = p.notificationNames;
    if (typeof p.privacyScreen === 'boolean') {
      s.privacyScreen = p.privacyScreen;
      this.applyWindowSettings();
    }
    if (typeof p.hidePageTitles === 'boolean') s.hidePageTitles = p.hidePageTitles;
    if (typeof p.showNewPacks === 'boolean') s.showNewPacks = p.showNewPacks;
    if (p.theme === 'system' || p.theme === 'dark' || p.theme === 'light') {
      s.theme = p.theme;
      this.applyTheme();
    }
    if (typeof p.quickHide === 'boolean' || typeof p.quickHideShortcut === 'string') {
      const before = { quickHide: s.quickHide, quickHideShortcut: s.quickHideShortcut };
      if (typeof p.quickHide === 'boolean') s.quickHide = p.quickHide;
      if (typeof p.quickHideShortcut === 'string' && /^[A-Za-z0-9+]{1,60}$/.test(p.quickHideShortcut)) s.quickHideShortcut = p.quickHideShortcut;
      try {
        this.applyQuickHide();
      } catch (err) {
        Object.assign(s, before);
        this.applyQuickHide();
        throw err;
      }
    }
    if (typeof p.keepBackupsDays === 'number' && p.keepBackupsDays >= 0) {
      s.keepBackupsDays = Math.round(p.keepBackupsDays);
      if (!this.updatesBusy()) await this.pruneBackups();
    }
    if (typeof p.privateBrowser === 'string') {
      const known = (await installedBrowsers()).some((b) => b.id === p.privateBrowser);
      s.privateBrowser = known ? p.privateBrowser : undefined;
    }
    if (Array.isArray(p.mutedSources)) {
      const requested: unknown[] = p.mutedSources;
      s.mutedSources = UPDATE_SITES.filter((site) => requested.includes(site));
      this.applyMuted();
    }
    return this.commit();
  }

  /** Turns one site off or on for one creator only; kept with the creator's link choices. */
  async setCreatorSite(key: unknown, site: unknown, on: unknown): Promise<AppSnapshot> {
    const k = str(key);
    const s = updateSite(site);
    const prefs = this.prefs(k);
    const muted = new Set(prefs.mutedSources);
    if (on === true) muted.delete(s);
    else muted.add(s);
    prefs.mutedSources = UPDATE_SITES.filter((x) => muted.has(x));
    if (!prefs.mutedSources.length) delete prefs.mutedSources;
    this.applyMuted();
    return this.commit();
  }

  private creatorMutedSources(): Record<string, UpdateSite[] | undefined> {
    return Object.fromEntries(Object.entries(this.state.linkPrefs).map(([k, v]) => [k, v.mutedSources]));
  }

  /** Shown right away; a site turned back on is only checked again by the next check. */
  private applyMuted(): void {
    if (!this.state.lastResult) return;
    applyMutedSources(this.state.lastResult, this.state.settings.mutedSources, this.creatorMutedSources());
    this.refreshStatuses();
  }

  async dismiss(key: unknown, remoteUpdatedAt: unknown): Promise<AppSnapshot> {
    const creatorKey = str(key);
    const creator = this.state.lastResult?.creators.find((c) => c.key === creatorKey);
    // Each pack that's behind is marked on its own, so one of them can't bury the others; pages
    // that name no pack of theirs are covered creator-wide, as before.
    const marks: SeenMark[] = outdatedRemotes(creator?.remotes ?? [], creator?.localUpdatedAt ?? 0, creator?.dismissedAt).flatMap((r) =>
      r.yoursAt !== undefined && r.updatedAt !== undefined ? [{ key: creatorKey, page: r.listing.url, at: r.updatedAt }] : [],
    );
    return this.applySeen('one', [...marks, { key: creatorKey, at: Number(remoteUpdatedAt) }]);
  }

  /** Marks updates as seen and records it for History, with what to restore on undo. */
  private async applySeen(kind: SeenEvent['kind'], marks: SeenMark[], automatic = false): Promise<AppSnapshot> {
    const entries: SeenEvent['entries'] = [];
    for (const { key, page, at } of marks) {
      if (!Number.isFinite(at)) continue;
      const seen = page ? (this.state.linkPrefs[key] ??= { rejected: [], manual: [] }).seen ?? {} : undefined;
      const slot = page ? linkKey(page) : key;
      const previous = seen ? seen[slot] : this.state.dismissed[key];
      if (previous === at) continue;
      if (seen) {
        seen[slot] = at;
        this.state.linkPrefs[key]!.seen = seen;
      } else {
        this.state.dismissed[key] = at;
      }
      entries.push({ key, name: this.nameOf(key), page, dismissedAt: at, previous });
    }
    if (entries.length) {
      const event: SeenEvent = { id: randomUUID(), at: Date.now(), kind, entries, automatic: automatic || undefined };
      this.state.seenHistory = [...this.state.seenHistory, event].slice(-50);
    }
    if (kind === 'all') this.state.firstCheckNotice = false;
    this.refreshStatuses();
    return this.commit();
  }

  async undoSeen(id: unknown): Promise<AppSnapshot> {
    const event = this.state.seenHistory.find((e) => e.id === id);
    if (!event || event.undoneAt) throw new Error('That was already undone.');
    for (const entry of event.entries) {
      const seen = entry.page ? this.state.linkPrefs[entry.key]?.seen : undefined;
      const slot = entry.page ? linkKey(entry.page) : entry.key;
      const store = seen ?? (entry.page ? undefined : this.state.dismissed);
      // Only if nothing newer was marked as seen for that page (or creator) since.
      if (!store || store[slot] !== entry.dismissedAt) continue;
      if (entry.previous === undefined) delete store[slot];
      else store[slot] = entry.previous;
    }
    event.undoneAt = Date.now();
    this.refreshStatuses();
    return this.commit();
  }

  async dismissFirstCheckNotice(): Promise<AppSnapshot> {
    this.state.firstCheckNotice = false;
    return this.commit();
  }

  private nameOf(key: string): string {
    return key === CORE_KEY ? 'WickedWhims' : (this.state.lastResult?.creators.find((c) => c.key === key)?.name ?? key);
  }

  /** What setup found in the folders; the scan is cached, so the first check doesn't read the files again. */
  async previewDirs(dirs: unknown): Promise<FolderPreview> {
    const list = strings(dirs).filter((d) => existsSync(d));
    const scan = await scanDirs(list, { cache: this.scanCache });
    this.scanCache = scan.cache;
    await this.saveScanCache();
    const groups = groupByCreator(scan.files, this.overrides.aliases);
    return {
      creators: groups.length,
      wickedWhims: Boolean(coreResult(scan.files, undefined, undefined).installed),
      otherFiles: unrecognizedFiles(scan.files, groups).length,
    };
  }

  /**
   * Marks an update as seen, e.g. when the download matched the installed files.
   * With `listingUrl`, only up to that source's date (and sources posted the same
   * day): a newer post on another site, which may really be newer, still shows.
   */
  async markSeen(key: string, listingUrl?: string, opts: { automatic?: boolean } = {}): Promise<AppSnapshot> {
    const result = this.state.lastResult;
    let at: number | undefined;
    if (key === CORE_KEY) {
      at = result?.core.releasedAt;
    } else {
      const creator = result?.creators.find((c) => c.key === key);
      const page = listingUrl ? creator?.remotes.find((r) => r.listing.url === listingUrl) : undefined;
      // A page that names one pack is marked on its own. Marking it creator-wide would bury every
      // older pack of theirs that is genuinely behind — which is exactly what per-pack dating fixed.
      if (page?.yoursAt !== undefined && page.updatedAt !== undefined) {
        return this.applySeen('one', [{ key, page: page.listing.url, at: page.updatedAt }], opts.automatic);
      }
      const checked = page ? page.updatedAt : creator?.remoteUpdatedAt;
      if (checked !== undefined) at = seenUpTo(creator?.remotes ?? [], checked);
    }
    if (at === undefined) return this.snapshot();
    // Never un-hide something the user already dismissed at a later date.
    return this.applySeen('one', [{ key, at: Math.max(at, this.state.dismissed[key] ?? 0) }], opts.automatic);
  }

  statusOf(key: string): CreatorStatus | undefined {
    const result = this.state.lastResult;
    return key === CORE_KEY ? result?.core.status : result?.creators.find((c) => c.key === key)?.status;
  }

  async dismissGameWarning(id: unknown): Promise<AppSnapshot> {
    const warning = str(id);
    // Ids carry the game version, so old ones never match again; keep the list short.
    this.state.dismissedGameWarnings = [...this.state.dismissedGameWarnings.filter((w) => w !== warning), warning].slice(-20);
    return this.commit();
  }

  /** "Mark all as seen": typically after a first check, when older manual installs look outdated. */
  async dismissAll(): Promise<AppSnapshot> {
    const result = this.state.lastResult;
    const marks: SeenMark[] = [];
    for (const c of result?.creators ?? []) {
      // Creator-wide is enough here: remoteUpdatedAt is the newest page that's behind, so every
      // other page behind it is covered too.
      if (c.status === 'update-available' && c.remoteUpdatedAt !== undefined) marks.push({ key: c.key, at: c.remoteUpdatedAt });
    }
    if (result?.core.status === 'update-available' && result.core.releasedAt !== undefined) marks.push({ key: CORE_KEY, at: result.core.releasedAt });
    return this.applySeen('all', marks);
  }

  async undismiss(key: unknown): Promise<AppSnapshot> {
    delete this.state.dismissed[str(key)];
    delete this.state.linkPrefs[str(key)]?.seen;
    this.refreshStatuses();
    return this.commit();
  }

  async addLink(key: unknown, url: unknown): Promise<AppSnapshot> {
    const link = normalizeUserUrl(str(url));
    const problem = linkProblem(link);
    if (problem) throw new Error(problem);
    const site = classifyUrl(link) as UpdateSite;
    if (this.state.settings.mutedSources.includes(site)) {
      throw new Error(`${SOURCE_LABEL[site]} is turned off in Settings → General. Turn it on there to add this page.`);
    }
    const k = str(key);
    const prefs = this.prefs(k);
    const same = (u: string): boolean => linkKey(u) === linkKey(link);
    prefs.rejected = prefs.rejected.filter((u) => !same(u));
    if (!prefs.manual.some(same)) prefs.manual.push(link);
    // Adding a page on a site turned off for this creator means they want it checked again.
    if (prefs.mutedSources?.includes(site)) return this.setCreatorSite(k, site, true);
    return this.commit();
  }

  async rejectLink(key: unknown, url: unknown): Promise<AppSnapshot> {
    const k = str(key);
    const link = str(url);
    const same = (u: string): boolean => linkKey(u) === linkKey(link);
    const prefs = this.prefs(k);
    const wasManual = prefs.manual.some(same);
    prefs.manual = prefs.manual.filter((u) => !same(u));
    if (!prefs.rejected.some(same)) prefs.rejected.push(link);
    const creator = this.state.lastResult?.creators.find((c) => c.key === k);
    const removed = creator?.remotes.filter((r) => same(r.listing.url)) ?? [];
    if (creator) creator.remotes = creator.remotes.filter((r) => !same(r.listing.url));
    this.lastRejected = { key: k, url: link, wasManual, remotes: removed };
    this.refreshStatuses();
    return this.commit();
  }

  async undoRejectLink(key: unknown, url: unknown): Promise<AppSnapshot> {
    const stash = this.lastRejected;
    const k = str(key);
    const link = str(url);
    if (!stash || stash.key !== k || linkKey(stash.url) !== linkKey(link)) throw new Error("That link can't be put back any more. Add it again under the creator.");
    const prefs = this.prefs(k);
    prefs.rejected = prefs.rejected.filter((u) => linkKey(u) !== linkKey(link));
    if (stash.wasManual) prefs.manual.push(stash.url);
    this.state.lastResult?.creators.find((c) => c.key === k)?.remotes.push(...stash.remotes);
    this.lastRejected = undefined;
    this.refreshStatuses();
    return this.commit();
  }

  /** Forgets added and removed links (not the sites turned off for the creator). */
  async resetLinks(key: unknown): Promise<AppSnapshot> {
    const k = str(key);
    const mutedSources = this.state.linkPrefs[k]?.mutedSources;
    if (mutedSources) this.state.linkPrefs[k] = { rejected: [], manual: [], mutedSources };
    else delete this.state.linkPrefs[k];
    return this.commit();
  }

  /** Left click: the user's normal or private-window preference. */
  async openExternal(url: unknown): Promise<void> {
    const link = str(url);
    if (!this.state.settings.privateLinks) return openUrl(link);
    const browsers = await installedBrowsers();
    const browser = browsers.find((b) => b.id === this.state.settings.privateBrowser) ?? browsers[0];
    if (!browser) throw new Error('No browser with a private mode was found. Turn off private links in Settings.');
    await openPrivate(browser.id, link);
  }

  async showLinkMenu(url: unknown): Promise<void> {
    const link = str(url);
    if (!/^https?:\/\//i.test(link)) return;
    const report = (err: unknown): void => this.emit({ type: 'error', message: (err as Error).message });
    const browsers = await installedBrowsers();
    const template: MenuItemConstructorOptions[] = [
      { label: 'Open in browser', click: () => void openUrl(link).catch(report) },
      ...(browsers.length ? [{ type: 'separator' } as const] : []),
      ...browsers.map((b) => ({
        label: `Open in ${b.privateLabel} — ${b.name}${b.isDefault ? ' (default)' : ''}`,
        click: () => void openPrivate(b.id, link).catch(report),
      })),
      { type: 'separator' },
      { label: 'Copy link', click: () => clipboard.writeText(link) },
    ];
    Menu.buildFromTemplate(template).popup(this.window ? { window: this.window } : {});
  }

  async openBackupFolder(installId: unknown): Promise<void> {
    let dir = this.backupRoot;
    if (typeof installId === 'string') {
      const record = this.state.installs.find((i) => i.id === installId);
      if (!record || record.undoneAt) throw new Error('That backup no longer exists.');
      dir = record.backupDir;
    }
    // Only ever open folders inside the backups folder.
    if (relative(this.backupRoot, dir).startsWith('..')) throw new Error('Not a backup folder.');
    await mkdir(dir, { recursive: true });
    await openFolder(dir);
  }

  async showFile(path: unknown): Promise<void> {
    await revealFile(str(path));
  }

  /**
   * The banner was closed without the check being passed. The site is still held
   * back, so say so again rather than letting the rest of the run fail quietly.
   */
  async dismissVerification(site: unknown): Promise<void> {
    this.pool.remindVerification(browserSite(site));
  }

  async showVerification(site: unknown): Promise<void> {
    this.pool.showVerification(browserSite(site));
  }

  async signIn(site: unknown): Promise<AccountStatus> {
    const status = await signIn(browserSite(site), this.window);
    this.pool.reset(status.site);
    await this.commit();
    return status;
  }

  async signOut(site: unknown): Promise<AccountStatus> {
    const status = await signOut(browserSite(site), this.pool);
    await this.commit();
    return status;
  }

  private prefs(key: string): AppState['linkPrefs'][string] {
    return (this.state.linkPrefs[key] ??= { rejected: [], manual: [] });
  }

  /** Re-derives statuses after dismissals or link removals without a new check. */
  private refreshStatuses(): void {
    const result = this.state.lastResult;
    if (!result) return;
    for (const creator of result.creators) {
      const dismissedAt = this.state.dismissed[creator.key];
      // Marking one page as seen changes only that page, so re-apply them before comparing.
      creator.remotes = markSeenPages(creator.remotes, this.state.linkPrefs[creator.key]?.seen);
      const { status, remoteUpdatedAt, behindBy } = creatorStatus(creator.localUpdatedAt, creator.remotes, dismissedAt);
      Object.assign(creator, { status, remoteUpdatedAt, behindBy, dismissedAt });
    }
    const core = result.core;
    if (core.installed && core.releasedAt !== undefined) {
      core.status = isNewer(core.releasedAt, core.installed.mtimeMs, this.state.dismissed[CORE_KEY]) ? 'update-available' : 'up-to-date';
    }
  }

  private notifyUpdates(result: CheckResult): void {
    const fresh: string[] = [];
    for (const c of result.creators) {
      if (c.status === 'update-available' && c.remoteUpdatedAt && this.state.notified[c.key] !== c.remoteUpdatedAt) {
        this.state.notified[c.key] = c.remoteUpdatedAt;
        fresh.push(c.name);
      }
    }
    const core = result.core;
    if (core.status === 'update-available' && core.releasedAt && this.state.notified[CORE_KEY] !== core.releasedAt) {
      this.state.notified[CORE_KEY] = core.releasedAt;
      fresh.unshift(`WickedWhims v${core.latestVersion}`);
    }
    if (!fresh.length || !Notification.isSupported() || this.window?.isFocused()) return;
    const notification = new Notification({
      title: fresh.length === 1 ? 'Update available' : `${fresh.length} updates available`,
      // Windows keeps notification history, so names are opt-in.
      body: this.state.settings.notificationNames
        ? fresh.slice(0, 5).join(', ') + (fresh.length > 5 ? `, +${fresh.length - 5} more` : '')
        : 'Open WhimWatch to see what changed.',
    });
    notification.on('click', () => {
      this.window?.show();
      this.window?.focus();
    });
    notification.show();
  }
}

/** Linux stores cookies with a fixed, public key when no keyring (GNOME Keyring, KWallet) is available. */
function weakCookieStorage(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    safeStorage.isEncryptionAvailable();
    return safeStorage.getSelectedStorageBackend() === 'basic_text';
  } catch {
    return false;
  }
}

/** Every folder WhimWatch writes to outside the Mods folder, without nested duplicates. */
function dataFolders(backupRoot: string, tempRoot: string): string[] {
  const userData = app.getPath('userData');
  const home = app.getPath('home');
  const candidates = [userData, backupRoot, app.getPath('logs'), app.getPath('crashDumps'), tempRoot];
  if (process.platform === 'darwin') {
    const lib = join(home, 'Library');
    candidates.push(
      join(lib, 'Caches', APP_ID),
      join(lib, 'Caches', app.getName()),
      join(lib, 'HTTPStorages', APP_ID),
      join(lib, 'Saved Application State', `${APP_ID}.savedState`),
      join(lib, 'Preferences', `${APP_ID}.plist`),
    );
  }
  return [...new Set(candidates)].filter((p) => p === userData || !p.startsWith(userData + sep));
}

function str(v: unknown): string {
  if (typeof v !== 'string') throw new Error('Expected a string');
  return v;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function browserSite(v: unknown): BrowserSite {
  if (v === 'loverslab' || v === 'patreon') return v;
  throw new Error('Unknown site');
}

function updateSite(v: unknown): UpdateSite {
  const site = UPDATE_SITES.find((s) => s === v);
  if (!site) throw new Error('Unknown site');
  return site;
}
