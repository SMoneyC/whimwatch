import { lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { InstallRecord } from '../shared/types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Backup folders are named `<timestamp>-<random>` by applyInstall (older versions: `<timestamp>-<creator>`); nothing else is ever deleted. */
const BACKUP_DIR_NAME = /^\d{13}-[a-z0-9_-]*$/i;

export function hasLiveBackup(record: InstallRecord): boolean {
  return !record.undoneAt && !record.backupDeletedAt;
}

/** Installs whose backups are older than `keepDays` (0 keeps them forever). */
export function expiredBackups(installs: InstallRecord[], keepDays: number, now: number): InstallRecord[] {
  if (keepDays <= 0) return [];
  return installs.filter((r) => hasLiveBackup(r) && r.at < now - keepDays * DAY_MS);
}

/**
 * Backup folders on disk that no install record with a live backup points to.
 * Folders younger than `minAgeMs` are left alone: an install may be writing
 * its backup before its record is saved.
 */
export function orphanBackupDirs(dirNames: string[], backupRoot: string, installs: InstallRecord[], now: number, minAgeMs = 0): string[] {
  const live = new Set(installs.filter(hasLiveBackup).map((r) => r.backupDir));
  return dirNames
    .filter((name) => BACKUP_DIR_NAME.test(name) && Number(name.slice(0, 13)) <= now - minAgeMs)
    .map((name) => join(backupRoot, name))
    .filter((dir) => !live.has(dir));
}

export async function listDirNames(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Total size of regular files under `path` (0 if missing). Symlinks aren't followed. */
export async function dirSize(path: string): Promise<number> {
  let total = 0;
  const visit = async (p: string): Promise<void> => {
    let st;
    try {
      st = await lstat(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const name of await readdir(p).catch(() => [] as string[])) await visit(join(p, name));
    } else if (st.isFile()) {
      total += st.size;
    }
  };
  await visit(path);
  return total;
}
