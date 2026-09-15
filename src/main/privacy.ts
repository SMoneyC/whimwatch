import { spawn } from 'node:child_process';
import { existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import type { BrowserSite } from '../shared/api.js';

const SITES: BrowserSite[] = ['loverslab', 'patreon'];
/** Chromium's cookie database (sign-ins), in current and older layouts. */
const COOKIE_FILES = new Set(['Cookies', 'Cookies-journal']);

/**
 * Deletes what the LoversLab/Patreon browsers stored on disk: page cache, code
 * cache, site storage, visited-site records. Keeps only the cookie database
 * when sign-ins are kept. Must run before those sessions are created.
 */
export async function wipeSiteDataOnDisk(userData: string, keepSignIns: boolean): Promise<void> {
  for (const site of SITES) {
    const dir = join(userData, 'Partitions', site);
    if (keepSignIns) await removeAllButCookies(dir);
    else await rm(dir, { recursive: true, force: true });
  }
  // Crash reports can contain page memory.
  for (const sub of ['reports', 'completed', 'pending', 'new']) {
    await rm(join(userData, 'Crashpad', sub), { recursive: true, force: true }).catch(() => undefined);
  }
}

async function removeAllButCookies(dir: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && entry.name === 'Network') await removeAllButCookies(path);
    else if (!COOKIE_FILES.has(entry.name)) await rm(path, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Clears the site browsers' data through Chromium while the app runs. */
export async function clearSiteBrowsingData(
  sessions: { session: CookieSession & Electron.Session; domains: string[] }[],
  keepSignIns: boolean,
): Promise<void> {
  for (const { session: ses, domains } of sessions) {
    await ses.clearCache();
    await ses.clearCodeCaches({});
    await ses.clearAuthCache();
    await ses.clearHostResolverCache();
    if (!keepSignIns) {
      await ses.clearStorageData();
      continue;
    }
    await ses.clearStorageData({ storages: ['filesystem', 'indexdb', 'localstorage', 'shadercache', 'serviceworkers', 'cachestorage'] });
    await removeThirdPartyCookies(ses, domains);
  }
}

/** The part of Electron's session this module needs for cookies (a plain object in tests). */
export interface CookieSession {
  cookies: {
    get(filter: Record<string, never>): Promise<{ name: string; domain?: string; path?: string; secure?: boolean }[]>;
    remove(url: string, name: string): Promise<void>;
    flushStore(): Promise<void>;
  };
}

export function isSiteCookie(domain: string | undefined, siteDomains: string[]): boolean {
  const host = (domain ?? '').replace(/^\./, '').toLowerCase();
  return siteDomains.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * Sign-in and verification windows load the sites' full pages, including other
 * companies' ads and analytics. Keeping sign-ins shouldn't keep their cookies.
 */
export async function removeThirdPartyCookies(ses: CookieSession, siteDomains: string[]): Promise<number> {
  let removed = 0;
  for (const cookie of await ses.cookies.get({})) {
    if (isSiteCookie(cookie.domain, siteDomains)) continue;
    const host = (cookie.domain ?? '').replace(/^\./, '');
    if (!host) continue;
    await ses.cookies.remove(`${cookie.secure ? 'https' : 'http'}://${host}${cookie.path ?? '/'}`, cookie.name).catch(() => undefined);
    removed++;
  }
  await ses.cookies.flushStore();
  return removed;
}

/**
 * Folders WhimWatch may create outside the Mods folder. Only paths whose own
 * name identifies WhimWatch are accepted, so a bad path can't delete anything else.
 */
export function isWhimWatchPath(path: string, appId: string): boolean {
  if (!isAbsolute(path)) return false;
  const name = basename(path).toLowerCase();
  return name.includes('whimwatch') || name.startsWith(appId.toLowerCase());
}

/** Exists while data is being removed after exit, so a new launch waits instead of losing its files. */
export const REMOVAL_MARKER = 'whimwatch-removing-data';
/** Longest a removal can take: the wait for the app to exit plus the retries. */
const REMOVAL_MAX_MS = 90_000;

/**
 * Deletes WhimWatch's data once this process has exited. Chromium keeps its
 * databases open until then, and Windows can't delete open files, so a small
 * detached shell waits for the app to close and removes the folders.
 */
export function removeAfterExit(paths: string[], appId: string, tempDir: string, pid = process.pid): void {
  const targets = [...new Set(paths)].filter((p) => isWhimWatchPath(p, appId));
  if (!targets.length) return;
  const marker = join(tempDir, REMOVAL_MARKER);
  writeFileSync(marker, String(Date.now()));
  // The marker goes last, so it disappears only once everything else is gone.
  const job = { pid, paths: [...targets, marker] };
  const child =
    process.platform === 'win32'
      ? spawn(
          join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
          ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_REMOVAL_SCRIPT],
          { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, WHIMWATCH_CLEANUP: JSON.stringify(job) } },
        )
      : spawn('/bin/sh', ['-c', UNIX_REMOVAL_SCRIPT, 'whimwatch-cleanup', String(pid), ...job.paths], { detached: true, stdio: 'ignore' });
  child.unref();
}

/** Waits up to a minute for the app to exit, then deletes the paths given as arguments. */
export const UNIX_REMOVAL_SCRIPT = `pid=$1; shift
i=0
while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 600 ]; do sleep 0.1; i=$((i+1)); done
sleep 0.5
rm -rf -- "$@"`;

/**
 * Fixed and readable: the process id and paths arrive as JSON in the
 * WHIMWATCH_CLEANUP environment variable, never in the command line.
 * Chromium's helper processes can hold files for a moment after the app
 * exits, hence the retries. Single quotes only, so it passes through Windows
 * command-line quoting unchanged.
 */
export const WINDOWS_REMOVAL_SCRIPT =
  "$ErrorActionPreference = 'SilentlyContinue'; " +
  '$job = $env:WHIMWATCH_CLEANUP | ConvertFrom-Json; ' +
  'Wait-Process -Id $job.pid -Timeout 60; ' +
  'foreach ($attempt in 1..20) { ' +
  '$left = @($job.paths | Where-Object { Test-Path -LiteralPath $_ }); ' +
  'if ($left.Count -eq 0) { break }; ' +
  'foreach ($p in $left) { Remove-Item -LiteralPath $p -Recurse -Force }; ' +
  'Start-Sleep -Milliseconds 500 }';

/**
 * Called first thing on launch, before Chromium opens the data folder: if the
 * last run is still deleting its data, wait for that to finish. Blocks, which
 * is fine this early, and never longer than a removal can take.
 */
export function waitForDataRemoval(tempDir: string, now = Date.now): void {
  const marker = join(tempDir, REMOVAL_MARKER);
  let started: number;
  try {
    started = statSync(marker).mtimeMs;
  } catch {
    return;
  }
  const deadline = started + REMOVAL_MAX_MS;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  while (existsSync(marker) && now() < deadline) Atomics.wait(pause, 0, 0, 100);
  // A cleanup that never ran (or was killed) mustn't slow every launch.
  rmSync(marker, { force: true });
}
