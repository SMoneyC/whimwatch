import {
  ArrowLeft,
  BookOpen,
  Bug,
  CodeXml,
  Coffee,
  Database,
  Download,
  FolderOpen,
  FolderPlus,
  Info,
  Lightbulb,
  MessageSquareWarning,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  User,
  UserSearch,
  X,
} from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useState } from 'react';
import type { AppSnapshot, StorageInfo } from '../../shared/api';
import { docsUrl, repoUrl, securityReportUrl, SUPPORT_URL } from '../../shared/config';
import { openIssueForm, type ReportForm } from './Feedback';
import { type PrivacyLevel, privacyLevel, privacyLevelPatch } from '../../shared/privacy';
import { type AppSettings, UPDATE_SITES, type UpdateSite } from '../../shared/types';
import { Dialog, useConfirm } from './dialog';
import { acceleratorFromKey, acceleratorKeys, formatBytes, formatDate, SOURCE_LABEL } from './format';
import { useToast } from './toast';
import { api, type AppModel } from './useApp';
import { useSiteToggle } from './useSiteToggle';
import { Banner, Button, IconButton, Kbd, Segmented, SettingRow, ToggleRow } from './ui';

export type SettingsSection = 'general' | 'privacy' | 'accounts' | 'updates' | 'storage' | 'about';

const SECTIONS: { id: SettingsSection; label: string; icon: typeof Info }[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'privacy', label: 'Privacy & discretion', icon: ShieldCheck },
  { id: 'accounts', label: 'Accounts', icon: User },
  { id: 'updates', label: 'Updates & backups', icon: Download },
  { id: 'storage', label: 'Storage & data', icon: Database },
  { id: 'about', label: 'Help & about', icon: Info },
];

export function SettingsView({
  app,
  section,
  onSection,
  onBack,
  onReport,
}: {
  app: AppModel;
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
  onBack: () => void;
  onReport: (form: ReportForm) => void;
}) {
  const snapshot = app.snapshot!;
  const set = (patch: Partial<AppSettings>): Promise<AppSnapshot | undefined> => app.run(() => api.updateSettings(patch));

  const onNavKey = (e: KeyboardEvent, index: number): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const next = SECTIONS[(index + (e.key === 'ArrowDown' ? 1 : -1) + SECTIONS.length) % SECTIONS.length]!;
    onSection(next.id);
    document.getElementById(`settings-nav-${next.id}`)?.focus();
  };

  return (
    <div className="settings-page">
      <nav className="settings-nav" aria-label="Settings">
        <button type="button" className="back-link" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" /> Back to creators
        </button>
        <h1>Settings</h1>
        <ul>
          {SECTIONS.map((s, i) => {
            const IconComponent = s.icon;
            return (
              <li key={s.id}>
                <button
                  id={`settings-nav-${s.id}`}
                  type="button"
                  className={section === s.id ? 'active' : ''}
                  aria-current={section === s.id ? 'page' : undefined}
                  onClick={() => onSection(s.id)}
                  onKeyDown={(e) => onNavKey(e, i)}
                >
                  <IconComponent size={18} aria-hidden="true" /> {s.label}
                </button>
              </li>
            );
          })}
        </ul>
        <span className="spacer" />
        <span className="faint small">WhimWatch {snapshot.appVersion}</span>
      </nav>

      <main className="settings-content" id="main">
        {app.error && (
          <Banner tone="error" onClose={() => app.setError(undefined)}>
            {app.error}
          </Banner>
        )}
        {section === 'general' && <General snapshot={snapshot} app={app} set={set} />}
        {section === 'privacy' && <Privacy snapshot={snapshot} set={set} />}
        {section === 'accounts' && <Accounts snapshot={snapshot} app={app} onPrivacy={() => onSection('privacy')} />}
        {section === 'updates' && <Updates snapshot={snapshot} app={app} set={set} />}
        {section === 'storage' && <Storage snapshot={snapshot} app={app} />}
        {section === 'about' && <About snapshot={snapshot} app={app} onReport={onReport} />}
      </main>
    </div>
  );
}

type Setter = (patch: Partial<AppSettings>) => Promise<AppSnapshot | undefined>;

