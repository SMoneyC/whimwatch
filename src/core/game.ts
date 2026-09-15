import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { GameInfo } from '../shared/types.js';

/**
 * Reads the game's own files next to the Mods folder: GameVersion.txt (the
 * installed patch) and Options.ini (whether mods and script mods are on).
 */
export async function readGameInfo(dirs: string[]): Promise<GameInfo | undefined> {
  const mods = dirs.find((d) => basename(d).toLowerCase() === 'mods');
  if (!mods) return undefined;
  const gameDir = dirname(mods);
  const [versionFile, options] = await Promise.all([
    readFile(join(gameDir, 'GameVersion.txt')).catch(() => undefined),
    readFile(join(gameDir, 'Options.ini'), 'utf8').catch(() => undefined),
  ]);
  if (!versionFile && options === undefined) return undefined;
  return { version: versionFile ? parseGameVersion(versionFile) : undefined, ...(options ? parseOptionsIni(options) : {}) };
}

/** GameVersion.txt starts with a binary length prefix, then e.g. "1.127.41.1030". */
export function parseGameVersion(data: Buffer): string | undefined {
  return /\d+\.\d+\.\d+(?:\.\d+)?/.exec(data.toString('latin1'))?.[0];
}

export function parseOptionsIni(text: string): Pick<GameInfo, 'modsEnabled' | 'scriptModsEnabled'> {
  const value = (key: string): string | undefined => new RegExp(`^\\s*${key}\\s*=\\s*(\\S+)`, 'mi').exec(text)?.[1];
  const disabled = value('modsdisabled');
  const scripts = value('scriptmodsenabled');
  return {
    modsEnabled: disabled === undefined ? undefined : disabled === '0',
    scriptModsEnabled: scripts === undefined ? undefined : scripts === '1',
  };
}
