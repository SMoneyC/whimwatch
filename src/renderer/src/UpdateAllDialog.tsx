import { Ban, CheckCircle2, Circle, Download, History, Info, LogIn, MinusCircle, RotateCcw, XCircle } from 'lucide-react';
import { useState } from 'react';
import type { BatchItem, BatchItemState, BrowserSite } from '../../shared/api';
import { Dialog, useConfirm } from './dialog';
import { AFTER_CHECK, type Candidate, type Ineligible } from './eligibility';
import { formatCount, plural, SOURCE_LABEL } from './format';
import { useToast } from './toast';
import { api, type AppModel } from './useApp';
import { Banner, Button, Checkbox, Spinner } from './ui';

const STATE_ICON: Record<Exclude<BatchItemState, 'working'>, typeof Circle> = {
  queued: Circle,
  done: CheckCircle2,
  failed: XCircle,
  cancelled: MinusCircle,
};

/**
 * Picks which updates to install, shows progress, then sums up. Closing it
 * while it runs doesn't stop anything ("Run in background").
 */
export function UpdateAllDialog({
  app,
  eligible,
  ineligible,
  onClose,
  onShowHistory,
}: {
  app: AppModel;
  eligible: Candidate[];
  ineligible: Ineligible[];
  onClose: () => void;
  onShowHistory: () => void;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const batch = app.batch;
  const [started, setStarted] = useState(Boolean(batch?.running));
  const [unticked, setUnticked] = useState<string[]>([]);
  const selected = eligible.filter((c) => !unticked.includes(c.key));

  const start = async (): Promise<void> => {
    const ok = await app.run(async () => {
      await api.updateAll(selected.map((c) => c.key));
      return true;
    });
    if (ok) setStarted(true);
  };

  const phase = !started || !batch ? 'pick' : batch.running ? 'running' : 'done';
  const finished = batch?.items.filter((i) => i.state === 'done' || i.state === 'failed').length ?? 0;
  const installed = batch?.items.filter((i) => i.state === 'done' && i.replaced !== undefined) ?? [];
  const failed = batch?.items.filter((i) => i.state === 'failed') ?? [];
  const signInSites = [...new Set(ineligible.flatMap((i) => (i.signIn ? [i.signIn] : [])))];

  const undoAll = async (): Promise<void> => {
    if (!batch?.batchId) return;
    const ok = await confirm({
      title: `Undo ${plural(installed.length, 'update')}?`,
      body: 'Your previous files are put back from the backups. The updates will show as available again.',
      confirmLabel: 'Undo all',
    });
    if (!ok) return;
    if (await app.run(() => api.undoBatch(batch.batchId!))) {
      toast({ text: `Undid ${plural(installed.length, 'update')}` });
      onClose();
    }
  };

  if (phase === 'pick') {
    const allTicked = unticked.length === 0;
    return (
      <Dialog
        title="Update all"
        subtitle="Each pack comes from the newest source you can download from. Your current files are backed up first, and nothing is removed."
        onClose={onClose}
        width={600}
        footer={
          <>
            <span className="spacer" />
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" icon={Download} onClick={start} disabled={!selected.length || app.snapshot?.running}
              title={app.snapshot?.running ? AFTER_CHECK : undefined}
            >
              Update {formatCount(selected.length)}
            </Button>
          </>
        }
      >
        <div className="list-head compact">
          <span className="section-label">Will update · {formatCount(selected.length)}</span>
          <span className="spacer" />
          <button type="button" className="link-btn accent" onClick={() => setUnticked(allTicked ? eligible.map((c) => c.key) : [])}>
            {allTicked ? 'Select none' : 'Select all'}
          </button>
        </div>
        <ul className="pick-list">
          {eligible.map((c) => (
            <li key={c.key}>
              <label className="pick-line">
                <Checkbox
                  checked={!unticked.includes(c.key)}
                  onChange={() => setUnticked((prev) => (prev.includes(c.key) ? prev.filter((k) => k !== c.key) : [...prev, c.key]))}
                  label={`Update ${c.name}`}
                />
                <span className="pick-name">{c.name}</span>
                <span className="faint">from {c.source}</span>
              </label>
            </li>
          ))}
        </ul>
        {ineligible.length > 0 && <LeftOut ineligible={ineligible} sites={signInSites} app={app} />}
      </Dialog>
    );
  }

  if (phase === 'running') {
    return (
      <Dialog
        title={`Updating ${formatCount(Math.min(finished + 1, batch!.items.length))} of ${formatCount(batch!.items.length)}`}
        subtitle={batch!.stopRequested ? 'Stopping after the current one.' : 'You can keep using WhimWatch while this runs.'}
        onClose={onClose}
        width={600}
        footer={
          <>
            <Button variant="quiet" onClick={() => app.run(() => api.stopUpdateAll())} disabled={batch!.stopRequested}>
              Stop after this one
            </Button>
            <Button variant="quiet" onClick={() => app.run(() => api.cancelUpdateAll())}>
              Cancel now
            </Button>
            <span className="spacer" />
            <Button variant="primary" onClick={onClose}>
              Run in background
            </Button>
          </>
        }
      >
        <BatchList items={batch!.items} app={app} />
      </Dialog>
    );
  }

  const title = installed.length
    ? failed.length
      ? `${plural(installed.length, 'pack')} updated, ${formatCount(failed.length)} failed`
      : `${plural(installed.length, 'pack')} updated`
    : failed.length
      ? 'Nothing was updated'
      : 'Update all finished';
  const keepDays = app.snapshot?.settings.keepBackupsDays ?? 0;

  return (
    <Dialog
      title={title}
      onClose={onClose}
      width={600}
      className="done-dialog"
      footer={
        <>
          {installed.length > 0 && batch?.batchId && (
            <Button variant="quiet" icon={RotateCcw} onClick={undoAll}>
              Undo all
            </Button>
          )}
          <span className="spacer" />
          <Button
            icon={History}
            onClick={() => {
              onClose();
              onShowHistory();
            }}
          >
            View history
          </Button>
          <Button variant="primary" onClick={onClose} data-autofocus>
            Done
          </Button>
        </>
      }
    >
      <div className="done-hero">
        <span className={`tone-icon round big ${installed.length ? 'mint' : 'amber'}`}>
          {installed.length ? <CheckCircle2 size={26} aria-hidden="true" /> : <Ban size={24} aria-hidden="true" />}
        </span>
        {installed.length > 0 && (
          <p className="muted">
            {failed.length ? 'The rest are current. ' : 'Everything you picked is current. '}
            {keepDays > 0 ? `Your old files are backed up for ${keepDays} days.` : 'Your old files are backed up until you delete them.'}
          </p>
        )}
      </div>
      <BatchList items={batch!.items} app={app} summary />
      {ineligible.length > 0 && <LeftOut ineligible={ineligible} sites={signInSites} app={app} />}
    </Dialog>
  );
}

function BatchList({ items, app, summary }: { items: BatchItem[]; app: AppModel; summary?: boolean }) {
  return (
    <ul className="batch-list">
      {items.map((item) => {
        const IconComponent = item.state === 'working' ? undefined : STATE_ICON[item.state];
        const detail =
          item.state === 'working'
            ? (app.updates[item.key]?.message ?? 'Starting…')
            : item.state === 'queued'
              ? 'Waiting'
              : item.state === 'cancelled'
                ? 'Not started'
                : summary && item.state === 'done' && item.replaced !== undefined
                  ? [item.replaced && plural(item.replaced, 'file') + ' replaced', item.added && `${formatCount(item.added)} added`].filter(Boolean).join(' · ') ||
                    'Installed'
                  : item.message;
        return (
          <li key={item.key} className={`batch-item state-${item.state}`}>
            <span className="batch-icon">{IconComponent ? <IconComponent size={18} aria-hidden="true" /> : <Spinner size={18} />}</span>
            <span className="batch-name">
              {item.name}
              {item.source && <span className="faint"> from {item.source}</span>}
            </span>
            <span className={`batch-detail small ${item.state === 'failed' ? 'error-text' : 'faint'}`}>{detail}</span>
            <span className="visually-hidden">{item.state}</span>
          </li>
        );
      })}
    </ul>
  );
}

function LeftOut({ ineligible, sites, app }: { ineligible: Ineligible[]; sites: BrowserSite[]; app: AppModel }) {
  return (
    <Banner
      tone="info"
      title={`${plural(ineligible.length, 'update')} ${ineligible.length === 1 ? "isn't" : "aren't"} included`}
      actions={sites.map((site) => (
        <Button key={site} size="sm" icon={LogIn} onClick={() => app.run(() => api.signIn(site))}>
          Sign in to {SOURCE_LABEL[site]}
        </Button>
      ))}
    >
      <ul className="plain-list small">
        {ineligible.map((c) => (
          <li key={c.key}>
            <strong>{c.name}</strong> <span className="muted">· {c.reason}</span>
          </li>
        ))}
      </ul>
      <p className="faint small">
        <Info size={12} aria-hidden="true" /> Open a creator's row to download it yourself.
      </p>
    </Banner>
  );
}