const CHECK_OPTIONS = [
  { value: 'manual', label: 'Only when I click Check now', patch: { checkOnLaunch: false } },
  { value: 'always', label: 'Every time WhimWatch opens', patch: { checkOnLaunch: true, recheckAfterMinutes: 0 } },
  { value: '60', label: 'When it opens, if the last check was over an hour ago', patch: { checkOnLaunch: true, recheckAfterMinutes: 60 } },
  { value: '360', label: 'When it opens, if the last check was over 6 hours ago', patch: { checkOnLaunch: true, recheckAfterMinutes: 360 } },
  { value: '1440', label: 'When it opens, if the last check was over a day ago', patch: { checkOnLaunch: true, recheckAfterMinutes: 1440 } },
] as const;

function checkValue(s: AppSettings): string {
  if (!s.checkOnLaunch) return 'manual';
  if (s.recheckAfterMinutes === 0) return 'always';
  return CHECK_OPTIONS.some((o) => o.value === String(s.recheckAfterMinutes)) ? String(s.recheckAfterMinutes) : '60';
}

function PageHead({ title, text }: { title: string; text?: string }) {
  return (
    <header className="settings-head">
      <h2>{title}</h2>
      {text && <p className="muted">{text}</p>}
    </header>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="settings-group">
      <h3 className="section-label">{label}</h3>
      <div className="card settings-card">{children}</div>
    </section>
  );
}

function General({ snapshot, app, set }: { snapshot: AppSnapshot; app: AppModel; set: Setter }) {
  const { settings, dirs } = snapshot;
  const toggleSite = useSiteToggle(app);
  const addDir = async (): Promise<void> => {
    const dir = await app.run(() => api.chooseDirectory());
    if (dir) await app.run(() => api.setDirs([...dirs, dir]));
  };
  return (
    <>
      <PageHead title="General" />
      <Group label="Mods folders">
        {dirs.map((dir) => (
          <div key={dir} className="setting-row">
            <code className="grow dir-path">{dir}</code>
            <IconButton label="Open folder" icon={FolderOpen} size={16} onClick={() => app.run(() => api.showFile(dir))} />
            <IconButton label={`Stop watching ${dir}`} icon={X} size={16} onClick={() => app.run(() => api.setDirs(dirs.filter((d) => d !== dir)))} disabled={dirs.length === 1} />
          </div>
        ))}
        <div className="setting-row">
          <span className="setting-hint grow">The game only loads mods from Documents/Electronic Arts/The Sims 4/Mods. Other folders (such as mods you've switched off) are checked too.</span>
          <Button size="sm" icon={FolderPlus} onClick={addDir}>
            Add folder…
          </Button>
        </div>
      </Group>
      <Group label="Appearance">
        <SettingRow title="Theme">
          <Segmented<AppSettings['theme']>
            label="Theme"
            value={settings.theme}
            onChange={(theme) => set({ theme })}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
              { value: 'system', label: 'System' },
            ]}
          />
        </SettingRow>
      </Group>
      <Group label="Checking">
        <SettingRow title="Check for updates" hint="A check reads public pages on wickedwhimsmod.com and the sites below.">
          <select value={checkValue(settings)} onChange={(e) => set(CHECK_OPTIONS.find((o) => o.value === e.target.value)!.patch)}>
            {CHECK_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </SettingRow>
        <ToggleRow
          title="Tell me when a new WhimWatch version is out"
          hint="Asks GitHub for the latest release at most once a day."
          checked={settings.checkAppUpdates}
          onChange={(v) => set({ checkAppUpdates: v })}
        />
      </Group>
      <Group label="Sites to check">
        <div className="setting-row">
          <span className="setting-hint grow">
            A site you turn off is never contacted, and its updates don't show for any creator. The WickedWhims site is always read: it lists
            the creators and WickedWhims itself.
          </span>
        </div>
        {UPDATE_SITES.map((site) => (
          <ToggleRow
            key={site}
            title={SOURCE_LABEL[site]}
            hint={SITE_HINT[site]}
            checked={!settings.mutedSources.includes(site)}
            onChange={(on) => void toggleSite(site, on)}
          />
        ))}
      </Group>
    </>
  );
}

const SITE_HINT: Record<UpdateSite, string> = {
  wickedcc: 'Most animation packs. Downloads need no account.',
  loverslab: 'Downloading needs a LoversLab account.',
  patreon: 'Posts for members need a membership with that creator.',
};

const LEVEL_TEXT: Record<PrivacyLevel, string> = {
  standard: 'Remembers sign-ins and shows everything. For a computer only you use.',
  discreet: 'Leaves as little trace as possible, for shared computers and screen sharing. You sign in again each time you open WhimWatch.',
  custom: "Some settings below (or how long backups are kept) differ from Standard and Discreet. Pick one to reset them.",
};

