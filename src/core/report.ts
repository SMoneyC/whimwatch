import type { CheckResult, CreatorResult } from '../shared/types.js';
import { formatVersion } from '../shared/version.js';

const day = (t?: number): string => (t ? new Date(t).toISOString().slice(0, 10) : '—');

/** Plain-text summary of a check, for the developer CLIs. */
export function formatReport(result: CheckResult): string {
  const lines: string[] = [];
  const c = result.core;
  lines.push(
    `WickedWhims: installed ${day(c.installed?.mtimeMs)} · latest v${c.latestVersion ?? '?'} (${day(c.releasedAt)}) · game ${c.gameVersions ?? '?'} → ${c.status}`,
  );
  const order: CreatorResult['status'][] = ['update-available', 'needs-verification', 'unknown', 'up-to-date'];
  const creators = [...result.creators].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  for (const cr of creators) {
    lines.push('', `${cr.status.toUpperCase().padEnd(18)} ${cr.name}  local ${day(cr.localUpdatedAt)}  remote ${day(cr.remoteUpdatedAt)}`);
    for (const r of cr.remotes) {
      const detail = r.status === 'ok' ? `${day(r.updatedAt)}${r.version ? ` ${formatVersion(r.version)}` : ''}${r.locked ? ' (locked)' : ''}` : r.error;
      lines.push(`    ${r.listing.source.padEnd(9)} ${r.listing.origin.padEnd(10)} ${String(detail).padEnd(24)} ${r.listing.url}`);
    }
  }
  const seconds = ((result.finishedAt - result.startedAt) / 1000).toFixed(1);
  lines.push('', `${result.creators.length} creators, ${result.unrecognizedCount} other files, ${seconds}s`);
  return lines.join('\n');
}
