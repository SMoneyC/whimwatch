/**
 * Known desktop browsers and how to open a link in a private window with each.
 * Pure data and parsers; launching lives in src/main/browsers.ts.
 */

import type { PrivateMode } from '../shared/api.js';

export type BrowserId = 'brave' | 'chrome' | 'chromium' | 'edge' | 'firefox' | 'opera' | 'vivaldi';

export interface BrowserSpec {
  id: BrowserId;
  name: string;
  /** What the browser calls its private mode (named in the link menu in the user's language). */
  privateMode: PrivateMode;
  privateArgs: (url: string) => string[];
  /** Windows install locations relative to Program Files (PF), Program Files (x86) (PF86) or LocalAppData (LAD). */
  windows: string[];
  /** macOS application name (as in /Applications/<name>.app). */
  mac?: string;
  /** Linux command names. */
  linux: string[];
  /** Matches the Windows ProgId, macOS bundle id or Linux .desktop name of the default browser. */
  defaultMatch: RegExp;
}

const chromium = (url: string): string[] => ['--incognito', url];

export const BROWSERS: BrowserSpec[] = [
  {
    id: 'brave',
    name: 'Brave',
    privateMode: 'private',
    privateArgs: chromium,
    windows: ['PF/BraveSoftware/Brave-Browser/Application/brave.exe', 'LAD/BraveSoftware/Brave-Browser/Application/brave.exe'],
    mac: 'Brave Browser',
    linux: ['brave-browser', 'brave'],
    defaultMatch: /^BraveHTML|com\.brave\.browser|brave/i,
  },
  {
    id: 'chrome',
    name: 'Google Chrome',
    privateMode: 'incognito',
    privateArgs: chromium,
    windows: ['PF/Google/Chrome/Application/chrome.exe', 'PF86/Google/Chrome/Application/chrome.exe', 'LAD/Google/Chrome/Application/chrome.exe'],
    mac: 'Google Chrome',
    linux: ['google-chrome', 'google-chrome-stable'],
    defaultMatch: /^ChromeHTML|com\.google\.chrome$|google-chrome/i,
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    privateMode: 'inprivate',
    privateArgs: (url) => ['--inprivate', url],
    windows: ['PF86/Microsoft/Edge/Application/msedge.exe', 'PF/Microsoft/Edge/Application/msedge.exe'],
    mac: 'Microsoft Edge',
    linux: ['microsoft-edge', 'microsoft-edge-stable'],
    defaultMatch: /^MSEdgeHTM|com\.microsoft\.edgemac|microsoft-edge/i,
  },
  {
    id: 'firefox',
    name: 'Firefox',
    privateMode: 'private',
    privateArgs: (url) => ['-private-window', url],
    windows: ['PF/Mozilla Firefox/firefox.exe', 'PF86/Mozilla Firefox/firefox.exe'],
    mac: 'Firefox',
    linux: ['firefox'],
    defaultMatch: /^FirefoxURL|org\.mozilla\.firefox|firefox/i,
  },
  {
    id: 'opera',
    name: 'Opera',
    privateMode: 'private',
    privateArgs: (url) => ['--private', url],
    windows: ['LAD/Programs/Opera/opera.exe'],
    mac: 'Opera',
    linux: ['opera'],
    defaultMatch: /^Opera|com\.operasoftware\.opera|opera/i,
  },
  {
    id: 'vivaldi',
    name: 'Vivaldi',
    privateMode: 'private',
    privateArgs: chromium,
    windows: ['LAD/Vivaldi/Application/vivaldi.exe'],
    mac: 'Vivaldi',
    linux: ['vivaldi', 'vivaldi-stable'],
    defaultMatch: /^VivaldiHTM|com\.vivaldi\.vivaldi|vivaldi/i,
  },
  {
    id: 'chromium',
    name: 'Chromium',
    privateMode: 'incognito',
    privateArgs: chromium,
    windows: ['LAD/Chromium/Application/chrome.exe'],
    mac: 'Chromium',
    linux: ['chromium', 'chromium-browser'],
    defaultMatch: /^ChromiumHTM|org\.chromium\.chromium|chromium/i,
  },
];

/** "    ProgId    REG_SZ    BraveHTML" → "BraveHTML" */
export function parseRegProgId(output: string): string | undefined {
  return /ProgId\s+REG_SZ\s+(\S+)/i.exec(output)?.[1];
}

/** Bundle id handling https, from `defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers`. */
export function parseMacHttpsHandler(output: string): string | undefined {
  for (const block of output.split('}')) {
    if (/LSHandlerURLScheme\s*=\s*"?https"?;/.test(block)) {
      return /LSHandlerRoleAll\s*=\s*"?([\w.-]+)"?;/.exec(block)?.[1];
    }
  }
  return undefined;
}

/** Which known browser a default-browser identifier refers to. */
export function browserForDefault(identifier: string | undefined): BrowserId | undefined {
  return identifier ? BROWSERS.find((b) => b.defaultMatch.test(identifier))?.id : undefined;
}