function Privacy({ snapshot, set }: { snapshot: AppSnapshot; set: Setter }) {
  const { settings } = snapshot;
  const hasBrowser = snapshot.browsers.length > 0;
  const level = privacyLevel(settings, hasBrowser);
  const memoryOnly = settings.clearBrowsingDataOnExit && settings.forgetSignInsOnExit;
  const windows = snapshot.platform === 'win32';

  return (
    <>
      <PageHead title="Privacy & discretion" text="Choose how much WhimWatch keeps and shows. Checking for updates never uploads your files." />
      <section className="settings-group">
        <h3 className="section-label">Privacy level</h3>
        <Segmented<PrivacyLevel>
          label="Privacy level"
          className="wide"
          value={level}
          onChange={(v) => v !== 'custom' && set(privacyLevelPatch(v, hasBrowser))}
          options={[
            { value: 'standard', label: 'Standard' },
            { value: 'discreet', label: 'Discreet' },
            { value: 'custom', label: 'Custom', disabled: level !== 'custom' },
          ]}
        />
        <p className="muted small level-text">{LEVEL_TEXT[level]}</p>
      </section>

      <Group label="On screen">
        <ToggleRow
          title="Privacy screen"
          hint={`Blurs WhimWatch whenever it isn't the active window${snapshot.platform === 'linux' ? '' : ', and keeps it blank in screenshots and screen sharing'}.`}
          checked={settings.privacyScreen}
          onChange={(v) => set({ privacyScreen: v })}
        />
        <QuickHide snapshot={snapshot} set={set} />
        <ToggleRow
          title="Hide page titles"
          hint="Shows “LoversLab page” instead of post titles, which can be explicit."
          checked={settings.hidePageTitles}
          onChange={(v) => set({ hidePageTitles: v })}
        />
      </Group>

      <Group label="Notifications">
        <ToggleRow
          title="Show creator names in notifications"
          hint={`${windows ? 'Windows keeps a history of notifications. ' : ''}When off, they only say how many updates there are.`}
          checked={settings.notificationNames}
          onChange={(v) => set({ notificationNames: v })}
        />
      </Group>

      <Group label="Links and sign-ins">
        <ToggleRow
          title="Open links in a private window"
          hint={
            hasBrowser
              ? `Keeps these sites out of your browser history. Right-click any Open button to choose for one link.`
              : 'No browser with a private mode was found, so links open normally.'
          }
          checked={settings.privateLinks}
          onChange={(v) => set({ privateLinks: v })}
          disabled={!hasBrowser}
        />
        {hasBrowser && snapshot.browsers.length > 1 && settings.privateLinks && (
          <SettingRow title="Browser for private links" indent>
            <select value={settings.privateBrowser ?? snapshot.browsers[0]!.id} onChange={(e) => set({ privateBrowser: e.target.value })}>
              {snapshot.browsers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.isDefault ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </SettingRow>
        )}
        <ToggleRow
          title="Clear browsing data when WhimWatch closes"
          hint="Removes the page cache, site storage, visit records and other companies' cookies the built-in LoversLab and Patreon browser keeps."
          checked={settings.clearBrowsingDataOnExit}
          onChange={(v) => set({ clearBrowsingDataOnExit: v })}
        />
        <ToggleRow
          indent
          title="Also forget sign-ins"
          disabled={!settings.clearBrowsingDataOnExit}
          hint={
            memoryOnly && !snapshot.sessionsInMemory
              ? 'LoversLab or Patreon was already used this session, so nothing from these sites is saved to disk starting the next time WhimWatch opens.'
              : !memoryOnly && snapshot.sessionsInMemory
                ? 'Sign-ins stay in memory only until WhimWatch restarts.'
                : 'Nothing from these sites is saved to disk. You sign in again each time.'
          }
          checked={settings.forgetSignInsOnExit}
          onChange={(v) => set({ forgetSignInsOnExit: v })}
        />
      </Group>
    </>
  );
}

function QuickHide({ snapshot, set }: { snapshot: AppSnapshot; set: Setter }) {
  const { settings } = snapshot;
  const [capturing, setCapturing] = useState(false);
  const [hint, setHint] = useState<string>();
  const keys = acceleratorKeys(settings.quickHideShortcut, snapshot.platform);

  const onKey = async (e: KeyboardEvent): Promise<void> => {
    if (!capturing) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') {
      setCapturing(false);
      setHint(undefined);
      return;
    }
    const accelerator = acceleratorFromKey(e, snapshot.platform);
    if (!accelerator) {
      setHint('Hold Ctrl or Alt (and optionally Shift), then press a letter, number or F-key.');
      return;
    }
    setCapturing(false);
    setHint(undefined);
    await set({ quickHideShortcut: accelerator, quickHide: true });
  };

  return (
    <SettingRow
      title="Quick hide"
      hint={
        capturing ? (
          <span className="accent-text">{hint ?? 'Press the new shortcut, or Escape to cancel.'}</span>
        ) : (
          'Hides the window instantly, even when another app is in front. The same shortcut, or opening WhimWatch again, brings it back. While on, other apps can’t use this shortcut.'
        )
      }
    >
      <span className="shortcut" aria-label={`Shortcut: ${keys.join(' ')}`}>
        {keys.map((k) => (
          <Kbd key={k}>{k}</Kbd>
        ))}
      </span>
      <Button size="sm" onClick={() => setCapturing(true)} onKeyDown={onKey} onBlur={() => setCapturing(false)} aria-live="polite">
        {capturing ? 'Press keys…' : 'Change'}
      </Button>
      <span className="switch-wrap">
        <button
          type="button"
          role="switch"
          aria-checked={settings.quickHide}
          aria-label="Quick hide"
          className={`switch ${settings.quickHide ? 'on' : ''}`}
          onClick={() => set({ quickHide: !settings.quickHide })}
        />
      </span>
    </SettingRow>
  );
}

