import { dateTimeFormat } from '../../shared/i18n/format';
import { t } from '../../shared/i18n';
import type { InstallRecord, SeenEvent } from '../../shared/types';

export type HistoryItem =
  | { kind: 'batch'; id: string; at: number; records: InstallRecord[] }
  | { kind: 'install'; id: string; at: number; record: InstallRecord }
  | { kind: 'seen'; id: string; at: number; event: SeenEvent };

export type HistoryFilter = 'all' | 'updates' | 'seen' | 'undone';

/** Installs from one "Update all" run become one entry; everything is newest first. */
export function historyItems(installs: InstallRecord[], seen: SeenEvent[]): HistoryItem[] {
  const items: HistoryItem[] = [];
  const batches = new Map<string, InstallRecord[]>();
  for (const record of installs) {
    if (record.batchId) batches.set(record.batchId, [...(batches.get(record.batchId) ?? []), record]);
    else items.push({ kind: 'install', id: record.id, at: record.at, record });
  }
  for (const [id, records] of batches) {
    if (records.length === 1) items.push({ kind: 'install', id: records[0]!.id, at: records[0]!.at, record: records[0]! });
    else items.push({ kind: 'batch', id, at: Math.max(...records.map((r) => r.at)), records });
  }
  for (const event of seen) items.push({ kind: 'seen', id: event.id, at: event.at, event });
  return items.sort((a, b) => b.at - a.at);
}

export function isUndone(item: HistoryItem): boolean {
  if (item.kind === 'seen') return item.event.undoneAt !== undefined;
  if (item.kind === 'install') return item.record.undoneAt !== undefined;
  return item.records.every((r) => r.undoneAt !== undefined);
}

export function matchesFilter(item: HistoryItem, filter: HistoryFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'undone') return isUndone(item);
  if (filter === 'seen') return item.kind === 'seen';
  return item.kind !== 'seen';
}

/**
 * Whether this entry is a pack the user got rather than an update they installed. Read from the
 * record, not from its operations: an ordinary update that only adds files has the same operations,
 * and "Update all" never includes a new pack, so a batch is always an update.
 */
export function isNewPackInstall(item: HistoryItem): boolean {
  return item.kind === 'install' && item.record.newPack === true;
}

/**
 * Whether undoing put files back, as opposed to only deleting what was added. Nothing is backed up
 * for a file that wasn't there before, so undoing a pack you got just removes it again.
 */
export function undoRestoresFiles(records: InstallRecord[]): boolean {
  return records.some((r) => r.operations.some((o) => o.backup !== undefined));
}

export function fileCounts(records: InstallRecord[]): { replaced: number; added: number; removed: number } {
  const ops = records.flatMap((r) => r.operations);
  return {
    replaced: ops.filter((o) => o.kind === 'replace').length,
    added: ops.filter((o) => o.kind === 'add').length,
    removed: ops.filter((o) => o.kind === 'remove').length,
  };
}

/** Day headings: "Today", "Yesterday", "Friday, Sep 11" this past month, then "August" / "August 2025". */
export function dayLabel(at: number, now = Date.now()): string {
  const day = (x: number): number => {
    const d = new Date(x);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days <= 0) return t().time.today;
  if (days === 1) return t().time.yesterday;
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const label = dateTimeFormat(days < 30 ? { weekday: 'long', month: 'short', day: 'numeric' } : sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' }).format(date);
  // A heading: some languages write day and month names in lower case ("venerdì 11 set").
  return label.charAt(0).toLocaleUpperCase() + label.slice(1);
}
