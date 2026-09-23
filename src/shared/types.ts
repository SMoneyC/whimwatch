/** Types shared by core, main process and renderer. Keep free of Node/DOM imports. */

export type PackageKind = 'ww-animation' | 'ww-cas' | 'ww-core' | 'other';

export interface AppSettings {
  checkOnLaunch: boolean;
  /** Ask GitHub once a day whether a newer WhimWatch is out. */
  checkAppUpdates: boolean;
  /** Launch-time checks are skipped when the last one is newer than this. */
  recheckAfterMinutes: number;
  /** Install updates without asking (only where no sign-in is needed). */
  autoInstall: boolean;
  /** Open source links in a private browser window by default. */
  privateLinks: boolean;
  /** Browser id for private links; the detected default browser when unset. */
  privateBrowser?: string;
  /** Delete update backups after this many days; 0 keeps them until deleted by hand. */
  keepBackupsDays: number;
  /** Wipe the LoversLab/Patreon browsers' cache and site data when the app closes. */
  clearBrowsingDataOnExit: boolean;
  /**
   * Also forget sign-ins when the app closes. The LoversLab/Patreon browsers
   * then keep nothing on disk at all (applies from the next start).
   */
  forgetSignInsOnExit: boolean;
  /** Name creators in desktop notifications (Windows keeps notification history). */
  notificationNames: boolean;
  /** Blur the window whenever it isn't the active one, and keep it out of screenshots and screen sharing. */
  privacyScreen: boolean;
  /** Show "LoversLab page" instead of post and page titles, which can be explicit. */
  hidePageTitles: boolean;
  /** List each creator's pages for packs you don't have. They are never counted as updates either way. */
  showNewPacks: boolean;
  /** A system-wide shortcut that hides and shows the window. */
  quickHide: boolean;
  /** Electron accelerator for quick hide, e.g. "CommandOrControl+Shift+H". */
  quickHideShortcut: string;
  theme: 'system' | 'dark' | 'light';
  /** Sites the user turned off: never contacted during checks, and their updates aren't shown. */
  mutedSources: UpdateSite[];
}

export interface LocalFile {
  path: string;
  /** Mods directory this file was found under. */
  root: string;
  relPath: string;
  size: number;
  mtimeMs: number;
  kind: PackageKind;
  /** Author name → number of tuning entries crediting them. */
  authors: Record<string, number>;
  primaryAuthor?: string;
  /** Set when the file could not be parsed. */
  error?: string;
}

export type SourceId = 'wwmod' | 'wickedcc' | 'loverslab' | 'patreon';

/** Sites with creators' download pages, which the user can turn off. The WickedWhims site is always read. */
export type UpdateSite = Exclude<SourceId, 'wwmod'>;

export const UPDATE_SITES: readonly UpdateSite[] = ['wickedcc', 'loverslab', 'patreon'];

/** directory = wickedwhimsmod.com list, discovered = found by probing/following links. */
export type LinkOrigin = 'directory' | 'override' | 'discovered' | 'manual';

export interface Listing {
  source: SourceId;
  url: string;
  origin: LinkOrigin;
}

export type RemoteStatus = 'ok' | 'error' | 'needs-verification' | 'not-found';

export interface RemoteInfo {
  listing: Listing;
  status: RemoteStatus;
  checkedAt: number;
  updatedAt?: number;
  version?: string;
  title?: string;
  /** Patreon: newest release-like post is not viewable with the current session. */
  locked?: boolean;
  /**
   * Whether the user's files show this pack (see core/ownership.ts). Absent
   * means it couldn't be told, which counts as theirs: a page classified `no`
   * is a pack they don't have, never an update.
   */
  owned?: 'yes' | 'no';
  /**
   * Date of your newest file that carries this page's name, when any do. It is what the page's
   * date is compared against, so an update to one pack isn't hidden by a newer file from another.
   * Absent means nothing of yours matched the name, and the creator's newest file is used instead.
   */
  yoursAt?: number;
  /**
   * This page on its own was marked as seen at this date. Per page rather than per creator, so
   * saying "seen" about one pack can't bury a different pack of theirs that is genuinely behind.
   */
  seenAt?: number;
  /** Direct download page/link when the source exposes one. */
  downloadUrl?: string;
  /** Size of the downloadable file when known (wicked.cc zips). */
  remoteSize?: number;
  /** How many files the download offers, when known without extra requests (wicked.cc: 1). */
  fileCount?: number;
  error?: string;
}

