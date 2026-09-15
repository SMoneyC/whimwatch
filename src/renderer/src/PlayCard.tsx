import { AlertTriangle, Ban, CheckCircle2, Download, ExternalLink, EyeOff, Gamepad2, RotateCcw } from 'lucide-react';
import type { CoreResult, GameInfo } from '../../shared/types';
import { CORE_KEY, coreUpdatable } from './eligibility';
import { formatCalendarDate, formatShortDate } from './format';
import { gameHealth } from './health';
import { api, type AppModel } from './useApp';
import { Button, MenuButton, type MenuItem, StatusMarker } from './ui';

const TONE_ICON = { ok: CheckCircle2, warn: AlertTriangle, error: Ban, neutral: Gamepad2 } as const;

/**
 * "Will WickedWhims work tonight?": the game's state and WickedWhims itself in
 * one card. A healthy game is a slim bar; a problem gets room to explain itself.
 */
export function PlayCard({ core, game, app, onUpdate }: { core: CoreResult; game?: GameInfo; app: AppModel; onUpdate: () => void }) {
  const snapshot = app.snapshot!;
  const health = gameHealth(game, core, snapshot.dismissedGameWarnings);
  const ToneIcon = TONE_ICON[health.tone];
  const big = health.tone === 'warn' || health.tone === 'error';

  const ww = <WickedWhimsLine core={core} app={app} onUpdate={onUpdate} compact={!big} />;

  if (!big) {
    return (
      <section className={`card play-card slim tone-${health.tone}`} aria-label="Game and WickedWhims">
        <span className="tone-icon round">
          <ToneIcon size={16} aria-hidden="true" />
        </span>
        <strong>{health.title}</strong>
        <span className="muted play-text">{health.text}</span>
        <span className="spacer" />
        {ww}
      </section>
    );
  }

  return (
    <section className={`card play-card tone-${health.tone}`} aria-label="Game and WickedWhims">
      <div className="play-main">
        <span className="tone-icon">
          <ToneIcon size={22} aria-hidden="true" />
        </span>
        <div className="play-copy">
          <h2>{health.title}</h2>
          <p className="muted">{health.text}</p>
          {health.warnings.slice(1).map((w) => (
            <p key={w.id} className="muted small play-extra">
              <AlertTriangle size={14} aria-hidden="true" /> {w.text}
            </p>
          ))}
          <Button
            variant="quiet"
            size="sm"
            icon={EyeOff}
            className="play-hide"
            onClick={() => app.run(async () => {
              for (const w of health.warnings) await api.dismissGameWarning(w.id);
            })}
          >
            Hide until the game updates
          </Button>
        </div>
        {(health.yourGame || health.supportedUpTo) && (
          <dl className="versions">
            <div>
              <dt>Your game</dt>
              <dd className={`mono ${health.tone === 'warn' ? 'warn-text' : ''}`}>{health.yourGame ?? '—'}</dd>
            </div>
            <div>
              <dt>Supported up to</dt>
              <dd className="mono">{health.supportedUpTo ?? '—'}</dd>
            </div>
          </dl>
        )}
      </div>
      <div className="play-ww">{ww}</div>
    </section>
  );
}

function WickedWhimsLine({ core, app, onUpdate, compact }: { core: CoreResult; app: AppModel; onUpdate: () => void; compact: boolean }) {
  const installed = core.installed;
  const busy = app.updates[CORE_KEY];
  const menu: MenuItem[] = [];
  if (core.downloadPageUrl) menu.push({ label: 'Open download page', icon: ExternalLink, onSelect: () => void app.run(() => api.openExternal(core.downloadPageUrl!)) });
  if (core.status === 'update-available' && core.releasedAt !== undefined) {
    menu.push({ label: 'Mark as seen', icon: EyeOff, onSelect: () => void app.run(() => api.dismiss(CORE_KEY, core.releasedAt!)) });
  }
  if (core.status !== 'update-available' && app.snapshot?.seenHistory.some((e) => !e.undoneAt && e.entries.some((x) => x.key === CORE_KEY))) {
    menu.push({ label: 'Undo mark as seen', icon: RotateCcw, onSelect: () => void app.run(() => api.undismiss(CORE_KEY)) });
  }

  // The compact line names WickedWhims itself; the full card already has it as a heading.
  const subject = compact ? 'WickedWhims ' : '';
  let detail: string;
  if (core.error && !core.latestVersion) detail = "Couldn't read the WickedWhims download page";
  else if (!installed) detail = `${compact ? "WickedWhims isn't" : "Isn't"} in your Mods folders${core.latestVersion ? ` · v${core.latestVersion} is the latest` : ''}`;
  else if (core.status === 'update-available') detail = `${subject}v${core.latestVersion} is out · you have the ${formatShortDate(installed.mtimeMs)} build`;
  else detail = core.latestVersion ? `${subject}v${core.latestVersion} · released ${formatCalendarDate(core.releasedAt)}` : `${subject}installed ${formatShortDate(installed.mtimeMs)}`;

  return (
    <div className={`ww-line ${compact ? 'compact' : ''}`}>
      {!compact && (
        <span className="ww-name">
          WickedWhims <span className="faint">by TURBODRIVER</span>
        </span>
      )}
      <span className={`ww-detail ${core.error && !core.latestVersion ? 'error-text' : 'muted'}`}>{detail}</span>
      {!compact && <span className="spacer" />}
      {installed && core.status === 'update-available' && !compact && <StatusMarker status="update" />}
      {installed && core.status === 'up-to-date' && !compact && <StatusMarker status="current" />}
      {coreUpdatable(core) && (
        <Button size="sm" icon={Download} onClick={onUpdate} disabled={busy !== undefined && busy.stage !== 'done' && busy.stage !== 'error'}>
          Update
        </Button>
      )}
      {!installed && core.downloadPageUrl && (
        <Button size="sm" icon={ExternalLink} onClick={() => app.run(() => api.openExternal(core.downloadPageUrl!))}>
          Download page
        </Button>
      )}
      {menu.length > 0 && installed && <MenuButton label="More for WickedWhims" items={menu} />}
    </div>
  );
}
