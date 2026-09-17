import type {
  SourceId,
  AppSettings,
  CheckProgress,
  CheckResult,
  CreatorResult,
  InstallRecord,
  SeenEvent,
  UpdateSite,
} from './types.js';

export type BrowserSite = 'loverslab' | 'patreon';

export interface AccountStatus {
  site: BrowserSite;
  label: string;
  signedIn: boolean;
}

/** A browser that can open links in a private window. */
export interface LinkBrowser {
  id: string;
  name: string;
  privateLabel: string;
  isDefault: boolean;
}

export type BatchItemState = 'queued' | 'working' | 'done' | 'failed' | 'cancelled';

export interface BatchItem {
  key: string;
  name: string;
  /** Label of the source it downloads from, e.g. "wicked.cc". */
  source?: string;
  state: BatchItemState;
  message?: string;
  /** Files replaced and added, once installed. */
  replaced?: number;
  added?: number;
}

/** Progress of "Update all" (or automatic installs after a check). */
export interface BatchState {
  running: boolean;
  items: BatchItem[];
  stopRequested: boolean;
  /** Install records from this run carry the same id (for "Undo all"). */
  batchId?: string;
}

/** What setup found in the chosen folders, before the first check. */
export interface FolderPreview {
  creators: number;
  wickedWhims: boolean;
  otherFiles: number;
}

/** Disk space WhimWatch uses outside the Mods folder, in bytes. */
export interface StorageInfo {
  backups: number;
  /** Leftover downloads plus the LoversLab/Patreon web cache. */
  caches: number;
}

export interface OtherFile {
  path: string;
  relPath: string;
  error?: string;
}

export interface AppSnapshot {
  appVersion: string;
  dirs: string[];
  settings: AppSettings;
  lastResult?: CheckResult;
  running: boolean;
  progress?: CheckProgress;
  accounts: AccountStatus[];
  installs: InstallRecord[];
  /** Creator key → user-added links, for editing. */
  manualLinks: Record<string, string[]>;
  /** Creator key → links the user removed. */
  rejectedLinks: Record<string, string[]>;
  /** Creator key → sites turned off for that creator only (see AppSettings.mutedSources for everyone). */
  creatorMutedSources: Record<string, UpdateSite[]>;
  browsers: LinkBrowser[];
  /** Folder that holds a backup subfolder for each update. */
  backupRoot: string;
  batch?: BatchState;
  /** Outcome of the last check when it didn't complete (cancelled or failed). */
  checkMessage?: { tone: 'info' | 'error'; text: string };
  /** A newer WhimWatch release on GitHub. */
  appUpdate?: { version: string; url: string };
  /** Ids of game warnings the user hid. */
  dismissedGameWarnings: string[];
  /** The LoversLab/Patreon browsers keep nothing on disk this session. */
  sessionsInMemory: boolean;
  /** Linux without a usable keyring: sign-in cookies are only obfuscated on disk. */
  weakCookieStorage: boolean;
  /** "Mark as seen" actions, newest last. */
  seenHistory: SeenEvent[];
  /** The first check just finished: explain that hand-installed packs may look out of date. */
  firstCheckNotice: boolean;
  platform: 'win32' | 'darwin' | 'linux';
}

export interface PlannedFile {
  /** Path inside the extracted download. */
  source: string;
  /** Destination inside a Mods directory. */
  target: string;
  kind: 'replace' | 'add';
  /** Byte-identical to the installed file, so nothing needs copying. */
  unchanged?: boolean;
}

export interface UpdatePlan {
  id: string;
  creatorKey: string;
  name: string;
  /** Page the update was downloaded from. */
  downloadUrl: string;
  source: SourceId;
  /** Names of the downloaded files (several when a page offers more than one). */
  downloads: string[];
  files: PlannedFile[];
  /** Installed files not present in the download (kept unless selected). */
  possiblyObsolete: string[];
  /** Files in the download that are not mods (readme etc.) and will be skipped. */
  skipped: string[];
  warnings: string[];
  /** Every downloaded mod file matches what's installed: nothing to update. */
  upToDate: boolean;
}