function Accounts({ snapshot, app, onPrivacy }: { snapshot: AppSnapshot; app: AppModel; onPrivacy: () => void }) {
  return (
    <>
      <PageHead
        title="Accounts"
        text="Checking for updates works without an account. Signing in lets WhimWatch download updates that LoversLab or Patreon only give to members."
      />
      <Group label="Sites">
        {snapshot.accounts.map((a) => (
          <div key={a.site} className="setting-row">
            <span className={`dot ${a.signedIn ? 'on' : ''}`} aria-hidden="true" />
            <div className="setting-text">
              <span className="setting-title">{a.label}</span>
              <span className="setting-hint">
                {a.signedIn ? 'Signed in' : 'Not signed in'}
                {snapshot.settings.mutedSources.includes(a.site) && ' · turned off in General, so it isn’t checked'}
              </span>
            </div>
            <span className="spacer" />
            {a.signedIn ? (
              <Button size="sm" onClick={() => app.run(() => api.signOut(a.site))}>
                Sign out
              </Button>
            ) : (
              <Button size="sm" onClick={() => app.run(() => api.signIn(a.site))}>
                Sign in…
              </Button>
            )}
          </div>
        ))}
      </Group>
      {snapshot.weakCookieStorage && !snapshot.sessionsInMemory && (
        <Banner tone="warn" title="Sign-ins aren't really encrypted on this computer" actions={<Button size="sm" onClick={onPrivacy}>Privacy settings</Button>}>
          There's no keyring (such as GNOME Keyring or KWallet) WhimWatch can use. Turn on “Also forget sign-ins” to keep them in memory only.
        </Banner>
      )}
      <Banner tone="info" title="How signing in works">
        You sign in on the site's own page. WhimWatch never sees or stores your password, only the login cookies the site sets. Automated
        downloads may go against a site's terms and could get an account flagged, so WhimWatch only downloads when you ask, one file at a
        time.
      </Banner>
      <Banner tone="info" title="Accounts made with Google need a password first">
        Google won't sign you in from inside another app, so “Continue with Google” can't finish here — and for an account made that way,
        Patreon turns the email box down too (“Log in with your Google account”). Sign in to Patreon in your browser and set a password
        under Settings → Account → Login, then use your email and that password here. It's an extra way in, not a swap: Google still signs
        you in everywhere else. Accounts that already have a password, or that sign in with an emailed code, work in the sign-in window as
        they are.
      </Banner>
    </>
  );
}

const KEEP_OPTIONS = [
  { days: 7, label: 'For 7 days' },
  { days: 30, label: 'For 30 days' },
  { days: 90, label: 'For 90 days' },
  { days: 0, label: 'Until I delete them' },
];

