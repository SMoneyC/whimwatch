import { ArrowRightLeft, BellOff, CheckCircle2, Download, ExternalLink, FolderOpen, Gamepad2, Info, Minus, Plus, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { UpdatePlan } from '../../shared/api';
import type { UpdateSite } from '../../shared/types';
import { laterSources, laterSourcesText } from '../../shared/updatable';
import { formatVersion } from '../../shared/version';
import { Dialog, useConfirm } from './dialog';
import { CORE_KEY, downloadOptions } from './eligibility';
import { fileName, formatBytes, formatCount, formatShortDate, plural, SOURCE_LABEL, timeAgo } from './format';
import { useToast } from './toast';
import { api, type AppModel } from './useApp';
import { useSiteToggle } from './useSiteToggle';
import { Banner, Button, Checkbox, Disclosure, Segmented, Spinner } from './ui';

export interface UpdateTarget {
  key: string;
  name: string;
}

const isGameWarning = (w: string): boolean => w.startsWith('The Sims 4 is running');

/** Shows what an update will change, then installs it. */
export function UpdateDialog({ target, app, onClose }: { target: UpdateTarget; app: AppModel; onClose: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const toggleSite = useSiteToggle(app);
  const [plan, setPlan] = useState<UpdatePlan>();
  const [failed, setFailed] = useState<string>();
  const [remove, setRemove] = useState<string[]>([]);
  const [skip, setSkip] = useState<string[]>([]);
  const [installing, setInstalling] = useState(false);
  const [gameOpen, setGameOpen] = useState(false);
  const [showBackups, setShowBackups] = useState(false);
  // Sources as they were when the dialog opened; the newest is the default.
  const [options] = useState(() => (app.snapshot ? downloadOptions(target.key, app.snapshot) : []));
  // Undefined lets the app pick (newest, then most files); the plan reports what it chose.
  const [sourceUrl, setSourceUrl] = useState<string>();
  const progress = app.updates[target.key];
  const snapshot = app.snapshot;
  const creator = snapshot?.lastResult?.creators.find((c) => c.key === target.key);

  const chooseSource = (url: string): void => {
    if (url === (sourceUrl ?? plan?.downloadUrl)) return;
    setPlan(undefined);
    setFailed(undefined);
    setRemove([]);
    setSkip([]);
    setSourceUrl(url);
  };

  useEffect(() => {
    let cancelled = false;
    api.planUpdate(target.key, sourceUrl).then(
      (p) => {
        if (cancelled) return;
        setPlan(p);
        setGameOpen(p.warnings.some(isGameWarning));
      },
      (err: Error) => !cancelled && setFailed(err.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')),
    );
    return () => {
      cancelled = true;
    };
  }, [target.key, sourceUrl]);

  // "Close the game to install": look again whenever the user comes back to the window, and every few seconds.
  useEffect(() => {
    if (!gameOpen) return;
    const recheck = (): void => void api.isGameRunning().then(setGameOpen, () => undefined);
    const timer = setInterval(recheck, 5000);
    window.addEventListener('focus', recheck);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', recheck);
    };
  }, [gameOpen]);

  const close = (): void => {
    // Stops any download in progress and throws away the downloaded files.
    if (!installing) void api.cancelUpdate(target.key);
    onClose();
  };

  const install = async (): Promise<void> => {
    if (!plan) return;
    setInstalling(true);
    const done = await app.run(() => api.applyUpdate(plan.id, { remove, skip }));
    setInstalling(false);
    if (!done) return;
    const record = [...done.installs].reverse().find((i) => i.creatorKey === target.key);
    toast({
      text: `Updated ${target.name}`,
      action: record ? { label: 'Undo', run: () => void app.run(() => api.undoInstall(record.id)) } : undefined,
    });
    onClose();
  };

  const busy = !plan && !failed;
  const shownUrl = sourceUrl ?? plan?.downloadUrl ?? options[0]?.url;
  const shownLabel = options.find((o) => o.url === shownUrl)?.label ?? (plan ? SOURCE_LABEL[plan.source] : options[0]?.label);

  const replaceFiles = plan?.files.filter((f) => f.kind === 'replace' && !f.unchanged) ?? [];
  const addFiles = plan?.files.filter((f) => f.kind === 'add') ?? [];
  const unchanged = plan?.files.filter((f) => f.unchanged) ?? [];
  const chosenReplace = replaceFiles.filter((f) => !skip.includes(f.target)).length;
  const chosenAdd = addFiles.filter((f) => !skip.includes(f.target)).length;
  const otherWarnings = plan?.warnings.filter((w) => !isGameWarning(w)) ?? [];
  const nothingChosen = chosenReplace + chosenAdd + remove.length === 0;
  const later = plan?.upToDate ? laterSources(creator?.remotes ?? [], plan.downloadUrl) : [];

  const stopChecking = async (site: UpdateSite): Promise<void> => {
    const label = SOURCE_LABEL[site];
    const ok = await confirm({
      title: `Stop checking ${label}?`,
      body: `WhimWatch won't contact ${label} or show its updates for any creator. You can turn it back on in Settings → General.`,
      confirmLabel: `Stop checking ${label}`,
    });
    if (ok) await toggleSite(site, false);
  };

  // "This replaces 1 file and adds 1." — the unit is named once.
  const changes = [
    ['replaces', chosenReplace],
    ['adds', chosenAdd],
    ['removes', remove.length],
  ] as const;
  const summary = changes.filter(([, n]) => n > 0).map(([verb, n], i) => `${verb} ${i === 0 ? plural(n, 'file') : formatCount(n)}`);
  const leftAlone = unchanged.length + (plan?.skipped.length ?? 0);

  const subtitle =
    target.key !== CORE_KEY && creator?.remoteUpdatedAt !== undefined
      ? `New release ${timeAgo(creator.remoteUpdatedAt)} · you have files from ${formatShortDate(creator.localUpdatedAt)}`
      : undefined;

  return (
    <Dialog
      title={`Update ${target.name}`}
      subtitle={subtitle}
      onClose={close}
      dismissable={!installing}
      width={640}
      footer={
        <>
          {plan && !plan.upToDate && (
            <button type="button" className="link-btn accent" aria-expanded={showBackups} onClick={() => setShowBackups(!showBackups)}>
              <Info size={15} aria-hidden="true" /> How backups work
            </button>
          )}
          <span className="spacer" />
          <Button variant="quiet" onClick={close} disabled={installing}>
            Cancel
          </Button>
          {plan?.upToDate ? (
            <Button
              variant="primary"
              onClick={async () => {
                // With a newer post elsewhere, hide that one too, like "Mark as seen" on the creator's row.
                const newest = later.length ? creator?.remoteUpdatedAt : undefined;
                const seen = await app.run(() => (newest !== undefined ? api.dismiss(target.key, newest) : api.markSeen(target.key, plan.downloadUrl)));
                if (seen) close();
              }}
            >
              {later.length ? 'Mark all as seen' : 'Mark as seen'}
            </Button>
          ) : (
            <Button variant="primary" icon={gameOpen ? Gamepad2 : Download} onClick={install} disabled={!plan || installing || gameOpen || nothingChosen}>
              {installing ? 'Installing…' : gameOpen ? 'Close the game to install' : 'Install update'}
            </Button>
          )}
        </>
      }
    >
      <div className="source-bar">
        <span className="muted">Download from</span>
        {options.length > 1 ? (
          <Segmented
            label="Download from"
            value={shownUrl}
            onChange={chooseSource}
            options={options.map((o) => ({
              value: o.url,
              disabled: busy || installing,
              label: (
                <>
                  <strong>{o.label}</strong>{' '}
                  <span className="faint">
                    {formatShortDate(o.updatedAt)}
                    {o.version && ` · ${formatVersion(o.version)}`}
                  </span>
                </>
              ),
            }))}
          />
        ) : (
          <strong>{shownLabel ?? 'No available source'}</strong>
        )}
        {shownUrl && (
          <button
            type="button"
            className="link-btn accent"
            title={`${shownUrl}\nRight-click for a private window`}
            onClick={() => app.run(() => api.openExternal(shownUrl))}
            onContextMenu={(e) => {
              e.preventDefault();
              void app.run(() => api.showLinkMenu(shownUrl));
            }}
          >
            Open page <ExternalLink size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      {busy && (
        <div className="progress-block" role="status">
          <p className="row-center">
            <Spinner /> {progress?.message ?? 'Preparing the download…'}
          </p>
          <ProgressBar received={progress?.received} total={progress?.total} />
          {!sourceUrl && options.length > 1 && <p className="faint small">Choosing the newest source with the most files.</p>}
        </div>
      )}
      {failed && (
        <Banner tone="error" title="Couldn't prepare this update">
          {failed}
        </Banner>
      )}

      {gameOpen && plan && !plan.upToDate && (
        <Banner tone="error" title="The Sims 4 is open">
          Close the game to install. WhimWatch checks again when you come back to this window.
        </Banner>
      )}

      {plan?.upToDate && (
        later.length ? (
          <Banner
            tone="info"
            title={`Nothing new on ${shownLabel ?? 'this source'}`}
            actions={later.map((r) => (
              <Button key={r.listing.url} size="sm" icon={ExternalLink} onClick={() => app.run(() => api.openExternal(r.listing.url))}>
                Open {SOURCE_LABEL[r.listing.source]}
              </Button>
            ))}
          >
            <p>
              Your files match the ones on {shownLabel ?? 'this source'}. {laterSourcesText(later)}, so the new release may only be there.
            </p>
            {later.map((r) => {
              const site = r.listing.source as UpdateSite;
              return (
                <p key={r.listing.url} className="off-links">
                  <button type="button" className="link-btn accent" onClick={() => void toggleSite(site, false, target.key)}>
                    <BellOff size={14} aria-hidden="true" /> Don't check {SOURCE_LABEL[site]} for {target.name}
                  </button>
                  <button type="button" className="link-btn accent" onClick={() => void stopChecking(site)}>
                    Stop checking {SOURCE_LABEL[site]} for every creator…
                  </button>
                </p>
              );
            })}
          </Banner>
        ) : (
          <Banner tone="ok" title="Already up to date">
            Your files match the ones on {shownLabel ?? 'this source'}, so there's nothing to install. Mark it as seen to hide this update
            until a newer one appears.
          </Banner>
        )
      )}

      {plan && !plan.upToDate && (
        <>
          <div className="plan-summary">
            <span className="tone-icon mint">
              <ShieldCheck size={20} aria-hidden="true" />
            </span>
            <div>
              <strong>{summary.length ? `This ${summary.join(' and ')}.` : 'Nothing selected.'}</strong>
              <p className="muted">
                Your current files are backed up first. You can undo this from History.
                {plan.downloads.length > 1 && ` ${plural(plan.downloads.length, 'download')} from ${shownLabel}.`}
              </p>
            </div>
          </div>

          {showBackups && (
            <div className="explain small">
              Before anything is replaced or removed, WhimWatch moves your current files into a new folder inside <code>{snapshot?.backupRoot}</code>.
              Undo in History puts them back.{' '}
              {snapshot && snapshot.settings.keepBackupsDays > 0
                ? `Backups are deleted after ${snapshot.settings.keepBackupsDays} days.`
                : 'Backups are kept until you delete them.'}{' '}
              <button type="button" className="link-btn accent" onClick={() => app.run(() => api.openBackupFolder())}>
                <FolderOpen size={14} aria-hidden="true" /> Open backups folder
              </button>
            </div>
          )}

          {otherWarnings.map((w) => (
            <Banner key={w} tone="warn">
              {w}
            </Banner>
          ))}

          <div className="file-changes">
            {[...replaceFiles, ...addFiles].map((f) => (
              <FileLine key={f.target} kind={f.kind} path={f.target} checked={!skip.includes(f.target)} onToggle={() => setSkip(toggle(skip, f.target))} />
            ))}
            {plan.possiblyObsolete.length > 0 && (
              <div className="file-section">
                <div className="section-label">Not in this download</div>
                <p className="muted small">Might be an older version, or an extra you got elsewhere. Tick it to remove it (it's backed up too).</p>
                {plan.possiblyObsolete.map((path) => (
                  <FileLine key={path} kind="remove" path={path} checked={remove.includes(path)} onToggle={() => setRemove(toggle(remove, path))} />
                ))}
              </div>
            )}
            {leftAlone > 0 && (
              <Disclosure
                className="left-alone"
                summary={`${formatCount(leftAlone)} more left alone: ${[
                  unchanged.length > 0 && `${formatCount(unchanged.length)} already identical`,
                  plan.skipped.length > 0 && `${formatCount(plan.skipped.length)} ${plan.skipped.length === 1 ? "isn't a mod file" : "aren't mod files"}`,
                ]
                  .filter(Boolean)
                  .join(', ')}`}
              >
                <ul className="plain-list mono small">
                  {unchanged.map((f) => (
                    <li key={f.target} title={f.target}>
                      <CheckCircle2 size={13} aria-hidden="true" /> {fileName(f.target)}
                    </li>
                  ))}
                  {plan.skipped.map((name) => (
                    <li key={name} className="faint">
                      <Minus size={13} aria-hidden="true" /> {name}
                    </li>
                  ))}
                </ul>
              </Disclosure>
            )}
          </div>
          {installing && progress && <p className="muted small">{progress.message}</p>}
        </>
      )}
    </Dialog>
  );
}

const KIND = {
  replace: { icon: ArrowRightLeft, label: 'Replace', off: 'Skip' },
  add: { icon: Plus, label: 'Add', off: 'Skip' },
  remove: { icon: Minus, label: 'Remove', off: 'Keep' },
} as const;

function FileLine({ kind, path, checked, onToggle }: { kind: keyof typeof KIND; path: string; checked: boolean; onToggle: () => void }) {
  const { icon: KindIcon, label, off } = KIND[kind];
  return (
    <label className={`file-line kind-${kind} ${checked ? '' : 'off'}`}>
      <Checkbox checked={checked} onChange={onToggle} label={`${label} ${fileName(path)}`} />
      <span className="kind-icon" aria-hidden="true">
        <KindIcon size={14} />
      </span>
      <span className="mono file-line-name" title={path}>
        {fileName(path)}
      </span>
      <span className="kind-label">{checked ? label : off}</span>
    </label>
  );
}

const toggle = (list: string[], value: string): string[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

function ProgressBar({ received, total }: { received?: number; total?: number }) {
  const pct = received !== undefined && total ? Math.min(100, (received / total) * 100) : undefined;
  return (
    <div
      className={`bar ${pct === undefined ? 'indeterminate' : ''}`}
      role="progressbar"
      aria-valuenow={pct === undefined ? undefined : Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={received !== undefined ? `${formatBytes(received)}${total ? ` of ${formatBytes(total)}` : ''}` : undefined}
    >
      <span style={pct === undefined ? undefined : { width: `${pct}%` }} />
    </div>
  );
}
