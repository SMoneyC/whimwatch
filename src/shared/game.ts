import type { CoreResult, GameInfo } from './types.js';

export interface GameWarning {
  /** Stable while the game version stays the same, so a hidden warning comes back after a patch. */
  id: string;
  tone: 'warn' | 'error';
  text: string;
}

/** Compares dotted versions numerically; missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

/**
 * Things that stop WickedWhims working that aren't about updates: mods or
 * script mods switched off (EA does this after patches), or a game patch newer
 * than WickedWhims supports.
 */
export function gameWarnings(game: GameInfo | undefined, core: CoreResult): GameWarning[] {
  if (!game) return [];
  const warnings: GameWarning[] = [];
  const gameVersion = game.version ?? 'unknown';
  if (game.modsEnabled === false) {
    warnings.push({
      id: `mods-off:${gameVersion}`,
      tone: 'error',
      text: 'Mods are turned off in The Sims 4 (Game Options → Other → Enable Custom Content and Mods), so nothing in your Mods folder will load.',
    });
  }
  if (game.scriptModsEnabled === false) {
    warnings.push({
      id: `script-mods-off:${gameVersion}`,
      tone: 'error',
      text: "Script mods are turned off in The Sims 4 (Game Options → Other → Script Mods Allowed), so WickedWhims won't load.",
    });
  }

  const supported = core.supportedGameVersions ?? [];
  if (game.version && supported.length) {
    // GameVersion.txt has a build number ("1.127.41.1030"); the list uses three parts.
    const installed = game.version.split('.').slice(0, 3).join('.');
    const newest = [...supported].sort(compareVersions).at(-1)!;
    const oldest = [...supported].sort(compareVersions)[0]!;
    const ww = core.latestVersion ? `WickedWhims v${core.latestVersion}` : 'WickedWhims';
    if (supported.includes(installed)) {
      // Supported.
    } else if (compareVersions(installed, newest) > 0) {
      warnings.push({
        id: `game-newer:${installed}`,
        tone: 'warn',
        text: `The Sims 4 was updated to ${installed}, but ${ww} only supports up to ${newest}. Script mods can break after a patch: consider waiting for a WickedWhims update before playing.`,
      });
    } else if (compareVersions(installed, oldest) < 0) {
      warnings.push({ id: `game-older:${installed}`, tone: 'warn', text: `Your game version ${installed} is older than the oldest version ${ww} supports (${oldest}).` });
    } else {
      warnings.push({ id: `game-unlisted:${installed}`, tone: 'warn', text: `Your game version ${installed} isn't on ${ww}'s supported list.` });
    }
  }
  return warnings;
}
