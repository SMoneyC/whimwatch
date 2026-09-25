import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seenUpTo } from '../src/core/compare.js';
import { DbpfError, inflateResource } from '../src/core/dbpf.js';
import { defaultState } from '../src/core/store.js';
import { compactLog, isExpectedNoise, redact } from '../src/main/log.js';
import {
  type CookieSession,
  isWhimWatchPath,
  REMOVAL_MARKER,
  removeAfterExit,
  removeThirdPartyCookies,
  waitForDataRemoval,
  WINDOWS_REMOVAL_SCRIPT,
} from '../src/main/privacy.js';
import { allowHiddenRequest, SITE_DOMAINS } from '../src/main/request-filter.js';
import { SiteSessionMode } from '../src/main/session-mode.js';
import { afterNavigation, isSignInRejection, PASSWORD_HELP, signInProvider } from '../src/main/sign-in-provider.js';
import { t } from '../src/shared/i18n/index.js';
import { gameWarnings } from '../src/shared/game.js';
import { privacyLevel, privacyLevelPatch } from '../src/shared/privacy.js';
import type { RemoteInfo } from '../src/shared/types.js';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'whimwatch-privacy-'));
});
afterEach(() => rm(tmp, { recursive: true, force: true }));

describe('log hygiene', () => {
  it('cuts addresses down to the site and hides the home folder', () => {
    expect(redact('Timed out loading https://www.loverslab.com/files/file/27388-pineglen-adult-animations/?do=download&r=1')).toBe(
      'Timed out loading https://www.loverslab.com/…',
    );
    expect(redact('see https://wicked.cc/ and https://user:secret@example.com/a')).toBe('see https://wicked.cc/ and https://example.com/…');
    expect(redact('(https://www.patreon.com/api/posts?filter[campaign_id]=1)')).toBe('(https://www.patreon.com/…)');
    expect(redact('loaded file:///home/x/out/renderer/index.html')).toBe('loaded file://…');
    expect(redact(`${join(homedir(), 'Documents', 'Mods')} missing`)).toBe(`${join('~', 'Documents', 'Mods')} missing`);
  });

  it('drops the warnings for frames the hidden browser blocks on purpose, and nothing else', () => {
    expect(isExpectedNoise('(node:2886820) electron: Failed to load URL: https://www.loverslab.com/files/file/1-x/?do=embed with error: ERR_BLOCKED_BY_CLIENT')).toBe(true);
    expect(isExpectedNoise('(Use `electron --trace-warnings ...` to show where the warning was created)')).toBe(true);
    expect(isExpectedNoise('(node:1) electron: Failed to load URL: https://wicked.cc/ with error: ERR_NAME_NOT_RESOLVED')).toBe(false);
    expect(isExpectedNoise('Check failed Error: Timed out loading https://www.patreon.com/…')).toBe(false);
  });

  it('scrubs and shortens logs written by older versions', async () => {
    const file = join(tmp, 'whimwatch.log');
    const old = Array.from({ length: 3000 }, (_, i) => `2026-09-14T00:00:00.000Z [warn] ${i} failed https://wicked.cc/animations/someone/pack-${i}/`);
    await writeFile(file, `${old.join('\n')}\n2026 [error] Failed to load URL: https://x.test/a with error: ERR_BLOCKED_BY_CLIENT\n`);
    compactLog(file);
    const text = await readFile(file, 'utf8');
    expect(text).not.toContain('/animations/');
    expect(text).not.toContain('ERR_BLOCKED_BY_CLIENT');
    expect(text.length).toBeLessThanOrEqual(64 * 1024);
    expect(text.trimEnd().split('\n').at(-1)).toContain('2999 failed https://wicked.cc/…');
  });
});