function Updates({ snapshot, app, set }: { snapshot: AppSnapshot; app: AppModel; set: Setter }) {
  const { settings } = snapshot;
  return (
    <>
      <PageHead title="Updates & backups" text="Every update backs up the files it replaces first, so it can be undone from History." />
      <Group label="Installing">
        <ToggleRow
          title="Install wicked.cc updates automatically after a check"
          hint="Only updates that need no decisions and no sign-in. You can undo them from History."
          checked={settings.autoInstall}
          onChange={(v) => set({ autoInstall: v })}
        />
      </Group>
      <Group label="Backups">
        <SettingRow title="Keep backups of replaced files" hint="Once a backup is deleted, that update can't be undone.">
          <select value={settings.keepBackupsDays} onChange={(e) => set({ keepBackupsDays: Number(e.target.value) })}>
            {KEEP_OPTIONS.map((o) => (
              <option key={o.days} value={o.days}>
                {o.label}
              </option>
            ))}
          </select>
        </SettingRow>
        <SettingRow
          title="Backup folder"
          hint={
            <>
              Full copies of the mod files updates replaced, outside your Mods folder: <code>{snapshot.backupRoot}</code>
            </>
          }
        >
          <Button size="sm" icon={FolderOpen} onClick={() => app.run(() => api.openBackupFolder())}>
            Open
          </Button>
        </SettingRow>
      </Group>
    </>
  );
}

function Storage({ snapshot, app }: { snapshot: AppSnapshot; app: AppModel }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [storage, setStorage] = useState<StorageInfo>();

  useEffect(() => {
    api.getStorage().then(setStorage, () => undefined);
  }, [snapshot.installs]);

  const deleteBackups = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Delete all backups?',
      body: "Updates you've already installed can no longer be undone. Your Mods folder isn't changed.",
      confirmLabel: 'Delete backups',
      danger: true,
    });
    if (!ok) return;
    if (await app.run(() => api.clearBackups())) {
      setStorage(await api.getStorage());
      toast({ text: 'Backups deleted' });
    }
  };

  const clearCaches = async (): Promise<void> => {
    const next = await app.run(() => api.clearCaches());
    if (next) {
      setStorage(next);
      toast({ text: 'Downloads, browsing data and log cleared' });
    }
  };

  return (
    <>
      <PageHead title="Storage & data" text="What WhimWatch keeps outside your Mods folder." />
      <Group label="Space used">
        <SettingRow title="Backups" hint={storage ? formatBytes(storage.backups) : '…'}>
          <Button size="sm" icon={Trash2} onClick={deleteBackups} disabled={!storage?.backups}>
            Delete all…
          </Button>
        </SettingRow>
        <SettingRow title="Downloads, browsing data and log" hint={`${storage ? formatBytes(storage.caches) : '…'} · clearing keeps your sign-ins and settings`}>
          <Button size="sm" onClick={clearCaches}>
            Clear
          </Button>
        </SettingRow>
      </Group>
      <Group label="Remove everything">
        <SettingRow
          title="Remove all WhimWatch data"
          hint="Deletes settings, sign-ins, backups and logs from this computer, then closes WhimWatch. Your Mods folder isn't changed."
        >
          <Button size="sm" variant="danger" onClick={() => app.run(() => api.removeAllData())}>
            Remove all data…
          </Button>
        </SettingRow>
      </Group>
    </>
  );
}