/** What the user picked in the update preview. */
export interface UpdateChoice {
  /** Installed files (from possiblyObsolete) to remove. */
  remove: string[];
  /** Planned targets to leave out. */
  skip: string[];
}

export type UpdateStage = 'resolving' | 'downloading' | 'extracting' | 'installing' | 'done' | 'error';

export interface UpdateProgress {
  creatorKey: string;
  stage: UpdateStage;
  received?: number;
  total?: number;
  message?: string;
}

export type AppEvent =
  | { type: 'snapshot'; snapshot: AppSnapshot }
  | { type: 'progress'; progress: CheckProgress }
  | { type: 'creator'; creator: CreatorResult }
  | { type: 'verification-needed'; site: BrowserSite }
  /** The user passed the site's human check, so it can be checked again. */
  | { type: 'verification-passed'; site: BrowserSite }
  | { type: 'update-progress'; progress: UpdateProgress }
  | { type: 'batch'; batch: BatchState }
  | { type: 'error'; message: string }
  /** Updates were installed automatically after a check. */
  | { type: 'auto-installed'; batchId: string; count: number }
  /** The quick-hide shortcut hid the window (the renderer drops any open menus). */
  | { type: 'hidden' }
  /** The window became active or inactive (for the privacy screen). */
  | { type: 'window-focus'; focused: boolean };