describe('hidden site windows', () => {
  it('load only the site itself and Cloudflare, and nothing heavy', () => {
    expect(allowHiddenRequest('loverslab', 'https://www.loverslab.com/files/file/1-x/', 'mainFrame')).toBe(true);
    expect(allowHiddenRequest('loverslab', 'https://www.loverslab.com/applications/core/interface/x.js', 'script')).toBe(true);
    expect(allowHiddenRequest('loverslab', 'https://challenges.cloudflare.com/turnstile/v0/api.js', 'subFrame')).toBe(true);
    expect(allowHiddenRequest('loverslab', 'https://www.googletagmanager.com/gtag/js', 'script')).toBe(false);
    expect(allowHiddenRequest('loverslab', 'https://www.loverslab.com/uploads/cover.jpg', 'image')).toBe(false);
    expect(allowHiddenRequest('loverslab', 'https://notloverslab.com/x.js', 'script')).toBe(false);
    expect(allowHiddenRequest('patreon', 'https://c10.patreonusercontent.com/x.js', 'script')).toBe(true);
    expect(allowHiddenRequest('patreon', 'https://www.loverslab.com/x.js', 'xhr')).toBe(false);
    expect(allowHiddenRequest('patreon', 'not a url', 'script')).toBe(false);
  });
});

