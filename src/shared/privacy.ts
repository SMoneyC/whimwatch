import type { AppSettings } from './types.js';

export type PrivacyLevel = 'standard' | 'discreet' | 'custom';

/**
 * Settings a privacy level sets: every switch on the Privacy & discretion page, plus how long backups
 * are kept. Changing any of them makes the level Custom. Anything else (theme, checking, which browser
 * opens private links) is left alone.
 */
type LevelSettings = Pick<
  AppSettings,
  | 'privateLinks'
  | 'clearBrowsingDataOnExit'
  | 'forgetSignInsOnExit'
  | 'notificationNames'
  | 'keepBackupsDays'
  | 'privacyScreen'
  | 'hidePageTitles'
  | 'quickHide'
>;

/** For a computer only you use: sign-ins remembered, nothing hidden on screen. */
export const STANDARD_SETTINGS: LevelSettings = {
  privateLinks: false,
  clearBrowsingDataOnExit: true,
  forgetSignInsOnExit: false,
  notificationNames: false,
  keepBackupsDays: 30,
  privacyScreen: false,
  hidePageTitles: false,
  quickHide: false,
};

/** For shared computers and screen sharing: as little trace as possible, on screen and on disk. */
export const DISCREET_SETTINGS: LevelSettings = {
  privateLinks: true,
  clearBrowsingDataOnExit: true,
  forgetSignInsOnExit: true,
  notificationNames: false,
  keepBackupsDays: 7,
  privacyScreen: true,
  hidePageTitles: true,
  // A system-wide shortcut takes that key combination away from every other app, so it's always opt-in.
  quickHide: false,
};

/** Private links need a browser with a private mode, so they're left out when there is none. */
export function privacyLevelPatch(level: Exclude<PrivacyLevel, 'custom'>, hasPrivateBrowser: boolean): Partial<AppSettings> {
  const { privateLinks, ...rest } = level === 'discreet' ? DISCREET_SETTINGS : STANDARD_SETTINGS;
  return hasPrivateBrowser || !privateLinks ? { ...rest, privateLinks } : rest;
}

export function privacyLevel(settings: AppSettings, hasPrivateBrowser: boolean): PrivacyLevel {
  const matches = (level: 'standard' | 'discreet'): boolean =>
    Object.entries(privacyLevelPatch(level, hasPrivateBrowser)).every(([key, value]) => settings[key as keyof AppSettings] === value);
  if (matches('discreet')) return 'discreet';
  if (matches('standard')) return 'standard';
  return 'custom';
}
