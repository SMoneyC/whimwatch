import { ArrowLeft, Check, CheckCircle2, CircleDashed, FolderOpen, FolderPlus, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import type { FolderPreview } from '../../shared/api';
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

  return (
    <div className="setup">
      <header className="setup-brand">
        <LogoMark />
        <span>WhimWatch</span>
      </header>
      <main className="setup-main" id="main">
        <ol className="stepper" aria-label="Setup steps">
          <Step n={1} label="Your mods" state={step === 1 ? 'current' : 'done'} />
          <Step n={2} label="Privacy" state={step === 2 ? 'current' : 'todo'} />
          <Step n={3} label="First check" state="todo" />
        </ol>
        {app.error && (
          <Banner tone="error" onClose={() => app.setError(undefined)}>
            {app.error}
          </Banner>
        )}

        {step === 1 ? (
          <>
            <h1>Let’s find your mods</h1>
            <p className="lead muted">WhimWatch looks for WickedWhims and the animation packs you’ve installed, then tells you when creators post something newer.</p>

            {detected === undefined ? (
              <div className="card found-card">
                <p className="row-center muted">
                  <Spinner /> Looking for your Mods folder…
                </p>
              </div>
            ) : detected.length === 0 ? (
              <div className="card found-card">
                <div className="found-head">
                  <span className="tone-icon round amber">
                    <CircleDashed size={18} aria-hidden="true" />
                  </span>
                  <div className="grow">
                    <strong>Couldn’t find your Mods folder</strong>
                    <p className="muted small">It’s usually Documents/Electronic Arts/The Sims 4/Mods. Choose it yourself.</p>
                  </div>
                  <Button icon={FolderOpen} onClick={() => addFolder(true)} data-autofocus>
                    Choose folder…
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
                    <strong>{detected.length === 1 ? 'Found your Mods folder' : `Found ${detected.length} Mods folders`}</strong>
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
                                label={`Watch ${dir}`}
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
                      Change
                    </Button>
                  )}
                </div>
                {selected.length > 0 && (
                  <dl className="found-stats">
                    <div>
                      <dt>animation creators</dt>
                      <dd>{stats ? formatCount(stats.creators) : scanning ? <Spinner /> : '—'}</dd>
                    </div>
                    <div>
                      <dt>WickedWhims installed</dt>
                      <dd>
                        {stats ? (
                          stats.wickedWhims ? (
                            <>
                              <CheckCircle2 size={18} className="mint" aria-hidden="true" /> Yes
                            </>
                          ) : (
                            'Not found'
                          )
                        ) : scanning ? (
                          <Spinner />
                        ) : (
                          '—'
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>other mods, left alone</dt>
                      <dd>{stats ? formatCount(stats.otherFiles) : scanning ? <Spinner /> : '—'}</dd>
                    </div>
                  </dl>
                )}
              </div>
            )}

            <div className="row-center gap">
              <Button variant="quiet" icon={FolderPlus} onClick={() => addFolder()}>
                Add another folder
              </Button>
              <span className="faint small">For example, a folder of mods you’ve switched off</span>
            </div>

            <footer className="setup-foot">
              <span className="faint small row-center">
                <ShieldCheck size={15} aria-hidden="true" /> Your files never leave this computer.
              </span>
              <span className="spacer" />
              <Button variant="primary" disabled={!selected.length} onClick={() => setStep(2)}>
                Continue
              </Button>
            </footer>
          </>
        ) : (
          <>
            <h1>How private should WhimWatch be?</h1>
            <p className="lead muted">Pick one to continue. You can change this any time in Settings.</p>

            <div className="level-cards" role="radiogroup" aria-label="Privacy level">
              <LevelCard
                value="standard"
                picked={level}
                onPick={setLevel}
                icon={<SlidersHorizontal size={20} aria-hidden="true" />}
                title="Standard"
                subtitle="For a computer only you use"
                points={['Sign-ins to LoversLab and Patreon are remembered', 'Links open in your usual browser', 'Backups of replaced files kept for 30 days', 'No creator names in notifications']}
              />
              <LevelCard
                value="discreet"
                picked={level}
                onPick={setLevel}
                icon={<ShieldCheck size={20} aria-hidden="true" />}
                title="Discreet"
                subtitle="For shared computers and screen sharing"
                points={[
                  app.snapshot?.platform === 'linux'
                    ? 'Blurs whenever WhimWatch isn’t the active window'
                    : 'Blurs whenever WhimWatch isn’t the active window, and stays blank in screenshots',
                  hasPrivateBrowser ? 'Post titles hidden, links open in a private window' : 'Post titles hidden',
                  'Nothing kept from LoversLab or Patreon after closing',
                  'Backups deleted after 7 days',
                ]}
              />
            </div>

            <div className="card setup-options">
              <ToggleRow
                title="Also check automatically each time WhimWatch opens"
                hint="Off by default: WhimWatch only checks when you click Check now. You can change this in Settings."
                checked={checkOnLaunch}
                onChange={setCheckOnLaunch}
              />
            </div>

            <Disclosure summary="What can websites see when WhimWatch checks?">
              <p className="muted small">
                A check visits public pages on wickedwhimsmod.com, wicked.cc, loverslab.com and patreon.com, plus WhimWatch’s creator list on
                GitHub. Your files are never uploaded, but like any visit, those sites can see which creators’ pages were checked from your
                internet connection.
              </p>
            </Disclosure>

            <footer className="setup-foot">
              <Button variant="quiet" icon={ArrowLeft} onClick={() => setStep(1)} disabled={starting}>
                Back
              </Button>
              <span className="spacer" />
              <Button variant="primary" onClick={start} disabled={!level || starting} title={level ? undefined : 'Pick Standard or Discreet first'}>
                {starting ? 'Starting…' : 'Start first check'}
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
      <span className="step-mark">{state === 'done' ? <Check size={14} aria-label="Done" /> : n}</span>
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
  points: string[];
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
