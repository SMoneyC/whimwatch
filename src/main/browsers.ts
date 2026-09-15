import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import {
  BROWSERS,
  type BrowserId,
  type BrowserSpec,
  browserForDefault,
  parseMacHttpsHandler,
  parseRegProgId,
} from '../core/browsers.js';
import type { LinkBrowser } from '../shared/api.js';

const run = promisify(execFile);

export const isWsl = process.platform === 'linux' && Boolean(process.env.WSL_DISTRO_NAME);
/** Windows tools by full path: WSL can be set up without Windows folders on PATH. */
export const WIN = { reg: '/mnt/c/Windows/System32/reg.exe', cmd: '/mnt/c/Windows/System32/cmd.exe', explorer: '/mnt/c/Windows/explorer.exe' };

interface Installed extends LinkBrowser {
  command: string;
  /** Arguments placed before the browser's own private-window arguments. */
  prefix: string[];
}

let cache: Promise<Installed[]> | undefined;

/** Installed browsers that can open a private window, default browser first. Detected once per run. */
export function installedBrowsers(): Promise<Installed[]> {
  cache ??= detect().catch(() => []);
  return cache;
}

export async function openPrivate(id: string, url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only web links can be opened.');
  const browser = (await installedBrowsers()).find((b) => b.id === id);
  const spec = BROWSERS.find((b) => b.id === id);
  if (!browser || !spec) throw new Error('That browser is no longer installed.');
  // No shell is involved: the URL is passed as a single argument.
  const child = spawn(browser.command, [...browser.prefix, ...spec.privateArgs(url)], { detached: true, stdio: 'ignore' });
  child.on('error', () => undefined);
  child.unref();
}

async function detect(): Promise<Installed[]> {
  const found: Installed[] = [];
  let defaultId: BrowserId | undefined;

  if (process.platform === 'win32' || isWsl) {
    const roots = isWsl ? await wslRoots() : winRoots();
    const reg = isWsl ? WIN.reg : 'reg';
    defaultId = browserForDefault(
      parseRegProgId(
        await output(reg, ['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', '/v', 'ProgId']),
      ),
    );
    for (const spec of BROWSERS) {
      const path = spec.windows.map((p) => resolveWinPath(p, roots)).find((p) => p && existsSync(p));
      if (path) found.push(entry(spec, path, []));
    }
  } else if (process.platform === 'darwin') {
    defaultId = browserForDefault(
      parseMacHttpsHandler(await output('defaults', ['read', 'com.apple.LaunchServices/com.apple.launchservices.secure', 'LSHandlers'])),
    );
    for (const spec of BROWSERS) {
      if (!spec.mac) continue;
      const app = [join('/Applications', `${spec.mac}.app`), join(homedir(), 'Applications', `${spec.mac}.app`)].find(existsSync);
      if (app) found.push(entry(spec, 'open', ['-na', app, '--args']));
    }
  } else {
    defaultId = browserForDefault((await output('xdg-settings', ['get', 'default-web-browser'])).trim());
    const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
    for (const spec of BROWSERS) {
      const command = spec.linux.map((c) => dirs.map((d) => join(d, c)).find(existsSync)).find(Boolean);
      if (command) found.push(entry(spec, command, []));
    }
  }

  for (const b of found) b.isDefault = b.id === defaultId;
  return found.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

function entry(spec: BrowserSpec, command: string, prefix: string[]): Installed {
  return { id: spec.id, name: spec.name, privateLabel: spec.privateLabel, isDefault: false, command, prefix };
}

function winRoots(): Record<string, string | undefined> {
  return { PF: process.env.ProgramFiles, PF86: process.env['ProgramFiles(x86)'], LAD: process.env.LOCALAPPDATA };
}

async function wslRoots(): Promise<Record<string, string | undefined>> {
  const lad = (await output(WIN.cmd, ['/d', '/c', 'echo %LOCALAPPDATA%'])).trim();
  const ladUnix = lad && !lad.includes('%') ? (await output('wslpath', ['-u', lad])).trim() : '';
  return { PF: '/mnt/c/Program Files', PF86: '/mnt/c/Program Files (x86)', LAD: ladUnix || undefined };
}

function resolveWinPath(template: string, roots: Record<string, string | undefined>): string | undefined {
  const [root, ...rest] = template.split('/');
  const base = roots[root!];
  return base ? join(base, ...rest) : undefined;
}

async function output(command: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run(command, args, { timeout: 8_000, windowsHide: true });
    return stdout.replace(/\r/g, '');
  } catch {
    return '';
  }
}
