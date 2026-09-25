import { useEffect, useRef, useState } from 'react';
import { t } from '../../shared/i18n';
import { acceleratorKeys } from './format';
import { ConfirmProvider, dialogOpen } from './dialog';
import { ReportDialog, type ReportForm } from './Feedback';
import { updateCandidates } from './eligibility';
import { Header, type View } from './Header';
import { HistoryView } from './HistoryView';
import { Home } from './Home';
import { SettingsView, type SettingsSection } from './SettingsView';
import { Setup } from './Setup';
import { ToastProvider, useToast } from './toast';
import { UpdateAllDialog } from './UpdateAllDialog';
import { UpdateDialog, type UpdateTarget } from './UpdateDialog';
import { api, type AppModel, useApp } from './useApp';
import { rich } from './rich';
import { Kbd, LogoMark } from './ui';

export function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <Shell />
      </ConfirmProvider>
    </ToastProvider>
  );
}

function Shell() {
  const app = useApp();
  const toast = useToast();
  const { snapshot } = app;
  const [view, setView] = useState<View>('home');
  const [section, setSection] = useState<SettingsSection>('general');
  const [updating, setUpdating] = useState<UpdateTarget>();
  const [showUpdateAll, setShowUpdateAll] = useState(false);
  const [report, setReport] = useState<ReportForm>();
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const focused = useWindowFocus();

  // Messages that don't need to stay on screen.
  const [lastRunning, setLastRunning] = useState(snapshot?.running);
  if (snapshot && snapshot.running !== lastRunning) {
    setLastRunning(snapshot.running);
    if (lastRunning && !snapshot.running && snapshot.checkMessage?.tone === 'info') toast({ text: snapshot.checkMessage.text });
  }
  useEffect(
    () =>
      api.onEvent((event) => {
        if (event.type === 'auto-installed') {
          toast({
            text: t().app.autoInstalled(event.count),
            action: { label: t().common.undo, run: () => void app.run(() => api.undoBatch(event.batchId)) },
            duration: 12000,
          });
        }
      }),
    [app, toast],
  );

  // Keyboard: "/" or Ctrl+F searches, Ctrl+R checks, Escape leaves History or Settings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!snapshot?.dirs.length || dialogOpen()) return;
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      const mod = e.ctrlKey || e.metaKey;
      if ((e.key === '/' && !typing) || (mod && e.key.toLowerCase() === 'f')) {
        e.preventDefault();
        setView('home');
        requestAnimationFrame(() => searchRef.current?.focus());
      } else if (mod && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        if (!snapshot.running && !app.batch?.running) void app.run(() => api.startCheck());
      } else if (e.key === 'Escape' && !typing && view !== 'home') {
        setView('home');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [snapshot, view, app]);

  if (!snapshot) return <SkeletonHome />;
  if (!snapshot.dirs.length) return <Setup app={app} />;

  const result = snapshot.lastResult;
  const candidates = updateCandidates(result?.core, snapshot.running ? [] : (result?.creators ?? []), snapshot);
  const hidden = snapshot.settings.privacyScreen && !focused;

  const openSettings = (s: SettingsSection): void => {
    setSection(s);
    setView('settings');
  };

  return (
    <>
      <div className={`app ${hidden ? 'privacy-blur' : ''}`} aria-hidden={hidden || undefined}>
        {view !== 'settings' && (
          <Header
            app={app}
            view={view}
            onView={setView}
            query={query}
            onQuery={setQuery}
            searchRef={searchRef}
            onShowBatch={() => setShowUpdateAll(true)}
            onReport={setReport}
            onHelpPage={() => openSettings('about')}
          />
        )}
        {view === 'home' && (
          <Home app={app} query={query} onClearQuery={() => setQuery('')} onUpdate={setUpdating} onUpdateAll={() => setShowUpdateAll(true)} onReport={setReport} />
        )}
        {view === 'history' && <HistoryView app={app} onBack={() => setView('home')} onBackupSettings={() => openSettings('updates')} />}
        {view === 'settings' && <SettingsView app={app} section={section} onSection={setSection} onBack={() => setView('home')} onReport={setReport} />}
      </div>

      {updating && <UpdateDialog target={updating} app={app} onClose={() => setUpdating(undefined)} />}
      {showUpdateAll && (
        <UpdateAllDialog
          app={app}
          eligible={candidates.eligible}
          ineligible={candidates.ineligible}
          onClose={() => setShowUpdateAll(false)}
          onShowHistory={() => setView('history')}
        />
      )}
      {report && <ReportDialog form={report} app={app} onClose={() => setReport(undefined)} />}
      {hidden && <PrivacyScreen app={app} />}
    </>
  );
}

/** Covers everything while the window isn't active (Settings → Privacy screen). */
function PrivacyScreen({ app }: { app: AppModel }) {
  const settings = app.snapshot!.settings;
  const m = t().app;
  const keys = acceleratorKeys(settings.quickHideShortcut, app.snapshot!.platform).map((k) => <Kbd key={k}>{k}</Kbd>);
  return (
    <div className="privacy-screen" role="presentation">
      <LogoMark size={48} />
      <strong>{m.hidden}</strong>
      <span className="muted">{m.clickToShow}</span>
      {settings.quickHide && <span className="faint small row-center">{rich(m.hidesInstantly, { keys })}</span>}
    </div>
  );
}

/**
 * Whether the window is active. The page's focus events alone aren't enough: if the window was already
 * active before the page loaded, none arrives, and clicking inside an active window doesn't send one.
 * So this also asks the main process, follows its window events, and treats a click or key press as
 * the window being in use.
 */
function useWindowFocus(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    let active = true;
    const on = (): void => setFocused(true);
    const off = (): void => setFocused(false);
    window.addEventListener('focus', on);
    window.addEventListener('blur', off);
    document.addEventListener('pointerdown', on, true);
    document.addEventListener('keydown', on, true);
    const stop = api.onEvent((event) => {
      if (event.type === 'window-focus') setFocused(event.focused);
    });
    api.isWindowFocused().then(
      (isFocused) => active && isFocused && setFocused(true),
      () => undefined,
    );
    return () => {
      active = false;
      window.removeEventListener('focus', on);
      window.removeEventListener('blur', off);
      document.removeEventListener('pointerdown', on, true);
      document.removeEventListener('keydown', on, true);
      stop();
    };
  }, []);
  return focused;
}

function SkeletonHome() {
  return (
    <div className="app" aria-busy="true" aria-label={t().common.loading}>
      <header className="topbar">
        <span className="brand">
          <LogoMark />
          <span>WhimWatch</span>
        </span>
      </header>
      <main className="content">
        <div className="content-inner">
          <div className="counts">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="skeleton count-skeleton" />
            ))}
          </div>
          <span className="skeleton card-skeleton" />
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="skeleton row-skeleton" />
          ))}
        </div>
      </main>
    </div>
  );
}
