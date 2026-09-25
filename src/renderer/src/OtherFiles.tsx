import { AlertTriangle, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { OtherFile } from '../../shared/api';
import { t } from '../../shared/i18n';
import { Dialog } from './dialog';
import { api, type AppModel } from './useApp';
import { Spinner } from './ui';

const ROW_HEIGHT = 34;
const VIEW_HEIGHT = 420;

/** Every mod file that isn't a WickedWhims pack. Thousands of rows, so only the visible ones render. */
export function OtherFilesDialog({ app, count, onClose }: { app: AppModel; count: number; onClose: () => void }) {
  const [files, setFiles] = useState<OtherFile[]>();
  const [query, setQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    let live = true;
    void app.run(() => api.listOtherFiles()).then((list) => live && setFiles(list ?? []));
    return () => {
      live = false;
    };
  }, [app]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (files ?? []).filter((f) => !q || f.relPath.toLowerCase().includes(q));
  }, [files, query]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 5);
  const last = Math.min(shown.length, Math.ceil((scrollTop + VIEW_HEIGHT) / ROW_HEIGHT) + 5);
  const m = t().otherFiles;

  return (
    <Dialog
      title={m.title}
      subtitle={m.subtitle(count)}
      onClose={onClose}
      width={720}
    >
      <label className="search wide">
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          placeholder={m.search}
          aria-label={m.search}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setScrollTop(0);
          }}
          data-autofocus
        />
        {files && query && <span className="faint small">{m.matches(shown.length)}</span>}
      </label>
      {!files ? (
        <p className="muted row-center">
          <Spinner /> {m.loading}
        </p>
      ) : (
        <div className="virtual-list" style={{ height: VIEW_HEIGHT }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} role="list">
          <div style={{ height: shown.length * ROW_HEIGHT, position: 'relative' }}>
            {shown.slice(first, last).map((f, i) => (
              <div key={f.path} role="listitem" className="virtual-row" style={{ top: (first + i) * ROW_HEIGHT, height: ROW_HEIGHT }}>
                <button type="button" className="link-btn mono" title={`${t().common.showInFolder}\n${f.path}`} onClick={() => app.run(() => api.showFile(f.path))}>
                  {f.relPath}
                </button>
                {f.error && (
                  <span className="warn-text small" title={f.error}>
                    <AlertTriangle size={13} aria-hidden="true" /> {m.couldntRead}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}
