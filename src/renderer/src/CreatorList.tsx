import {
  BellOff,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  EyeOff,
  Lock,
  LogIn,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { type CreatorResult, type RemoteInfo, UPDATE_SITES, type UpdateSite } from '../../shared/types';
import { rowAction, rowStatus, rowSummary, siteList } from './eligibility';
import { formatVersion } from '../../shared/version';
import { formatShortDate, plural, remoteSummary, SOURCE_LABEL, timeAgo } from './format';
import { useToast } from './toast';
import { api, type AppModel } from './useApp';
import { useSiteToggle } from './useSiteToggle';
import { Button, Checkbox, Disclosure, IconButton, MenuButton, StatusMarker } from './ui';

export interface Row {
  creator: CreatorResult;
  /** This check hasn't reached the creator yet (the row keeps its last status). */
  pending: boolean;
}

const SITE_BADGE = { wickedcc: 'wc', loverslab: 'LL', patreon: 'P', wwmod: 'WW' } as const;

export function CreatorList({ rows, app, onUpdate }: { rows: Row[]; app: AppModel; onUpdate: (c: CreatorResult) => void }) {
  const [open, setOpen] = useState<string>();
  const [addingFor, setAddingFor] = useState<string>();
  return (
    <ul className="creator-list card">
      {rows.map(({ creator, pending }) => (
        <CreatorRow
          key={creator.key}
          creator={creator}
          pending={pending}
          expanded={open === creator.key}
          onToggle={() => setOpen(open === creator.key ? undefined : creator.key)}
          adding={addingFor === creator.key}
          onAdding={(on) => {
            setAddingFor(on ? creator.key : undefined);
            if (on) setOpen(creator.key);
          }}
          app={app}
          onUpdate={() => onUpdate(creator)}
        />
      ))}
    </ul>
  );
}

function CreatorRow({
  creator: c,
  pending,
  expanded,
  onToggle,
  adding,
  onAdding,
  app,
  onUpdate,
}: {
  creator: CreatorResult;
  pending: boolean;
  expanded: boolean;
  onToggle: () => void;
  adding: boolean;
  onAdding: (on: boolean) => void;
  app: AppModel;
  onUpdate: () => void;
}) {
  const snapshot = app.snapshot!;
  const status = rowStatus(c);
  const action = rowAction(c, snapshot);
  const progress = app.updates[c.key];
  const busy = progress !== undefined && progress.stage !== 'done' && progress.stage !== 'error';
  const sources = [...new Set(c.remotes.map((r) => SOURCE_LABEL[r.listing.source]))];

  return (
    <li className={`creator ${expanded ? 'expanded' : ''}`}>
      <div className="creator-head">
        <button type="button" className="creator-toggle" aria-expanded={expanded} onClick={onToggle}>
          <span className="creator-name">{c.name}</span>
          <span className="creator-sub faint">
            {plural(c.files.length, 'file')}
            {sources.length > 0 && ` · ${sources.join(', ')}`}
          </span>
        </button>
        <span className={`creator-summary ${pending ? 'faint' : ''}`}>{pending ? 'Checking now' : rowSummary(c, (t) => timeAgo(t))}</span>
        <StatusMarker status={status} checking={pending && app.snapshot?.running} />
        <span className="creator-action">
          {action.kind === 'update' && (
            <Button size="sm" icon={Download} onClick={onUpdate} disabled={busy || snapshot.running}>
              Update
            </Button>
          )}
          {action.kind === 'sign-in' && (
            <Button size="sm" icon={LogIn} onClick={() => app.run(() => api.signIn(action.site))}>
              Sign in to {SOURCE_LABEL[action.site]}
            </Button>
          )}
          {action.kind === 'open' && (
            <Button size="sm" icon={ExternalLink} onClick={() => app.run(() => api.openExternal(action.url))} onContextMenu={linkMenu(app, action.url)}>
              Open page
            </Button>
          )}
          {action.kind === 'verify' && (
            <Button size="sm" icon={ShieldCheck} onClick={() => app.run(() => api.showVerification(action.site))}>
              Verify
            </Button>
          )}
          {action.kind === 'add-page' && (
            <Button size="sm" icon={Plus} onClick={() => onAdding(true)}>
              Add page
            </Button>
          )}
        </span>
        <IconButton label={expanded ? `Collapse ${c.name}` : `Expand ${c.name}`} icon={expanded ? ChevronDown : ChevronRight} size={16} onClick={onToggle} aria-expanded={expanded} />
      </div>

      {progress && (busy || progress.stage === 'error') && !expanded && (
        <p className={`creator-progress small ${progress.stage === 'error' ? 'error-text' : 'muted'}`}>{progress.message}</p>
      )}

      {expanded && <CreatorDetails creator={c} app={app} adding={adding} onAdding={onAdding} />}
    </li>
  );
}

function CreatorDetails({ creator: c, app, adding, onAdding }: { creator: CreatorResult; app: AppModel; adding: boolean; onAdding: (on: boolean) => void }) {
  const snapshot = app.snapshot!;
  const hideTitles = snapshot.settings.hidePageTitles;
  const progress = app.updates[c.key];
  const busy = progress !== undefined && progress.stage !== 'done' && progress.stage !== 'error';
  const seenUndo = c.status === 'up-to-date' && c.dismissedAt !== undefined && (c.remoteUpdatedAt ?? 0) > c.localUpdatedAt + 86_400_000;
  const muted = c.mutedSources ?? [];
  // Sites turned off for everyone that have a page for this creator (ones turned off just here show in the checkboxes).
  const offEverywhere = muted.filter((s) => snapshot.settings.mutedSources.includes(s));
  const offHere = snapshot.creatorMutedSources[c.key] ?? [];
  const toggleSite = useSiteToggle(app);

  return (
    <div className="creator-body">
      {/* Only while something is happening, or when it failed. A finished update's message
          stays in app.updates for the rest of the run, and "Already up to date with wicked.cc"
          left under a row that still says "Update ready" reads as a contradiction. */}
      {progress && (busy || progress.stage === 'error') && (
        <p className={`small ${progress.stage === 'error' ? 'error-text' : 'muted'}`} role="status">
          {progress.message}
        </p>
      )}
      <div className="section-label">
        Download pages
        {hideTitles && c.remotes.some((r) => r.title) && (
          <span className="faint hint-inline">
            <EyeOff size={14} aria-hidden="true" /> Page titles hidden
          </span>
        )}
      </div>
      {c.remotes.length === 0 && !muted.length ? (
        <p className="muted small">No download pages found for this creator yet. Add a wicked.cc, LoversLab or Patreon page below.</p>
      ) : (
        c.remotes.length > 0 && (
          <div className="source-grid">
            {c.remotes.map((r) => (
              <SourceCard key={r.listing.url} remote={r} creator={c} app={app} hideTitle={hideTitles} />
            ))}
          </div>
        )
      )}
      {offEverywhere.length > 0 && (
        <p className="muted small off-note">
          <BellOff size={14} aria-hidden="true" />
          <span>
            {siteList(offEverywhere)} {offEverywhere.length === 1 ? "isn't" : "aren't"} checked: you turned {offEverywhere.length === 1 ? 'it' : 'them'} off
            for every creator in Settings → General.
          </span>
        </p>
      )}

      <fieldset className="creator-sites">
        <legend className="muted small">Check for {c.name}</legend>
        {UPDATE_SITES.map((site) => {
          const everywhere = snapshot.settings.mutedSources.includes(site);
          return (
            <label key={site} className={`site-check small ${everywhere ? 'faint' : ''}`} title={everywhere ? 'Turned off for every creator in Settings → General' : undefined}>
              <Checkbox
                label={`Check ${SOURCE_LABEL[site]} for ${c.name}`}
                checked={!everywhere && !offHere.includes(site)}
                disabled={everywhere}
                onChange={() => void toggleSite(site, offHere.includes(site), c.key)}
              />
              {SOURCE_LABEL[site]}
            </label>
          );
        })}
      </fieldset>

      {adding && <AddPage creator={c} app={app} onDone={() => onAdding(false)} />}

      <div className="creator-foot">
        {!adding && (
          <Button variant="quiet" size="sm" icon={Plus} onClick={() => onAdding(true)}>
            Add a download page
          </Button>
        )}
        <Disclosure summary={`Your files (${c.files.length})`} className="files-disclosure">
          <ul className="file-list">
            {c.files.map((f) => (
              <li key={f.path}>
                <button type="button" className="link-btn mono" title={`Show in folder\n${f.path}`} onClick={() => app.run(() => api.showFile(f.path))}>
                  {f.relPath}
                </button>
                <span className="faint small">{formatShortDate(f.mtimeMs)}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
        <span className="spacer" />
        {c.status === 'update-available' && c.remoteUpdatedAt !== undefined && (
          <Button size="sm" onClick={() => app.run(() => api.dismiss(c.key, c.remoteUpdatedAt!))} title="Hide this update until a newer release is posted">
            Mark as seen
          </Button>
        )}
        {seenUndo && (
          <Button variant="quiet" size="sm" icon={RotateCcw} onClick={() => app.run(() => api.undismiss(c.key))}>
            Undo mark as seen
          </Button>
        )}
      </div>
    </div>
  );
}

function SourceCard({ remote: r, creator, app, hideTitle }: { remote: RemoteInfo; creator: CreatorResult; app: AppModel; hideTitle: boolean }) {
  const toast = useToast();
  const toggleSite = useSiteToggle(app);
  const label = SOURCE_LABEL[r.listing.source];
  const updateSite = r.listing.source === 'wwmod' ? undefined : r.listing.source;

  const stopChecking = async (s: UpdateSite): Promise<void> => {
    if (!(await toggleSite(s, false, creator.key))) return;
    toast({
      text: `Stopped checking ${label} for ${creator.name}`,
      action: { label: 'Undo', run: () => void toggleSite(s, true, creator.key) },
    });
  };
  const site = r.listing.source === 'loverslab' || r.listing.source === 'patreon' ? r.listing.source : undefined;
  const problem = r.status !== 'ok';
  const shownTitle = !r.title || hideTitle ? `${label} page` : r.title;

  const remove = async (): Promise<void> => {
    const done = await app.run(() => api.rejectLink(creator.key, r.listing.url));
    if (!done) return;
    toast({
      text: `Removed the ${label} page from ${creator.name}`,
      action: { label: 'Undo', run: () => void app.run(() => api.undoRejectLink(creator.key, r.listing.url)) },
    });
  };

  return (
    <div className={`source-card ${problem ? 'problem' : ''}`}>
      <span className="site-badge" aria-hidden="true">
        {SITE_BADGE[r.listing.source]}
      </span>
      <div className="source-text">
        <span className="source-title">
          {label}
          {r.locked && <Lock size={13} className="faint" aria-label="Patrons only" />}
        </span>
        <span className={`source-sub ${problem ? 'warn-text' : 'faint'}`} title={hideTitle && r.title ? r.title : undefined}>
          {problem ? remoteSummary(r) : shownTitle}
        </span>
      </div>
      <div className="source-meta">
        {!problem && (
          <span className="faint small">
            {formatShortDate(r.updatedAt)}
            {r.version && ` · ${formatVersion(r.version)}`}
          </span>
        )}
        {r.listing.origin === 'discovered' && <span className="tag">Suggested</span>}
        {r.listing.origin === 'manual' && <span className="tag">Added by you</span>}
      </div>
      {r.status === 'needs-verification' && site && (
        <Button size="sm" onClick={() => app.run(() => api.showVerification(site))}>
          Verify
        </Button>
      )}
      <IconButton
        label={`Open ${label} page (right-click for a private window)`}
        icon={ExternalLink}
        size={16}
        onClick={() => app.run(() => api.openExternal(r.listing.url))}
        onContextMenu={linkMenu(app, r.listing.url)}
      />
      <MenuButton
        label={`More for the ${label} page`}
        items={[
          { label: 'Open privately or copy link…', icon: Copy, onSelect: () => void app.run(() => api.showLinkMenu(r.listing.url)) },
          ...(updateSite ? [{ label: `Don't check ${label} for ${creator.name}`, icon: BellOff, onSelect: () => void stopChecking(updateSite) }] : []),
          { label: "Not this creator's page", icon: Trash2, danger: true, onSelect: () => void remove() },
        ]}
      />
    </div>
  );
}

function AddPage({ creator, app, onDone }: { creator: CreatorResult; app: AppModel; onDone: () => void }) {
  const [url, setUrl] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const pending = (app.snapshot!.manualLinks[creator.key] ?? []).filter((p) => !creator.remotes.some((r) => r.listing.url === p));
  useEffect(() => input.current?.focus(), []);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (await app.run(() => api.addLink(creator.key, url.trim()))) {
      setUrl('');
      onDone();
    }
  };

  return (
    <form className="add-page" onSubmit={submit}>
      <label className="visually-hidden" htmlFor={`add-${creator.key}`}>
        Download page for {creator.name}
      </label>
      <input
        id={`add-${creator.key}`}
        ref={input}
        type="url"
        placeholder="Paste a wicked.cc, LoversLab or Patreon page"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onDone();
          }
        }}
      />
      <Button type="submit" size="sm" disabled={!url.trim()}>
        Add
      </Button>
      <Button variant="quiet" size="sm" onClick={onDone}>
        Cancel
      </Button>
      {pending.length > 0 && <p className="faint small">{pending.length === 1 ? 'Your added page' : `${pending.length} added pages`} will be checked on the next check.</p>}
    </form>
  );
}

/** Right-click on any link button: open in a private window, or copy. */
export function linkMenu(app: AppModel, url: string) {
  return (e: { preventDefault: () => void }): void => {
    e.preventDefault();
    void app.run(() => api.showLinkMenu(url));
  };
}
