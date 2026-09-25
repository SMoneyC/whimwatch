import { BookOpen, Bug, CircleQuestionMark, History, Info, Lightbulb, RefreshCw, Search, Settings as SettingsIcon, Sparkles, X } from 'lucide-react';
import type { RefObject } from 'react';
import { docsUrl } from '../../shared/config';
import { t } from '../../shared/i18n';
import { openIssueForm, type ReportForm } from './Feedback';
import { api, type AppModel } from './useApp';
import { Button, IconButton, Kbd, LogoMark, MenuButton, Spinner } from './ui';

export type View = 'home' | 'history' | 'settings';

export function Header({
  app,
  view,
  onView,
  query,
  onQuery,
  searchRef,
  onShowBatch,
  onReport,
  onHelpPage,
}: {
  app: AppModel;
  view: View;
  onView: (view: View) => void;
  query: string;
  onQuery: (query: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  onShowBatch: () => void;
  onReport: (form: ReportForm) => void;
  onHelpPage: () => void;
}) {
  const snapshot = app.snapshot!;
  const progress = app.progress;
  const batch = app.batch;
  const finished = batch?.items.filter((i) => i.state === 'done' || i.state === 'failed').length ?? 0;
  const m = t().header;

  return (
    <header className="topbar">
      <button type="button" className="brand" onClick={() => onView('home')} aria-label={m.backToCreators}>
        <LogoMark />
        <span>WhimWatch</span>
      </button>

      {/* The only prompt anyone gets to update WhimWatch itself, so it carries the accent rather
          than reading as another grey status label. It names WhimWatch because everything else in
          this window is about updating mods — "Update to 0.2.0" alone would read as one of those —
          and says "update" rather than "get" so it's clear the installed version is the older one.
          The current version is in the tooltip rather than the chip, which has a header to fit in. */}
      {snapshot.appUpdate && !snapshot.appUpdate.hidden && (
        <span className="chip chip-accent">
          <button
            type="button"
            className="chip-main"
            title={m.appUpdateTitle(snapshot.appVersion, snapshot.appUpdate.version)}
            onClick={() => app.run(() => api.openExternal(snapshot.appUpdate!.url))}
          >
            <Sparkles size={14} aria-hidden="true" />
            <span className="chip-text">{m.appUpdate(snapshot.appUpdate.version)}</span>
          </button>
          <IconButton label={m.hideAppUpdate} icon={X} size={13} onClick={() => app.run(() => api.dismissAppUpdate(snapshot.appUpdate!.version))} />
        </span>
      )}
      {batch?.running && (
        <button type="button" className="chip chip-main chip-accent" onClick={onShowBatch}>
          <Spinner size={14} />
          <span className="chip-text">{m.updatingNofM(Math.min(finished + 1, batch.items.length), batch.items.length)}</span>
        </button>
      )}

      <span className="spacer" />

      {view === 'home' && (
        <label className="search collapsible" title={m.searchTitle}>
          <Search size={15} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            placeholder={m.search}
            aria-label={m.search}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation();
                onQuery('');
              }
            }}
          />
          {!query && <Kbd>/</Kbd>}
        </label>
      )}

      {/* The label is hidden on narrow windows, where the header runs out of room; the icon and the
          accessible name carry it from there. */}
      <Button
        variant="quiet"
        icon={History}
        className={view === 'history' ? 'active' : ''}
        aria-pressed={view === 'history'}
        aria-label={t().common.history}
        title={t().common.history}
        onClick={() => onView(view === 'history' ? 'home' : 'history')}
      >
        <span className="btn-label">{t().common.history}</span>
      </Button>

      {snapshot.running ? (
        <>
          <div className="check-progress" role="status" aria-live="polite">
            <div className="check-progress-text">
              <span>{progress ? m.phase[progress.phase] : m.starting}</span>
              {progress && progress.total > 0 && <span>{m.progress(progress.done, progress.total)}</span>}
            </div>
            <div className={`bar ${progress?.total ? '' : 'indeterminate'}`}>
              <span style={progress?.total ? { width: `${Math.round((progress.done / progress.total) * 100)}%` } : undefined} />
            </div>
          </div>
          <Button icon={X} onClick={() => app.run(() => api.cancelCheck())}>
            {t().common.cancel}
          </Button>
        </>
      ) : (
        <Button icon={RefreshCw} onClick={() => app.run(() => api.startCheck())} title={m.checkNowTitle} disabled={batch?.running}>
          {t().common.checkNow}
        </Button>
      )}

      <MenuButton
        label={m.help}
        icon={CircleQuestionMark}
        items={[
          { label: m.guide, icon: BookOpen, onSelect: () => void app.run(() => api.openExternal(docsUrl())) },
          { label: m.reportBug, icon: Bug, onSelect: () => onReport('bug_report') },
          { label: m.suggestFeature, icon: Lightbulb, onSelect: () => openIssueForm(app, 'feature_request') },
          { label: m.moreHelp, icon: Info, onSelect: onHelpPage },
        ]}
      />
      <IconButton label={t().common.settings} icon={SettingsIcon} className={view === 'settings' ? 'active' : ''} onClick={() => onView('settings')} />
    </header>
  );
}
