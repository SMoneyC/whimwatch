import { compareVersions, gameWarnings, type GameWarning } from '../../shared/game';
import { t } from '../../shared/i18n';
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
  const m = t().health;

  if (first) {
    const kind = first.id.split(':')[0];
    if (kind === 'mods-off' || kind === 'script-mods-off') return { ...base, tone: 'error', title: m.wontLoad, text: first.text };
    if (kind === 'game-newer') return { ...base, tone: 'warn', title: m.unsupportedTitle, text: m.unsupported(yourGame ?? '', supportedUpTo ?? '') };
    if (kind === 'game-older') return { ...base, tone: 'warn', title: m.olderTitle, text: first.text };
    return { ...base, tone: 'warn', title: m.unlistedTitle, text: first.text };
  }
  if (yourGame && supportedUpTo && supported.includes(yourGame)) return { ...base, tone: 'ok', title: m.readyTitle, text: m.ready(yourGame) };
  if (base.hidden) return { ...base, tone: 'neutral', title: m.hiddenTitle, text: m.hidden };
  if (!yourGame) return { ...base, tone: 'neutral', title: m.unknownGameTitle, text: m.unknownGame };
  return { ...base, tone: 'neutral', title: m.unknownSupportTitle, text: m.unknownSupport };
}
