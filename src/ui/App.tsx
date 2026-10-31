import { useEffect, useState } from 'react';
import { newProfile, recordMatch, type Profile } from '../ai/adapter';
import { createDaily, createMatch, shareText, type MatchResult, type MatchSetup } from '../game/session';
import { exportProfile, importProfile, loadProfile, saveProfile } from '../lib/storage';
import type { Mode } from '../sim/types';
import { FieldGuide } from './FieldGuide';
import { Home } from './Home';
import { Match } from './Match';
import { Postmortem } from './Postmortem';

type Screen =
  | { name: 'home' }
  | { name: 'match'; setup: MatchSetup }
  | { name: 'post'; setup: MatchSetup; result: MatchResult; before: number; after: number };

export function App() {
  const [profile, setProfile] = useState<Profile>(loadProfile);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [guide, setGuide] = useState(false);

  useEffect(() => {
    saveProfile(profile);
  }, [profile]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen.name]);

  const play = (mode: Mode) => setScreen({ name: 'match', setup: createMatch(profile, mode) });

  const finish = (setup: MatchSetup, result: MatchResult) => {
    const { profile: next, before, after } = recordMatch(profile, {
      at: new Date().toISOString(),
      mode: setup.mode,
      fault: setup.incident.truth.fault,
      won: result.won,
      playerMttr: result.playerMttr,
      aiMttr: result.aiMttr,
      daily: !!setup.daily,
    });
    if (setup.daily) {
      next.daily = {
        date: setup.daily.date,
        won: result.won,
        playerMttr: result.playerMttr,
        aiMttr: result.aiMttr,
        share: shareText(setup, result, location.href.split('#')[0]),
      };
    }
    setProfile(next);
    setScreen({ name: 'post', setup, result, before, after });
  };

  return (
    <div className="app">
      <nav className="topnav">
        <button className="brand" onClick={() => setScreen({ name: 'home' })}>
          🔍 Sher<b>log</b>
        </button>
        <button onClick={() => setGuide(true)}>Field guide</button>
      </nav>

      {screen.name === 'home' && (
        <Home
          profile={profile}
          onPlay={play}
          onDaily={() => setScreen({ name: 'match', setup: createDaily() })}
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
        <Match key={screen.setup.incident.seed} setup={screen.setup} onFinish={(r) => finish(screen.setup, r)} onOpenGuide={() => setGuide(true)} />
      )}
      {screen.name === 'post' && (
        <Postmortem
          setup={screen.setup}
          result={screen.result}
          profile={profile}
          strengthBefore={screen.before}
          strengthAfter={screen.after}
          onNext={() => play(screen.setup.mode)}
          onHome={() => setScreen({ name: 'home' })}
        />
      )}
      {guide && <FieldGuide onClose={() => setGuide(false)} />}
    </div>
  );
}