describe('removing all data', () => {
  it('only accepts WhimWatch folders', () => {
    const appId = 'io.github.someone.whimwatch';
    expect(isWhimWatchPath('/home/u/.config/WhimWatch', appId)).toBe(true);
    expect(isWhimWatchPath('/tmp/whimwatch', appId)).toBe(true);
    expect(isWhimWatchPath(`/Users/u/Library/Preferences/${appId}.plist`, appId)).toBe(true);
    expect(isWhimWatchPath('/home/u', appId)).toBe(false);
    expect(isWhimWatchPath('/home/u/Documents/Electronic Arts/The Sims 4/Mods', appId)).toBe(false);
    expect(isWhimWatchPath('WhimWatch', appId)).toBe(false);
  });

  it('uses a fixed, readable Windows command with no user data in it', () => {
    // Paths and the process id travel in an environment variable; nothing is encoded or hidden.
    expect(WINDOWS_REMOVAL_SCRIPT).toContain('$env:WHIMWATCH_CLEANUP | ConvertFrom-Json');
    expect(WINDOWS_REMOVAL_SCRIPT).not.toMatch(/"|Users|AppData|EncodedCommand|Bypass/);
  });

  it.skipIf(process.platform === 'win32')('deletes the folders only after the app has exited', async () => {
    const data = join(tmp, 'WhimWatch');
    const other = join(tmp, 'Mods');
    await mkdir(join(data, 'Partitions'), { recursive: true });
    await writeFile(join(data, 'state.json'), '{}');
    await mkdir(other);
    const app = spawn('sleep', ['1']);
    removeAfterExit([data, other], 'io.github.forthewhimsy.whimwatch', tmp, app.pid!);
    await new Promise((r) => setTimeout(r, 300));
    expect(existsSync(data)).toBe(true);
    expect(existsSync(join(tmp, REMOVAL_MARKER))).toBe(true);
    await new Promise((r) => app.once('exit', r));
    for (let i = 0; i < 50 && existsSync(join(tmp, REMOVAL_MARKER)); i++) await new Promise((r) => setTimeout(r, 100));
    expect(existsSync(data)).toBe(false);
    expect(existsSync(join(tmp, REMOVAL_MARKER))).toBe(false);
    expect(existsSync(other)).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('makes a new launch wait until the removal has finished', async () => {
    const marker = join(tmp, REMOVAL_MARKER);
    await writeFile(marker, '');
    spawn('/bin/sh', ['-c', `sleep 0.4; rm -f "${marker}"`]);
    const started = Date.now();
    waitForDataRemoval(tmp);
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    expect(existsSync(marker)).toBe(false);
  });

  it("doesn't wait for a removal that never finished", async () => {
    await writeFile(join(tmp, REMOVAL_MARKER), '');
    const started = Date.now();
    waitForDataRemoval(tmp, () => Date.now() + 10 * 60_000);
    expect(Date.now() - started).toBeLessThan(200);
    expect(existsSync(join(tmp, REMOVAL_MARKER))).toBe(false);
    waitForDataRemoval(tmp); // no marker: returns at once
  });
});

describe('site sessions', () => {
  it('switch between disk and memory only until one is used', () => {
    const mode = new SiteSessionMode();
    expect(mode.persist).toBe(true);
    // Setup: discreet settings chosen before the first check.
    expect(mode.trySet(false)).toBe(true);
    expect(mode.persist).toBe(false);
    expect(mode.trySet(true)).toBe(true);
    mode.markUsed();
    expect(mode.trySet(false)).toBe(false);
    expect(mode.persist).toBe(true);
    expect(mode.trySet(true)).toBe(true);
  });

  it("keep only the site's own cookies when sign-ins are kept", async () => {
    const jar = [
      { name: 'ips4_member_id', domain: '.loverslab.com', path: '/', secure: true },
      { name: 'cf_clearance', domain: 'www.loverslab.com', path: '/', secure: true },
      { name: '_ga', domain: '.google-analytics.com', path: '/', secure: false },
      { name: 'ad', domain: 'ads.example.net', path: '/x', secure: true },
      { name: 'trick', domain: 'loverslab.com.evil.test', path: '/', secure: true },
    ];
    const removed: string[] = [];
    const ses: CookieSession = {
      cookies: {
        get: async () => jar,
        remove: async (url, name) => void removed.push(`${name} ${url}`),
        flushStore: async () => undefined,
      },
    };
    expect(await removeThirdPartyCookies(ses, SITE_DOMAINS.loverslab)).toBe(3);
    expect(removed).toEqual(['_ga http://google-analytics.com/', 'ad https://ads.example.net/x', 'trick https://loverslab.com.evil.test/']);
  });
});

describe('signing in through another service', () => {
  it('knows which service a sign-in page handed over to', () => {
    expect(signInProvider('https://accounts.google.com/o/oauth2/auth?client_id=x')).toBe('Google');
    expect(signInProvider('https://appleid.apple.com/auth/authorize?client_id=x')).toBe('Apple');
    expect(signInProvider('https://www.facebook.com/v19.0/dialog/oauth?client_id=x')).toBe('Facebook');
    expect(signInProvider('https://www.patreon.com/login')).toBeUndefined();
    // Not a Google address, whatever it puts in the host name.
    expect(signInProvider('https://accounts.google.com.evil.test/signin')).toBeUndefined();
    expect(signInProvider('not a url')).toBeUndefined();
  });

  it("recognizes Google's page for refusing to sign in inside an app", () => {
    expect(isSignInRejection('https://accounts.google.com/v3/signin/rejected?rejectReason=DISALLOWED_USERAGENT&dsh=1')).toBe(true);
    expect(isSignInRejection('https://accounts.google.com/signin/rejected?rrk=1')).toBe(true);
    expect(isSignInRejection('https://accounts.google.com/o/oauth2/auth/error?error=disallowed_useragent')).toBe(true);
    // The refusal also arrives as an error on the address Google sends the user back to, which is
    // the site's own, not Google's — in the query, or in the fragment for flows that use one.
    expect(isSignInRejection('https://www.patreon.com/auth/google?error=disallowed_useragent')).toBe(true);
    expect(isSignInRejection('https://www.patreon.com/auth/google#error=disallowed_useragent&state=x')).toBe(true);
    // The sign-in page itself is not a refusal: it may still go through.
    expect(isSignInRejection('https://accounts.google.com/v3/signin/identifier?flowName=GlifWebSignIn')).toBe(false);
    expect(isSignInRejection('https://www.patreon.com/login?rejected=1')).toBe(false);
    // A page that merely mentions it is not one: only the parameters that carry a refusal count.
    expect(isSignInRejection('https://www.patreon.com/login?next=%2Fhelp%2Fdisallowed_useragent')).toBe(false);
    expect(isSignInRejection('https://www.patreon.com/posts/disallowed_useragent-123')).toBe(false);
    expect(isSignInRejection('not a url')).toBe(false);
  });

  it('explains a sign-in window once per trip to Google, by address alone', () => {
    const google = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x';
    // Reaching Google is the dead end, once: a second load or in-page change there says nothing new.
    expect(afterNavigation(google, false)).toEqual({ forget: false, explain: true });
    expect(afterNavigation(google, true)).toEqual({ forget: false, explain: false });
    expect(afterNavigation('https://accounts.google.com/v3/signin/rejected?rejectReason=DISALLOWED_USERAGENT', true).explain).toBe(false);
    // Back on the site, it's forgotten, so trying again is explained again.
    expect(afterNavigation('https://www.patreon.com/login', true)).toEqual({ forget: true, explain: false });
    // A refusal handed back to the site is explained, even straight after a trip that was.
    expect(afterNavigation('https://www.patreon.com/auth/google#error=disallowed_useragent', true)).toEqual({ forget: true, explain: true });
    // Other sign-in services aren't Google's dead end.
    expect(afterNavigation('https://appleid.apple.com/auth/authorize', false)).toEqual({ forget: false, explain: false });
  });

  it('points at the site itself, not at the service that refused', () => {
    expect(PASSWORD_HELP.patreon).toMatch(/^https:\/\/www\.patreon\.com\//);
    expect(signInProvider(PASSWORD_HELP.patreon ?? '')).toBeUndefined();
    // Named so nobody has to hunt: an account made through Google has no password, and this is
    // where Patreon offers to set one.
    expect(t().main.passwordPath.patreon).toContain('Set Password');
  });
});

describe('privacy levels', () => {
  it('are presets over the normal settings, and anything else is Custom', () => {
    const { settings } = defaultState();
    expect(privacyLevel(settings, true)).toBe('standard');
    const discreet = { ...settings, ...privacyLevelPatch('discreet', true) };
    expect(privacyLevel(discreet, true)).toBe('discreet');
    expect(discreet).toMatchObject({ forgetSignInsOnExit: true, notificationNames: false, keepBackupsDays: 7, privateLinks: true, privacyScreen: true, hidePageTitles: true });
    expect(privacyLevel({ ...discreet, hidePageTitles: false }, true)).toBe('custom');
    // Everything on the Privacy page counts, quick hide included (it's off in both levels); the theme doesn't.
    expect(privacyLevel({ ...discreet, quickHide: true }, true)).toBe('custom');
    expect(privacyLevel({ ...discreet, theme: 'light', privateBrowser: 'firefox' }, true)).toBe('discreet');
    // Without a private-mode browser, links can't open privately, so that part is left out.
    expect(privacyLevelPatch('discreet', false)).not.toHaveProperty('privateLinks');
    expect(privacyLevel({ ...settings, ...privacyLevelPatch('discreet', false) }, false)).toBe('discreet');
  });
});

describe('mark as seen for one source', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const remote = (source: RemoteInfo['listing']['source'], updatedAt: number, status: RemoteInfo['status'] = 'ok'): RemoteInfo => ({
    listing: { source, url: `https://${source}.test/`, origin: 'directory' },
    status,
    checkedAt: 0,
    updatedAt,
  });

  it("covers that source's release but not a later post elsewhere", () => {
    const ll = Date.UTC(2026, 8, 5, 10);
    const remotes = [remote('loverslab', ll), remote('patreon', ll + 8 * 60 * 60 * 1000), remote('wickedcc', ll + 9 * DAY), remote('loverslab', ll + 30 * DAY, 'error')];
    expect(seenUpTo(remotes, ll)).toBe(ll + 8 * 60 * 60 * 1000);
    expect(seenUpTo(remotes, ll + 9 * DAY)).toBe(ll + 9 * DAY);
  });
});

describe('game warnings', () => {
  it('have ids tied to the game version, so hiding one lasts until the next patch', () => {
    const core = { status: 'up-to-date' as const, latestVersion: '185k', supportedGameVersions: ['1.127.41'] };
    const before = gameWarnings({ version: '1.128.2.1020', scriptModsEnabled: false }, core).map((w) => w.id);
    expect(before).toEqual(['script-mods-off:1.128.2.1020', 'game-newer:1.128.2']);
    const after = gameWarnings({ version: '1.129.0.1000', scriptModsEnabled: false }, core).map((w) => w.id);
    expect(after.some((id) => before.includes(id))).toBe(false);
  });
});

describe('package reading limits', () => {
  it("won't inflate a resource past the size its index claims", () => {
    const bomb = deflateSync(Buffer.alloc(8 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(16 * 1024);
    expect(() => inflateResource(bomb, 1024)).toThrow(DbpfError);
    expect(inflateResource(deflateSync(Buffer.from('<?xml?>')), 7).toString()).toBe('<?xml?>');
  });
});
