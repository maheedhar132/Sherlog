import { useRef } from 'react';
import { PLACEMENT_MATCHES, TARGET_WIN_RATE, weakestFault, type Profile } from '../ai/adapter';
import { fmt, todayKey } from '../game/session';
import { streakView } from '../game/streak';
import { FAULTS, FAULT_IDS } from '../sim/faults';
import type { Mode } from '../sim/types';

interface Props {
  profile: Profile;
  onPlay: (mode: Mode) => void;
  onTutorial: () => void;
  onDaily: () => void;
  onShift: (mode: Mode) => void;
  onOpenGuide: () => void;
  onImport: (json: string) => void;
  onExport: () => void;
  onReset: () => void;
}

/** Titles earned by solving different kinds of incident. */
const RANKS: [number, string][] = [
  [22, 'Principal SRE'],
  [18, 'Staff SRE'],
  [12, 'Senior SRE'],
  [7, 'On-call engineer'],
  [3, 'Responder'],
  [0, 'Pager rookie'],
];

const MODE_INFO: Record<Mode, { title: string; blurb: string }> = {
  easy: { title: 'Easy', blurb: 'A smaller system, one red herring and a coach by your side.' },
  normal: { title: 'Normal', blurb: 'A bigger system, coincidental deploys and noisy logs.' },
  hard: { title: 'Hard', blurb: 'Three red herrings, and a signal goes missing. A ruthless AI.' },
};