export type CreatorStatus =
  | 'up-to-date'
  | 'update-available'
  | 'unknown'
  | 'needs-verification'
  | 'checking';

export interface CreatorResult {
  key: string;
  name: string;
  files: LocalFile[];
  localUpdatedAt: number;
  remotes: RemoteInfo[];
  remoteUpdatedAt?: number;
  /**
   * How far behind the furthest-behind pack is, in ms. Measured per pack against the files that
   * came from it, so it stays meaningful when only one of a creator's packs needs updating.
   */
  behindBy?: number;
  status: CreatorStatus;
  /** Remote date the user marked as seen. */
  dismissedAt?: number;
  /** Turned-off sites that have a page for this creator. None of them count towards the status. */
  mutedSources?: UpdateSite[];
  /**
   * Every site is turned off for this creator (for them or for everyone). Set even when none of them
   * had a page: mutedSources lists only sites that did, and a creator with no pages would otherwise
   * stay "No page found" after the user asked for nothing to be checked.
   */
  allSitesOff?: true;
  /** Results from sites turned off after this check, put back if the site is turned on again. */
  mutedRemotes?: RemoteInfo[];
}

/** What the game's own files say (read next to the Mods folder). */
export interface GameInfo {
  /** From GameVersion.txt, e.g. "1.127.41.1030". */
  version?: string;
  /** Options.ini "modsdisabled = 0". */
  modsEnabled?: boolean;
  /** Options.ini "scriptmodsenabled = 1". */
  scriptModsEnabled?: boolean;
}

export interface CoreResult {
  /** The script file, whose date stands for the installed version. */
  installed?: LocalFile;
  /** Every WickedWhims core file (script + tuning), replaced together on update. */
  installedFiles?: LocalFile[];
  latestVersion?: string;
  releasedAt?: number;
  gameVersions?: string;
  /** Every game version the current WickedWhims release supports ("1.127.41", …). */
  supportedGameVersions?: string[];
  downloadPageUrl?: string;
  status: CreatorStatus;
  error?: string;
}

export interface CheckResult {
  startedAt: number;
  finishedAt: number;
  dirs: string[];
  core: CoreResult;
  creators: CreatorResult[];
  /** Mod/CC files that aren't WickedWhims creator packages (listed on demand). */
  unrecognizedCount: number;
  game?: GameInfo;
}

export interface InstallOperation {
  kind: 'replace' | 'add' | 'remove';
  /** Absolute path inside a Mods directory. */
  target: string;
  /** Where the previous file was moved (replace/remove). */
  backup?: string;
}

export interface InstallRecord {
  id: string;
  creatorKey: string;
  name: string;
  at: number;
  backupDir: string;
  operations: InstallOperation[];
  /** Where the files came from. */
  source?: SourceId;
  /** Shared by the installs of one "Update all" run (or automatic run), so they can be undone together. */
  batchId?: string;
  /** Installed by "install automatically after a check". */
  automatic?: boolean;
  /**
   * Got from a page the check marked as a pack the user didn't have. Recorded rather than worked
   * out later from the operations: an ordinary update that only adds files looks identical.
   */
  newPack?: boolean;
  /**
   * The page this pack came from. A plain CAS pack carries no WickedWhims tuning and so no author,
   * and is tied to its creator by filename alone; recording the page it was installed from is the
   * only thing that links such a file to a specific pack rather than just to a creator.
   */
  listingUrl?: string;
  undoneAt?: number;
  /** The backup was deleted (expired or cleared), so the update can't be undone. */
  backupDeletedAt?: number;
}

/** One "Mark as seen" action (a single creator, or "Mark all as seen"), kept for History and undo. */
export interface SeenEvent {
  id: string;
  at: number;
  kind: 'one' | 'all';
  entries: {
    key: string;
    name: string;
    /** One page of the creator's, when the mark was about that pack rather than all of them. */
    page?: string;
    /** The date marked as seen. */
    dismissedAt: number;
    /** What was marked as seen before, restored by undo. */
    previous?: number;
  }[];
  /** Set when an "Already up to date" update did it rather than the user. */
  automatic?: boolean;
  undoneAt?: number;
}

export interface CheckProgress {
  phase: 'scan' | 'directory' | 'discover' | 'check' | 'done';
  done: number;
  total: number;
  message: string;
}
