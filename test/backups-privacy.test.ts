import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dirSize, expiredBackups, orphanBackupDirs } from '../src/core/backups.js';
import { wipeSiteDataOnDisk } from '../src/main/privacy.js';
import type { InstallRecord } from '../src/shared/types.js';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 8, 14);
const record = (id: string, daysAgo: number, extra: Partial<InstallRecord> = {}): InstallRecord => ({
  id,
  creatorKey: 'x',
  name: 'X',
  at: now - daysAgo * DAY,
  backupDir: join('/backups', id),
  operations: [],
  ...extra,
});

describe('backup retention', () => {
  it('expires only live backups older than the limit', () => {
    const installs = [record('old', 40), record('new', 5), record('undone', 60, { undoneAt: now }), record('gone', 60, { backupDeletedAt: now })];
    expect(expiredBackups(installs, 30, now).map((r) => r.id)).toEqual(['old']);
    expect(expiredBackups(installs, 0, now)).toEqual([]);
  });

  it('finds orphaned backup folders but never foreign or brand-new ones', () => {
    const fresh = `${now - 60_000}-wildguy`;
    const names = [`${now - 40 * DAY}-thornwood`, `${now - 2 * DAY}-kept`, fresh, 'My important folder'];
    const installs = [record(`${now - 2 * DAY}-kept`, 2)];
    expect(orphanBackupDirs(names, '/backups', installs, now, 60 * 60 * 1000)).toEqual([join('/backups', `${now - 40 * DAY}-thornwood`)]);
    expect(orphanBackupDirs(names, '/backups', [], now)).toHaveLength(3);
  });
});

describe('site data cleanup', () => {
  let userData: string;
  beforeEach(async () => {
    userData = await mkdtemp(join(tmpdir(), 'whimwatch-userdata-'));
    for (const site of ['loverslab', 'patreon']) {
      const dir = join(userData, 'Partitions', site);
      await mkdir(join(dir, 'Network'), { recursive: true });
      await mkdir(join(dir, 'Cache', 'Cache_Data'), { recursive: true });
      await writeFile(join(dir, 'Network', 'Cookies'), 'cookies');
      await writeFile(join(dir, 'Network', 'TransportSecurity'), 'hsts');
      await writeFile(join(dir, 'Cache', 'Cache_Data', 'data_1'), 'page');
      await writeFile(join(dir, 'DIPS'), 'visited sites');
    }
    await mkdir(join(userData, 'Crashpad', 'reports'), { recursive: true });
    await writeFile(join(userData, 'Crashpad', 'reports', 'dump.dmp'), 'memory');
    await writeFile(join(userData, 'state.json'), '{}');
  });
  afterEach(() => rm(userData, { recursive: true, force: true }));

  it('keeps only the cookie database when sign-ins are kept', async () => {
    await wipeSiteDataOnDisk(userData, true);
    const dir = join(userData, 'Partitions', 'loverslab');
    expect(existsSync(join(dir, 'Network', 'Cookies'))).toBe(true);
    expect(existsSync(join(dir, 'Network', 'TransportSecurity'))).toBe(false);
    expect(existsSync(join(dir, 'Cache'))).toBe(false);
    expect(existsSync(join(dir, 'DIPS'))).toBe(false);
    expect(existsSync(join(userData, 'Crashpad', 'reports'))).toBe(false);
    expect(existsSync(join(userData, 'state.json'))).toBe(true);
  });

  it('removes everything, sign-ins included, when asked', async () => {
    await wipeSiteDataOnDisk(userData, false);
    expect(existsSync(join(userData, 'Partitions', 'patreon'))).toBe(false);
    expect(await dirSize(join(userData, 'Partitions'))).toBe(0);
  });
});