export interface WhimWatchApi {
  getSnapshot(): Promise<AppSnapshot>;
  detectModsDirs(): Promise<string[]>;
  chooseDirectory(): Promise<string | undefined>;
  setDirs(dirs: string[]): Promise<AppSnapshot>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSnapshot>;
  startCheck(): Promise<void>;
  /** Stops a running check; the previous results stay. */
  cancelCheck(): Promise<void>;
  dismiss(key: string, remoteUpdatedAt: number): Promise<AppSnapshot>;
  undismiss(key: string): Promise<AppSnapshot>;
  /** Marks every current update as seen. */
  dismissAll(): Promise<AppSnapshot>;
  /** Reverts a "Mark as seen" from History. */
  undoSeen(id: string): Promise<AppSnapshot>;
  dismissFirstCheckNotice(): Promise<AppSnapshot>;
  dismissAppUpdate(version: string): Promise<AppSnapshot>;
  /**
   * Marks one creator's (or WickedWhims') update as seen. With `listingUrl`,
   * only up to that source's date, so a newer post elsewhere still shows.
   */
  markSeen(key: string, listingUrl?: string): Promise<AppSnapshot>;
  /** Hides a game warning until the game version changes. */
  dismissGameWarning(id: string): Promise<AppSnapshot>;
  addLink(key: string, url: string): Promise<AppSnapshot>;
  rejectLink(key: string, url: string): Promise<AppSnapshot>;
  /** Puts back the link removed by the last rejectLink (the undo in its toast). */
  undoRejectLink(key: string, url: string): Promise<AppSnapshot>;
  resetLinks(key: string): Promise<AppSnapshot>;
  /** Turns one site off (or back on) for one creator. */
  setCreatorSite(key: string, site: UpdateSite, on: boolean): Promise<AppSnapshot>;
  openExternal(url: string): Promise<void>;
  /** Native context menu for a link: open, open privately, copy. */
  showLinkMenu(url: string): Promise<void>;
  /** Opens the backups folder, or one update's backup folder. */
  openBackupFolder(installId?: string): Promise<void>;
  showFile(path: string): Promise<void>;
  /** Files that aren't WickedWhims creator packages (not included in snapshots, which stay small). */
  listOtherFiles(): Promise<OtherFile[]>;
  showVerification(site: BrowserSite): Promise<void>;
  /** The user waved the notice away without passing the check: say it again when the site is next turned away. */
  dismissVerification(site: BrowserSite): Promise<void>;
  signIn(site: BrowserSite): Promise<AccountStatus>;
  signOut(site: BrowserSite): Promise<AccountStatus>;
  /** Downloads and prepares an update; `listingUrl` picks the source (default: newest downloadable). */
  planUpdate(key: string, listingUrl?: string): Promise<UpdatePlan>;
  applyUpdate(planId: string, choice: UpdateChoice): Promise<AppSnapshot>;
  undoInstall(id: string): Promise<AppSnapshot>;
  /** Undoes every install from one "Update all" (or automatic) run, newest first. */
  undoBatch(batchId: string): Promise<AppSnapshot>;
  isGameRunning(): Promise<boolean>;
  /** Whether the window is the active one right now. */
  isWindowFocused(): Promise<boolean>;
  /** Counts what setup found in these folders (also warms the scan cache for the first check). */
  previewDirs(dirs: string[]): Promise<FolderPreview>;
  /** Stops preparing an update (download/unpack) and throws away its files. Installing can't be interrupted. */
  cancelUpdate(key: string): Promise<void>;
  getStorage(): Promise<StorageInfo>;
  /** Versions, settings, the last check summary and recent log lines for a bug report, to preview. */
  getDiagnostics(): Promise<string>;
  /** Copies the diagnostics last shown by getDiagnostics. */
  copyDiagnostics(): Promise<void>;
  /** Saves the diagnostics last shown by getDiagnostics to a file the user picks; false if cancelled. */
  saveDiagnostics(): Promise<boolean>;
  /** WhimWatch's licence followed by the licences of everything it includes. */
  getLicenses(): Promise<string>;
  /** Asks for confirmation, then quits and deletes every WhimWatch file outside the Mods folder. */
  removeAllData(): Promise<void>;
  /** Deletes every update backup; those updates can no longer be undone. */
  clearBackups(): Promise<AppSnapshot>;
  /** Deletes leftover downloads and the web cache (keeps sign-ins). */
  clearCaches(): Promise<StorageInfo>;
  /** Starts updating these creators one after another; progress arrives as 'batch' events. */
  updateAll(keys: string[]): Promise<void>;
  /** Finishes the current item, then stops. */
  stopUpdateAll(): Promise<void>;
  /** Stops immediately (unless an install is mid-way, which finishes first). */
  cancelUpdateAll(): Promise<void>;
  onEvent(listener: (event: AppEvent) => void): () => void;
}

/** IPC channel names; every API method maps to `whimwatch:<method>`. */
export const API_METHODS = [
  'getSnapshot',
  'detectModsDirs',
  'chooseDirectory',
  'setDirs',
  'updateSettings',
  'startCheck',
  'cancelCheck',
  'dismiss',
  'undismiss',
  'dismissAll',
  'undoSeen',
  'dismissFirstCheckNotice',
  'markSeen',
  'dismissGameWarning',
  'dismissAppUpdate',
  'addLink',
  'rejectLink',
  'undoRejectLink',
  'resetLinks',
  'setCreatorSite',
  'openExternal',
  'showLinkMenu',
  'openBackupFolder',
  'showFile',
  'listOtherFiles',
  'showVerification',
  'dismissVerification',
  'signIn',
  'signOut',
  'planUpdate',
  'applyUpdate',
  'undoInstall',
  'undoBatch',
  'isGameRunning',
  'isWindowFocused',
  'previewDirs',
  'updateAll',
  'stopUpdateAll',
  'cancelUpdate',
  'cancelUpdateAll',
  'getStorage',
  'getDiagnostics',
  'copyDiagnostics',
  'saveDiagnostics',
  'getLicenses',
  'removeAllData',
  'clearBackups',
  'clearCaches',
] as const satisfies readonly Exclude<keyof WhimWatchApi, 'onEvent'>[];

export const EVENT_CHANNEL = 'whimwatch:event';