export function Home({ profile, onPlay, onTutorial, onDaily, onShift, onOpenGuide, onImport, onExport, onReset }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const placement = profile.played < PLACEMENT_MATCHES;
  const weakest = weakestFault(profile);
  const recent = profile.history.slice(0, 20);
  const wins = recent.filter((h) => h.won).length;
  const dailyDone = profile.daily?.date === todayKey() ? profile.daily : null;
  const streak = streakView(profile.streak, todayKey());
  const ds = profile.dailyStats;
  const pct = (n: number) => (ds.played ? `${Math.round((n / ds.played) * 100)}%` : '–');
  const solvedKinds = FAULT_IDS.filter((f) => profile.faults[f].solved > 0).length;
  const rank = RANKS.find(([min]) => solvedKinds >= min)![1];

  return (
    <div className="home">
      <section className="hero">
        <div className="eyebrow">elementary, my dear SRE</div>
        <h1>
          Sher<span>log</span>
        </h1>
        <p className="tagline">
          Production is on fire. You and an AI investigator get the same dashboards: metrics, logs, traces and the change log. Every
          query costs time. First to find the root cause and fix it wins. <b>The AI adapts to how well you do</b> and serves more of the incidents you're weakest at, so every one stays a fight.
        </p>
        <div className="hero-cta">
          {profile.tutorialDone ? (
            <button className="primary big" onClick={() => onPlay('normal')}>
              ▶ Play an incident
            </button>
          ) : (
            <>
              <button className="primary big" onClick={onTutorial}>
                ▶ Start the 2-minute training
              </button>
              <button className="big" onClick={() => onPlay('normal')}>
                Skip, I'm on-call already
              </button>
            </>
          )}
        </div>
        <p className="sub">free · runs entirely in your browser · no server, no account, no API keys, no tracking</p>
      </section>

      {placement && (
        <div className="banner">
          🎯 Placement: {profile.played}/{PLACEMENT_MATCHES} incidents. The AI is calibrating to you; it adapts faster during placement.
        </div>
      )}

      <section className="modes">
        {(Object.keys(MODE_INFO) as Mode[]).map((m) => (
          <button key={m} className={`mode-card ${m}`} onClick={() => onPlay(m)}>
            <h2>{MODE_INFO[m].title}</h2>
            <p>{MODE_INFO[m].blurb}</p>
            <div className="mode-meta">
              <span>AI strength {Math.round(profile.strength[m] * 100)}</span>
              <span>tuned so you win ~{Math.round(TARGET_WIN_RATE[m] * 100)}%</span>
            </div>
          </button>
        ))}
        <button className="mode-card shift" onClick={() => onShift('normal')}>
          <h2>On-call shift</h2>
          <p>Three incidents back to back. Your total time against the AI's.</p>
          <div className="mode-meta">
            {profile.bestShift ? (
              <span>
                best: {profile.bestShift.solved}/3 solved · {fmt(profile.bestShift.total)}
              </span>
            ) : (
              <span>normal mode · 3 incidents</span>
            )}
          </div>
        </button>
        <button className="mode-card daily" onClick={onDaily} disabled={!!dailyDone}>
          <h2>Daily incident</h2>
          <p>Same incident, same AI, for everyone today. Share your trail.</p>
          <div className="mode-meta">
            {dailyDone ? (
              <span>
                done: {dailyDone.won ? 'won 🏆' : 'lost'} · {dailyDone.playerMttr === null ? 'unsolved' : fmt(dailyDone.playerMttr)}
              </span>
            ) : (
              <span>fixed AI · normal mode</span>
            )}
            {streak.current > 0 && (
              <span className="streak">
                🔥 {streak.current}-day streak{streak.atRisk && !dailyDone ? ': solve today to keep it' : ''}
              </span>
            )}
          </div>
        </button>
      </section>

      <div className="home-grid">
        <section className="card">
          <h3>How to play</h3>
          <ol className="howto">
            <li>The <b>service map</b> shows what is paging. Paging services are usually victims, not the cause.</li>
            <li>
              Pull <b>metrics</b> (10s), <b>logs</b> (15s), <b>traces</b> (20s) or the <b>change log</b> (5s). Your clock is real time
              plus query costs.
            </li>
            <li>
              <b>Declare</b> the service and fault. A wrong answer adds 20s, and each further miss costs 20s more, so guessing doesn't pay. Then <b>choose the fix</b> that stops the bleeding: a wrong fix costs time too.
            </li>
            <li>The <b>postmortem</b> replays your path next to the AI's, so you see exactly where it was smarter.</li>
          </ol>
          <div className="row-buttons">
            <button onClick={onOpenGuide}>📘 Open the field guide ({FAULT_IDS.length} fault types)</button>
            {profile.tutorialDone && <button onClick={onTutorial}>Replay the training</button>}
          </div>
        </section>

        <section className="card">
          <h3>Your on-call profile</h3>
          {profile.played === 0 ? (
            <p className="muted">Play an incident to start building your profile.</p>
          ) : (
            <>
              <p>
                {profile.played} incidents · last {recent.length}: {wins} won
                {weakest && (
                  <>
                    {' '}
                    · weakest: <b>{FAULTS[weakest].name}</b>
                  </>
                )}
              </p>
              <p className="rank">
                🏅 {rank} · incident codex {solvedKinds}/{FAULT_IDS.length}
              </p>
              {ds.played > 0 && (
                <div className="daily-stats" aria-label="Daily incident stats">
                  <div>
                    <b>{ds.played}</b>
                    <span>dailies played</span>
                  </div>
                  <div>
                    <b>{pct(ds.solved)}</b>
                    <span>solved</span>
                  </div>
                  <div>
                    <b>{pct(ds.won)}</b>
                    <span>beat the AI</span>
                  </div>
                  <div>
                    <b>{streak.current}</b>
                    <span>current streak</span>
                  </div>
                  <div>
                    <b>{streak.best}</b>
                    <span>best streak</span>
                  </div>
                </div>
              )}
              <ul className="skills">
                {FAULT_IDS.map((f) => {
                  const s = profile.faults[f];
                  const mean = s.a / (s.a + s.b);
                  return (
                    <li key={f}>
                      <span>{FAULTS[f].name}</span>
                      <div className="bar">
                        <div style={{ width: `${s.played ? Math.round(mean * 100) : 0}%` }} />
                      </div>
                      <small>
                        {s.played ? `${s.played} played${s.avgMttr !== null ? ` · ${fmt(s.avgMttr)} avg` : ''}` : 'not seen yet'}
                      </small>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <div className="row-buttons small">
            <button onClick={onExport}>Export profile</button>
            <button onClick={() => fileRef.current?.click()}>Import</button>
            <button onClick={() => confirm('Reset your profile and AI calibration?') && onReset()}>Reset</button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) onImport(await f.text());
                e.target.value = '';
              }}
            />
          </div>
        </section>
      </div>

      <footer className="foot">
        Open source · MIT · <a href="https://github.com/maheedhar132/Sherlog">star it on GitHub</a> if it made you a better on-caller.
      </footer>
    </div>
  );
}