function About({ snapshot, app, onReport }: { snapshot: AppSnapshot; app: AppModel; onReport: (form: ReportForm) => void }) {
  const [diagnostics, setDiagnostics] = useState<string>();
  const [licenses, setLicenses] = useState<string>();
  const result = snapshot.lastResult;
  return (
    <>
      <PageHead title="Help & about" text="Links open on GitHub in your browser (in a private window, if you chose that for links)." />
      <Group label="Help">
        <SettingRow title="Guide and FAQ" hint="Installing, how checks and updates work, privacy, your data, and known limitations.">
          <Button size="sm" icon={BookOpen} onClick={() => app.run(() => api.openExternal(docsUrl()))}>
            Open the guide
          </Button>
        </SettingRow>
      </Group>
      <Group label="Feedback">
        <SettingRow title="Report a bug" hint="Something doesn't work as expected. You see the diagnostics before anything is copied.">
          <Button size="sm" icon={Bug} onClick={() => onReport('bug_report')}>
            Report a bug…
          </Button>
        </SettingRow>
        <SettingRow title="A site stopped working" hint="wicked.cc, LoversLab, Patreon or the WickedWhims page isn't read any more, usually after a redesign.">
          <Button size="sm" icon={MessageSquareWarning} onClick={() => onReport('site_changed')}>
            Report a site problem…
          </Button>
        </SettingRow>
        <SettingRow title="Missing or wrong creator page" hint="A creator isn't found, or WhimWatch checks the wrong page for them.">
          <Button size="sm" icon={UserSearch} onClick={() => openIssueForm(app, 'creator_link')}>
            Report a creator link
          </Button>
        </SettingRow>
        <SettingRow title="Suggest a feature" hint="Ideas for what WhimWatch could do better.">
          <Button size="sm" icon={Lightbulb} onClick={() => openIssueForm(app, 'feature_request')}>
            Suggest a feature
          </Button>
        </SettingRow>
        <SettingRow title="Security problem" hint="Please report it privately, never in a public issue.">
          <Button size="sm" icon={ShieldAlert} onClick={() => app.run(() => api.openExternal(securityReportUrl()))}>
            Report privately
          </Button>
        </SettingRow>
      </Group>
      <Group label="WhimWatch">
        <SettingRow title={`Version ${snapshot.appVersion}`} hint={result ? `Last check ${formatDate(result.finishedAt)}` : 'Not checked yet'}>
          <Button size="sm" icon={CodeXml} onClick={() => app.run(() => api.openExternal(repoUrl()))}>
            Source code
          </Button>
        </SettingRow>
        <SettingRow title="Support WhimWatch" hint="WhimWatch is free and open source. If it saves you time, you can buy the developer a coffee.">
          <Button
            size="sm"
            icon={Coffee}
            onClick={() => app.run(() => api.openExternal(SUPPORT_URL))}
            onContextMenu={(e) => {
              e.preventDefault();
              void app.run(() => api.showLinkMenu(SUPPORT_URL));
            }}
          >
            Buy me a coffee
          </Button>
        </SettingRow>
        <SettingRow
          title="Diagnostics"
          hint="Versions, settings, a summary of the last check and recent log lines for a bug report. You see everything before copying or saving it."
        >
          <Button
            size="sm"
            onClick={async () => {
              const text = await app.run(() => api.getDiagnostics());
              if (text !== undefined) setDiagnostics(text);
            }}
          >
            Diagnostics…
          </Button>
        </SettingRow>
        <SettingRow
          title="Licences"
          hint="WhimWatch is open source under the MIT License. It includes the Manrope and JetBrains Mono fonts (SIL Open Font License), Lucide icons, React, 7-Zip, UnRAR and other components under their own licences."
        >
          <Button
            size="sm"
            onClick={async () => {
              const text = await app.run(() => api.getLicenses());
              if (text !== undefined) setLicenses(text);
            }}
          >
            View…
          </Button>
        </SettingRow>
      </Group>
      <p className="faint small">WhimWatch is an independent project, not affiliated with TURBODRIVER, Electronic Arts, wicked.cc, LoversLab or Patreon.</p>
      {diagnostics !== undefined && <DiagnosticsDialog text={diagnostics} app={app} onClose={() => setDiagnostics(undefined)} />}
      {licenses !== undefined && (
        <Dialog title="Licences" subtitle="WhimWatch’s licence, then everything it includes." onClose={() => setLicenses(undefined)} width={760}>
          <textarea className="diagnostics mono licenses" readOnly value={licenses} rows={22} spellCheck={false} aria-label="Licence texts" />
        </Dialog>
      )}
    </>
  );
}

/** Shows exactly what a bug report would include before it's copied or saved. */
function DiagnosticsDialog({ text, app, onClose }: { text: string; app: AppModel; onClose: () => void }) {
  const toast = useToast();
  return (
    <Dialog
      title="Diagnostics"
      subtitle="This is everything that gets copied or saved. It has no creator names or page addresses, and your home folder shows as ~."
      onClose={onClose}
      width={720}
      footer={
        <>
          <span className="spacer" />
          <Button
            variant="quiet"
            onClick={async () => {
              if (await app.run(() => api.saveDiagnostics())) toast({ text: 'Diagnostics saved' });
            }}
          >
            Save to file…
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              await app.run(() => api.copyDiagnostics());
              toast({ text: 'Diagnostics copied' });
            }}
          >
            Copy
          </Button>
        </>
      }
    >
      <textarea className="diagnostics mono" readOnly value={text} rows={16} spellCheck={false} aria-label="Diagnostics text" />
    </Dialog>
  );
}
