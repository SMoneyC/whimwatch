import { ArrowLeft, Check, CheckCircle2, CircleDashed, FolderOpen, FolderPlus, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import type { FolderPreview } from '../../shared/api';
import { t } from '../../shared/i18n';
import { privacyLevelPatch } from '../../shared/privacy';
import { formatCount } from './format';
import { api, type AppModel } from './useApp';
import { Banner, Button, Checkbox, Disclosure, LogoMark, Spinner, ToggleRow } from './ui';

type Level = 'standard' | 'discreet';

/** First run in three steps: find the mods, choose how private to be, then the first check (on the home screen). */
export function Setup({ app }: { app: AppModel }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [detected, setDetected] = useState<string[]>();
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<{ dirs: string; value?: FolderPreview }>();
  const [level, setLevel] = useState<Level>();
  const [checkOnLaunch, setCheckOnLaunch] = useState(false);
  const [starting, setStarting] = useState(false);
  const hasPrivateBrowser = (app.snapshot?.browsers.length ?? 0) > 0;

  useEffect(() => {
    void api.detectModsDirs().then((dirs) => {
      setDetected(dirs);
      setSelected(dirs.slice(0, 1));
    });
  }, []);

  // What's in the chosen folders (and a warm scan cache for the first check).
  const selectedKey = selected.join('\n');
  useEffect(() => {
    if (!selectedKey) return;
    let live = true;
    void api.previewDirs(selectedKey.split('\n')).then(
      (value) => live && setPreview({ dirs: selectedKey, value }),
      () => live && setPreview({ dirs: selectedKey }),
    );
    return () => {
      live = false;
    };
  }, [selectedKey]);

  const addFolder = async (replace = false): Promise<void> => {
    const dir = await app.run(() => api.chooseDirectory());
    if (!dir) return;
    setDetected((prev) => (prev?.includes(dir) ? prev : [...(prev ?? []), dir]));
    setSelected((prev) => (replace ? [dir] : prev.includes(dir) ? prev : [...prev, dir]));
  };

  const start = async (): Promise<void> => {
    if (!level) return;
    setStarting(true);
    const ok = await app.run(async () => {
      await api.updateSettings({ ...privacyLevelPatch(level, hasPrivateBrowser), checkOnLaunch });
      await api.setDirs(selected);
      await api.startCheck();
      return true;
    });
    if (!ok) setStarting(false);
  };

  const stats = preview?.dirs === selectedKey ? preview.value : undefined;
  const scanning = selected.length > 0 && preview?.dirs !== selectedKey;
  const m = t().setup;

  return (
    <div className="setup">
      <header className="setup-brand">
        <LogoMark />
        <span>WhimWatch</span>
      </header>
      <main className="setup-main" id="main">
        <ol className="stepper" aria-label={m.steps}>
          <Step n={1} label={m.stepMods} state={step === 1 ? 'current' : 'done'} />
          <Step n={2} label={m.stepPrivacy} state={step === 2 ? 'current' : 'todo'} />
          <Step n={3} label={m.stepCheck} state="todo" />
        </ol>
        {app.error && (
          <Banner tone="error" onClose={() => app.setError(undefined)}>
            {app.error}
          </Banner>
        )}

        {step === 1 ? (
          <>
            <h1>{m.findTitle}</h1>
            <p className="lead muted">{m.findLead}</p>

            {detected === undefined ? (
              <div className="card found-card">
                <p className="row-center muted">
                  <Spinner /> {m.looking}
                </p>
              </div>
            ) : detected.length === 0 ? (
              <div className="card found-card">
                <div className="found-head">
                  <span className="tone-icon round amber">
                    <CircleDashed size={18} aria-hidden="true" />
                  </span>
                  <div className="grow">
                    <strong>{m.notFound}</strong>
                    <p className="muted small">{m.notFoundHint}</p>
                  </div>
                  <Button icon={FolderOpen} onClick={() => addFolder(true)} data-autofocus>
                    {m.chooseFolder}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="card found-card">
                <div className="found-head">
                  <span className="tone-icon round mint">
                    <Check size={18} aria-hidden="true" />
                  </span>
                  <div className="grow">
                    <strong>{detected.length === 1 ? m.foundOne : m.foundMany(detected.length)}</strong>
                    {detected.length === 1 ? (
                      <p className="mono small muted">{detected[0]}</p>
                    ) : (
                      <ul className="plain-list">
                        {detected.map((dir) => (
                          <li key={dir}>
                            <label className="pick-line">
                              <Checkbox
                                checked={selected.includes(dir)}
                                onChange={() => setSelected((prev) => (prev.includes(dir) ? prev.filter((d) => d !== dir) : [...prev, dir]))}
                                label={m.watch(dir)}
                              />
                              <span className="mono small">{dir}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {detected.length === 1 && (
                    <Button variant="quiet" onClick={() => addFolder(true)}>
                      {t().common.change}
                    </Button>
                  )}
                </div>
                {selected.length > 0 && (
                  <dl className="found-stats">
                    <div>
                      <dt>{m.creators}</dt>
                      <dd>{stats ? formatCount(stats.creators) : scanning ? <Spinner /> : '—'}</dd>
                    </div>
                    <div>
                      <dt>{m.wickedWhims}</dt>
                      <dd>
                        {stats ? (
                          stats.wickedWhims ? (
                            <>
                              <CheckCircle2 size={18} className="mint" aria-hidden="true" /> {m.yes}
                            </>
                          ) : (
                            m.notInstalled
                          )
                        ) : scanning ? (
                          <Spinner />
                        ) : (
                          '—'
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>{m.otherMods}</dt>
                      <dd>{stats ? formatCount(stats.otherFiles) : scanning ? <Spinner /> : '—'}</dd>
                    </div>
                  </dl>
                )}
              </div>
            )}

            <div className="row-center gap">
              <Button variant="quiet" icon={FolderPlus} onClick={() => addFolder()}>
                {m.addFolder}
              </Button>
              <span className="faint small">{m.addFolderHint}</span>
            </div>

            <footer className="setup-foot">
              <span className="faint small row-center">
                <ShieldCheck size={15} aria-hidden="true" /> {m.filesStayHere}
              </span>
              <span className="spacer" />
              <Button variant="primary" disabled={!selected.length} onClick={() => setStep(2)}>
                {m.continue}
              </Button>
            </footer>
          </>
        ) : (
          <>
            <h1>{m.privacyTitle}</h1>
            <p className="lead muted">{m.privacyLead}</p>

            <div className="level-cards" role="radiogroup" aria-label={m.level}>
              <LevelCard
                value="standard"
                picked={level}
                onPick={setLevel}
                icon={<SlidersHorizontal size={20} aria-hidden="true" />}
                title={m.standard}
                subtitle={m.standardFor}
                points={m.standardPoints}
              />
              <LevelCard
                value="discreet"
                picked={level}
                onPick={setLevel}
                icon={<ShieldCheck size={20} aria-hidden="true" />}
                title={m.discreet}
                subtitle={m.discreetFor}
                points={[
                  app.snapshot?.platform === 'linux' ? m.blurs : m.blursAndBlank,
                  hasPrivateBrowser ? m.titlesHiddenPrivate : m.titlesHidden,
                  m.nothingKept,
                  m.backupsWeek,
                ]}
              />
            </div>

            <div className="card setup-options">
              <ToggleRow
                title={m.checkOnLaunch}
                hint={m.checkOnLaunchHint}
                checked={checkOnLaunch}
                onChange={setCheckOnLaunch}
              />
            </div>

            <Disclosure summary={m.whatSitesSee}>
              <p className="muted small">{m.whatSitesSeeBody}</p>
            </Disclosure>

            <footer className="setup-foot">
              <Button variant="quiet" icon={ArrowLeft} onClick={() => setStep(1)} disabled={starting}>
                {m.back}
              </Button>
              <span className="spacer" />
              <Button variant="primary" onClick={start} disabled={!level || starting} title={level ? undefined : m.pickFirst}>
                {starting ? m.starting : m.start}
              </Button>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}

function Step({ n, label, state }: { n: number; label: string; state: 'done' | 'current' | 'todo' }) {
  return (
    <li className={`step step-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
      <span className="step-mark">{state === 'done' ? <Check size={14} aria-label={t().setup.done} /> : n}</span>
      {label}
    </li>
  );
}

function LevelCard({
  value,
  picked,
  onPick,
  icon,
  title,
  subtitle,
  points,
}: {
  value: Level;
  picked?: Level;
  onPick: (level: Level) => void;
  icon: ReactNode;
  title: string;
  subtitle: string;
  points: readonly string[];
}) {
  const on = picked === value;
  return (
    <button type="button" role="radio" aria-checked={on} className={`level-card ${on ? 'on' : ''}`} onClick={() => onPick(value)}>
      <span className="level-head">
        <span className="level-icon">{icon}</span>
        <span className="level-title">
          <strong>{title}</strong>
          <span className="muted small">{subtitle}</span>
        </span>
        <span className="radio" aria-hidden="true" />
      </span>
      <ul className="level-points">
        {points.map((p) => (
          <li key={p}>
            <Check size={15} aria-hidden="true" /> {p}
          </li>
        ))}
      </ul>
    </button>
  );
}
