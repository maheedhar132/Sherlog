import { useEffect, useState } from 'react';
import { newProfile, recordMatch, type Profile } from '../ai/adapter';
import { createDaily, createFromSeed, createMatch, createShiftIncident, createTutorial, parseIncidentHash, shareText, type MatchResult, type MatchSetup } from '../game/session';
import { isBetterShift, scoreShift, SHIFT_LENGTH, toEntry, type ShiftEntry } from '../game/shift';
import { recordDaily } from '../game/streak';
import { exportProfile, importProfile, loadProfile, saveProfile } from '../lib/storage';
import type { Mode } from '../sim/types';
import { FieldGuide } from './FieldGuide';
import { Home } from './Home';
import { Match } from './Match';
import { Postmortem } from './Postmortem';
import { ShiftSummary } from './ShiftSummary';

type Screen =
  | { name: 'home' }
  | { name: 'match'; setup: MatchSetup }
  | { name: 'shift'; mode: Mode; entries: ShiftEntry[]; best: boolean }
  | { name: 'post'; setup: MatchSetup; result: MatchResult; before: number; after: number };

export function App() {
  const [profile, setProfile] = useState<Profile>(loadProfile);
  const [screen, setScreen] = useState<Screen>(() => {
    const link = parseIncidentHash(location.hash);
    return link ? { name: 'match', setup: createFromSeed(link.seed, link.mode, loadProfile(), link.fault) } : { name: 'home' };
  });
  const [guide, setGuide] = useState(false);
  const [shiftRun, setShiftRun] = useState<{ mode: Mode; entries: ShiftEntry[] } | null>(null);

  useEffect(() => {
    saveProfile(profile);
  }, [profile]);
  // Pasting a shared incident link into an open tab starts that incident.
  useEffect(() => {
    const onHash = () => {
      const link = parseIncidentHash(location.hash);
      if (link) setScreen({ name: 'match', setup: createFromSeed(link.seed, link.mode, profile, link.fault) });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [profile]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen.name]);

  const play = (mode: Mode) => setScreen({ name: 'match', setup: createMatch(profile, mode) });

  const startShift = (mode: Mode) => {
    setShiftRun({ mode, entries: [] });
    setScreen({ name: 'match', setup: createShiftIncident(profile, mode, 1, SHIFT_LENGTH) });
  };

  // After a shift incident: the next one, or the summary (which also records your best shift).
  const advance = (setup: MatchSetup) => {
    const shift = setup.shift;
    if (!shift || !shiftRun) return play(setup.mode);
    if (shift.n < shift.of) return setScreen({ name: 'match', setup: createShiftIncident(profile, setup.mode, shift.n + 1, shift.of) });
    const score = scoreShift(shiftRun.entries);
    const best = isBetterShift(score, profile.bestShift);
    setProfile({
      ...profile,
      shifts: (profile.shifts ?? 0) + 1,
      ...(best ? { bestShift: { solved: score.solved, total: score.total, date: new Date().toISOString().slice(0, 10) } } : {}),
    });
    setScreen({ name: 'shift', mode: shiftRun.mode, entries: shiftRun.entries, best });
  };

  const finish = (setup: MatchSetup, result: MatchResult) => {
    if (setup.shift) setShiftRun((r) => (r ? { ...r, entries: [...r.entries, toEntry(result)] } : r));
    if (setup.tutorial) {
      // Training is unranked: it leaves the AI calibration and the record alone.
      setProfile({ ...profile, tutorialDone: true });
      setScreen({ name: 'post', setup, result, before: 0, after: 0 });
      return;
    }
    const recorded = recordMatch(profile, {
      at: new Date().toISOString(),
      mode: setup.mode,
      fault: setup.incident.truth.fault,
      won: result.won,
      playerMttr: result.playerMttr,
      aiMttr: result.aiMttr,
      daily: !!setup.daily,
    });
    let next = recorded.profile;
    if (setup.daily) {
      next = recordDaily(next, setup.daily.date, result.won, result.playerMttr !== null);
      next.daily = {
        date: setup.daily.date,
        won: result.won,
        playerMttr: result.playerMttr,
        aiMttr: result.aiMttr,
        share: shareText(setup, result, location.href.split('#')[0], next.streak.current),
      };
    }
    setProfile(next);
    setScreen({ name: 'post', setup, result, before: recorded.before, after: recorded.after });
  };

  // No runbook on Hard: the field guide lists every signal and fix.
  const lockGuide = screen.name === 'match' && screen.setup.mode === 'hard' && !screen.setup.tutorial;

  return (
    <div className="app">
      <nav className="topnav">
        <button className="brand" onClick={() => setScreen({ name: 'home' })}>
          🔍 Sher<b>log</b>
        </button>
        <button onClick={() => setGuide(true)} disabled={lockGuide} title={lockGuide ? 'No runbook on Hard' : undefined}>
          Field guide{lockGuide ? ' (off in Hard)' : ''}
        </button>
      </nav>

      {screen.name === 'home' && (
        <Home
          profile={profile}
          onPlay={play}
          onTutorial={() => setScreen({ name: 'match', setup: createTutorial() })}
          onDaily={() => setScreen({ name: 'match', setup: createDaily() })}
          onShift={startShift}
          onOpenGuide={() => setGuide(true)}
          onExport={() => {
            const blob = new Blob([exportProfile(profile)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'sherlog-profile.json';
            a.click();
            URL.revokeObjectURL(a.href);
          }}
          onImport={(json) => {
            try {
              setProfile(importProfile(json));
            } catch (e) {
              alert(`Could not import: ${(e as Error).message}`);
            }
          }}
          onReset={() => setProfile(newProfile())}
        />
      )}
      {screen.name === 'match' && (
        <Match
          key={screen.setup.incident.seed}
          setup={screen.setup}
          coachDefault={profile.played < 3 || screen.setup.mode === 'easy'}
          onFinish={(r) => finish(screen.setup, r)}
          onOpenGuide={() => setGuide(true)}
        />
      )}
      {screen.name === 'post' && (
        <Postmortem
          setup={screen.setup}
          result={screen.result}
          profile={profile}
          strengthBefore={screen.before}
          strengthAfter={screen.after}
          onNext={() => advance(screen.setup)}
          onHome={() => setScreen({ name: 'home' })}
        />
      )}
      {screen.name === 'shift' && (
        <ShiftSummary entries={screen.entries} mode={screen.mode} best={screen.best} profile={profile} onAgain={() => startShift(screen.mode)} onHome={() => setScreen({ name: 'home' })} />
      )}
      {guide && <FieldGuide onClose={() => setGuide(false)} />}
    </div>
  );
}
