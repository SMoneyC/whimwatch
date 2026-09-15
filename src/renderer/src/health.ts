import { compareVersions, gameWarnings, type GameWarning } from '../../shared/game';
import type { CoreResult, GameInfo } from '../../shared/types';

export interface GameHealth {
  tone: 'ok' | 'warn' | 'error' | 'neutral';
  title: string;
  text: string;
  /** The game's own version, e.g. "1.128.10". */
  yourGame?: string;
  /** The newest version WickedWhims supports. */
  supportedUpTo?: string;
  /** Every warning still showing, most serious first (the title describes the first). */
  warnings: GameWarning[];
  /** Warnings the user hid until the next game update. */
  hidden: number;
}

/**
 * Answers "will WickedWhims work tonight?" from the game's files and the
 * WickedWhims download page. Good news is short; problems explain themselves.
 */
export function gameHealth(game: GameInfo | undefined, core: CoreResult, dismissed: string[]): GameHealth {
  const all = gameWarnings(game, core);
  const warnings = all.filter((w) => !dismissed.includes(w.id)).sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'error' ? -1 : 1));
  const yourGame = game?.version?.split('.').slice(0, 3).join('.');
  const supported = core.supportedGameVersions ?? [];
  const supportedUpTo = supported.length ? [...supported].sort(compareVersions).at(-1) : undefined;
  const base = { yourGame, supportedUpTo, warnings, hidden: all.length - warnings.length };
  const first = warnings[0];

  if (first) {
    const kind = first.id.split(':')[0];
    if (kind === 'mods-off' || kind === 'script-mods-off') return { ...base, tone: 'error', title: "WickedWhims won't load", text: first.text };
    if (kind === 'game-newer') {
      return {
        ...base,
        tone: 'warn',
        title: 'Hold off playing for now',
        text: `The Sims 4 was patched to ${yourGame}, but WickedWhims only supports up to ${supportedUpTo}. Script mods often break after a patch. WhimWatch will flag the WickedWhims update as soon as it's out.`,
      };
    }
    if (kind === 'game-older') return { ...base, tone: 'warn', title: 'Your game is older than WickedWhims supports', text: first.text };
    return { ...base, tone: 'warn', title: "Your game version isn't on the supported list", text: first.text };
  }
  if (yourGame && supportedUpTo && supported.includes(yourGame)) {
    return { ...base, tone: 'ok', title: 'Ready to play', text: `WickedWhims supports your game version (${yourGame})` };
  }
  if (base.hidden) return { ...base, tone: 'neutral', title: 'Game warning hidden', text: 'Until The Sims 4 updates again' };
  if (!yourGame) return { ...base, tone: 'neutral', title: 'Game version unknown', text: "WhimWatch couldn't find The Sims 4's version next to your Mods folder" };
  return { ...base, tone: 'neutral', title: 'Supported versions unknown', text: "The WickedWhims page didn't list supported game versions" };
}
