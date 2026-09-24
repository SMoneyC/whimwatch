import { ArrowLeft, Database, Download, EyeOff, FolderOpen, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { StorageInfo } from '../../shared/api';
import type { InstallRecord } from '../../shared/types';
import { useConfirm } from './dialog';
import { formatBytes, formatCount, formatShortDate, formatTime, plural, SOURCE_LABEL } from './format';
import {
  dayLabel,
  fileCounts,
  type HistoryFilter,
  type HistoryItem,
  historyItems,
  isNewPackInstall,
  isUndone,
  matchesFilter,
  undoRestoresFiles,
} from './history';
import { useToast } from './toast';
import { api, type AppModel } from './useApp';
import { Button, Disclosure, IconButton, Segmented } from './ui';

/** Every change WhimWatch made, with undo: the safety net, out of Settings and in plain view. */
export function HistoryView({ app, onBack, onBackupSettings }: { app: AppModel; onBack: () => void; onBackupSettings: () => void }) {
  const snapshot = app.snapshot!;
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [storage, setStorage] = useState<StorageInfo>();
  const items = useMemo(() => historyItems(snapshot.installs, snapshot.seenHistory), [snapshot.installs, snapshot.seenHistory]);
  const shown = items.filter((i) => matchesFilter(i, filter));

  useEffect(() => {
    api.getStorage().then(setStorage, () => undefined);
  }, [snapshot.installs]);

  const groups: { label: string; items: HistoryItem[] }[] = [];
  for (const item of shown) {
    const label = dayLabel(item.at);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  const keep = snapshot.settings.keepBackupsDays;

  return (
    <main className="content" id="main">
      <div className="content-inner narrow">
        <button type="button" className="back-link" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" /> Creators
        </button>
        <div className="page-head">
          <div>
            <h1>History</h1>
            <p className="muted">Every change WhimWatch made to your Mods folder, newest first. Undo puts your old files back.</p>
          </div>
          <div className="card backup-summary">
            <Database size={16} aria-hidden="true" />
            <span className="muted">
              Backups use <strong>{storage ? formatBytes(storage.backups) : '…'}</strong> · {keep > 0 ? `Kept ${keep} days` : 'Kept until deleted'}
            </span>
            <Button variant="quiet" size="sm" onClick={onBackupSettings}>
              Change
            </Button>
          </div>
        </div>

        <Segmented<HistoryFilter>
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'updates', label: 'Updates' },
            { value: 'seen', label: 'Marked as seen' },
            { value: 'undone', label: 'Undone' },
          ]}
        />

        {groups.length === 0 ? (
          <div className="empty card">
            <p>{filter === 'all' ? "Nothing yet. Updates you install and updates you mark as seen show up here." : 'Nothing here.'}</p>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="history-group" aria-label={g.label}>
              <h2 className="section-label">{g.label}</h2>
              <ul className="card history-list">
                {g.items.map((item) => (
                  <HistoryEntry key={`${item.kind}-${item.id}`} item={item} app={app} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </main>
  );
}

function HistoryEntry({ item, app }: { item: HistoryItem; app: AppModel }) {
  const confirm = useConfirm();
  const toast = useToast();
  const undone = isUndone(item);

  if (item.kind === 'seen') {
    const { event } = item;
    // One click on one creator can mark several of its packs, so count creators rather than marks.
    const names = [...new Set(event.entries.map((e) => e.name))];
    const title = names.length === 1 ? `Marked ${names[0]} as seen` : `Marked ${plural(names.length, 'update')} as seen`;
    const detail = undone
      ? `Undone ${formatShortDate(event.undoneAt)} · These show as updates again`
      : `${event.automatic ? 'The download matched your files' : event.kind === 'all' ? 'Mark all as seen' : 'Hidden until a newer release is posted'} · ${formatTime(event.at)}`;
    return (
      <li className={`history-item ${undone ? 'undone' : ''}`}>
        <span className="history-icon">
          <EyeOff size={18} aria-hidden="true" />
        </span>
        <div className="history-text">
          <span className="history-title">
            {title} {undone && <span className="tag">Undone</span>}
            {event.automatic && !undone && <span className="tag">Automatic</span>}
          </span>
          <span className="faint small">{detail}</span>
          {event.entries.length > 1 && (
            <Disclosure summary="Which ones" className="history-more">
              <p className="muted small">{event.entries.map((e) => e.name).join(', ')}</p>
            </Disclosure>
          )}
        </div>
        {!undone && (
          <Button size="sm" icon={RotateCcw} onClick={() => app.run(() => api.undoSeen(event.id))}>
            Undo
          </Button>
        )}
      </li>
    );
  }

  const records = item.kind === 'batch' ? item.records : [item.record];
  const live = records.filter((r) => !r.undoneAt && !r.backupDeletedAt);
  const counts = fileCounts(records);
  const files = [
    counts.replaced && `${plural(counts.replaced, 'file')} replaced`,
    counts.added && `${formatCount(counts.added)} added`,
    counts.removed && `${formatCount(counts.removed)} removed`,
  ]
    .filter(Boolean)
    .join(', ');
  const automatic = records.some((r) => r.automatic);
  const first = records[0]!;
  // A pack they went and got, rather than an update to something they had.
  const newPack = isNewPackInstall(item);
  const title =
    item.kind === 'batch'
      ? `Updated ${plural(records.length, 'pack')}`
      : `${newPack ? 'Added' : 'Updated'} ${first.name}${first.source ? ` from ${SOURCE_LABEL[first.source]}` : ''}`;

  let detail: string;
  if (undone) {
    // Nothing is backed up for a file that wasn't there before, so undoing a pack only removes it.
    const what = undoRestoresFiles(records) ? 'Your old files were put back' : 'The files it added were removed';
    detail = `Undone ${formatShortDate(Math.max(...records.map((r) => r.undoneAt ?? 0)))} · ${what}`;
  } else if (!live.length) detail = `${backupGone(records)} · ${formatShortDate(item.at)}`;
  else
    detail = `${item.kind === 'batch' ? (automatic ? 'Installed after a check' : 'Update all') : automatic ? 'Installed after a check' : newPack ? 'New pack' : 'Update'} · ${files} · ${formatTime(item.at)}`;

  const undo = async (): Promise<void> => {
    if (item.kind === 'batch') {
      const ok = await confirm({
        title: `Undo ${plural(live.length, 'update')}?`,
        body: 'Your previous files are put back from the backups, newest update first.',
        confirmLabel: 'Undo all',
      });
      if (!ok) return;
      if (await app.run(() => api.undoBatch(item.id))) toast({ text: `Undid ${plural(live.length, 'update')}` });
    } else if (await app.run(() => api.undoInstall(first.id))) {
      toast({ text: newPack ? `Removed the pack from ${first.name}` : `Undid the ${first.name} update` });
    }
  };

  return (
    <li className={`history-item ${undone ? 'undone' : ''} ${!live.length && !undone ? 'expired' : ''}`}>
      <span className="history-icon">
        {undone ? <RotateCcw size={18} aria-hidden="true" /> : <Download size={18} aria-hidden="true" />}
      </span>
      <div className="history-text">
        <span className="history-title">
          {title} {automatic && !undone && <span className="tag">Automatic</span>}
          {undone && <span className="tag">Undone</span>}
        </span>
        <span className="faint small">{detail}</span>
        {item.kind === 'batch' && (
          <Disclosure summary="Which packs" className="history-more">
            <ul className="plain-list small">
              {records.map((r) => (
                <li key={r.id} className={r.undoneAt ? 'faint' : ''}>
                  {r.name}
                  {r.source && <span className="faint"> from {SOURCE_LABEL[r.source]}</span>}
                  {r.undoneAt && <span className="faint"> · Undone</span>}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}
      </div>
      {live.length > 0 && (
        <>
          <IconButton
            label="Open the backup folder"
            icon={FolderOpen}
            size={16}
            onClick={() => app.run(() => api.openBackupFolder(item.kind === 'batch' ? undefined : first.id))}
          />
          <Button size="sm" icon={RotateCcw} onClick={undo}>
            {item.kind === 'batch' ? 'Undo all' : 'Undo'}
          </Button>
        </>
      )}
    </li>
  );
}

function backupGone(records: InstallRecord[]): string {
  return records.length === 1 ? "Backup deleted, so this can't be undone" : "Backups deleted, so these can't be undone";
}
