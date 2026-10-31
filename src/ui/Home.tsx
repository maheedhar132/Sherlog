import { useRef } from 'react';
import { PLACEMENT_MATCHES, TARGET_WIN_RATE, weakestFault, type Profile } from '../ai/adapter';
import { fmt, todayKey } from '../game/session';
import { FAULTS, FAULT_IDS } from '../sim/faults';
import type { Mode } from '../sim/types';

interface Props {
  profile: Profile;
  onPlay: (mode: Mode) => void;
  onDaily: () => void;
  onOpenGuide: () => void;
  onImport: (json: string) => void;
  onExport: () => void;
  onReset: () => void;
}

const MODE_INFO: Record<Mode, { title: string; blurb: string }> = {
  easy: { title: 'Easy', blurb: 'One red herring. A patient AI.' },
  normal: { title: 'Normal', blurb: 'Coincidental deploys and noisy logs.' },
  hard: { title: 'Hard', blurb: 'Three red herrings. A ruthless AI.' },
};

export function Home({ profile, onPlay, onDaily, onOpenGuide, onImport, onExport, onReset }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const placement = profile.played < PLACEMENT_MATCHES;
  const weakest = weakestFault(profile);
  const recent = profile.history.slice(0, 20);
  const wins = recent.filter((h) => h.won).length;
  const dailyDone = profile.daily?.date === todayKey() ? profile.daily : null;

  return (
    <div className="home">
      <section className="hero">
        <div className="eyebrow">an on-call training game</div>
        <h1>
          Incident<span>Race</span>
        </h1>
        <p className="tagline">
          Production is on fire. You and an AI investigator get the same dashboards: metrics, logs, traces, deploys. Every query costs
          time. First to name the root cause wins. <b>The AI learns how you debug</b> and adapts, so every incident stays a fight.
        </p>
        <p className="sub">100% free and offline · runs in your browser · no account, no API keys, no tracking</p>
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
          </div>
        </button>
      </section>

      <div className="home-grid">
        <section className="card">
          <h3>How to play</h3>
          <ol className="howto">
            <li>The <b>service map</b> shows what is paging. Paging services are usually victims, not the cause.</li>
            <li>
              Pull <b>metrics</b> (10s), <b>logs</b> (15s), <b>traces</b> (20s) or the <b>deploy log</b> (5s). Your clock is real time
              plus query costs.
            </li>
            <li>
              <b>Declare</b> the service and fault. A wrong answer adds 20s.
            </li>
            <li>The <b>postmortem</b> replays your path next to the AI's, so you see exactly where it was smarter.</li>
          </ol>
          <button onClick={onOpenGuide}>📘 Open the field guide (6 fault types)</button>
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
              <ul className="skills">
                {FAULT_IDS.map((f) => {
                  const s = profile.faults[f];
                  const mean = s.a / (s.a + s.b);
                  return (
                    <li key={f}>
                      <span>{FAULTS[f].name}</span>
                      <div className="bar">
                        <div style={{ width: `${Math.round(mean * 100)}%` }} />
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
        Open source · MIT · <a href="https://github.com/">star it on GitHub</a> if it made you a better on-caller.
      </footer>
    </div>
  );
}
