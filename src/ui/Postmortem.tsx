import { useState } from 'react';
import { weakestFault, type Profile } from '../ai/adapter';
import { fmt, shareText, type MatchResult, type MatchSetup } from '../game/session';
import { detectLogs, observe } from '../sim/detect';
import { FAULTS } from '../sim/faults';
import { FIXES, FIX_FOR } from '../sim/fixes';
import type { Channel, QueryKey } from '../sim/types';
import type { Suspect } from '../ai/investigator';
import { BeliefChart } from './BeliefChart';
import { CHANNEL_ICON, FEATURE_LABEL, describeQuery } from './labels';

/** The AI's leading hypotheses and its belief in each. */
function Suspects({ list }: { list: Suspect[] }) {
  const shown = list.filter((s) => s.p >= 0.01);
  return (
    <div className="suspects">
      {shown.map((s, i) => (
        <span key={i} className={i === 0 ? 'lead' : ''}>
          {FAULTS[s.hyp.fault].name} @ {s.hyp.service} {Math.round(s.p * 100)}%
        </span>
      ))}
    </div>
  );
}

interface Props {
  setup: MatchSetup;
  result: MatchResult;
  profile: Profile;
  strengthBefore: number;
  strengthAfter: number;
  onNext: () => void;
  onHome: () => void;
}

export function Postmortem({ setup, result, profile, strengthBefore, strengthAfter, onNext, onHome }: Props) {
  const { incident, ai } = setup;
  const truth = incident.truth;
  const fault = FAULTS[truth.fault];
  const [copied, setCopied] = useState(false);

  const isKey = (key: QueryKey) => (key === 'deploys' ? ['bad_deploy', 'config_flag'].includes(truth.fault) : key.endsWith(`:${truth.service}`));
  const rightFix = FIX_FOR[truth.fault];
  const wrongFixes = result.actions.filter((a) => a.kind === 'fix' && !a.correct);
  const playerKeys = new Set(result.actions.filter((a) => a.kind === 'query').map((a) => a.key!));
  const missed = (['metrics', 'logs', 'traces'] as Channel[]).filter((c) => !playerKeys.has(`${c}:${truth.service}`));
  const evidence = (c: Channel): string => {
    if (c === 'logs') {
      const line = incident.data.logs[truth.service].find((l) => detectLogs([l]).size > 0);
      if (line) return `"${line.msg}"`;
    }
    const feats = [...observe(incident, `${c}:${truth.service}`)].map((f) => FEATURE_LABEL[f] ?? f);
    return feats.length ? feats.join(', ') : 'looked normal (the cause showed up in its callers instead)';
  };

  const weakest = weakestFault(profile);
  const share = shareText(setup, result, location.href.split('#')[0], setup.daily ? profile.streak.current : 0);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(share);
      setCopied(true);
    } catch {
      prompt('Copy your result:', share);
    }
  };

  const headline =
    result.won ? '🏆 You beat the AI' : result.playerMttr !== null ? '🤖 Solved, but the AI was faster' : '🤖 The AI took this one';

  return (
    <div className="postmortem">
      <header className="pm-head">
        <div>
          <h1>{headline}</h1>
          {result.breached && <p className="muted">🔥 SLO breached: the incident burned the whole 10-minute error budget.</p>}
        </div>
        <div className="pm-score">
          <div>
            <span>Your MTTR</span>
            <b>{result.playerMttr === null ? 'n/a' : fmt(result.playerMttr)}</b>
          </div>
          <div>
            <span>AI MTTR</span>
            <b>{fmt(ai.mttr)}</b>
          </div>
        </div>
      </header>

      <section className="card root-cause">
        <h2>
          Root cause: {fault.name} on <code>{truth.service}</code>
        </h2>
        <p>{fault.story(truth.service)}</p>
        <h4>Tell-tale signals</h4>
        <ul>
          {fault.signals.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <p className="tip">💡 {fault.tip}</p>
      </section>

      <div className="pm-grid">
        <section className="card fix-card">
          <h3>The fix</h3>
          <p className="fix-name">🔧 {rightFix ? FIXES[rightFix.fix] : 'Restart the service'}</p>
          {rightFix && <p>{rightFix.why}</p>}
          <p className="muted">
            {result.playerMttr === null
              ? 'You never got as far as the fix.'
              : wrongFixes.length === 0
                ? '✓ You picked it first time.'
                : `You needed ${wrongFixes.length + 1} tries (+${wrongFixes.reduce((n, a) => n + a.cost, 0)} s).`}
          </p>
        </section>
        <section className="card">
          <h3>How sure the AI was of the right answer</h3>
          <BeliefChart prior={ai.priorTruth} actions={ai.actions} />
          <p className="hint">Each dot is a step. Dips are where evidence pointed the wrong way, such as a red herring.</p>
        </section>
      </div>

      <div className="pm-grid">
        <section className="card">
          <h3>Your investigation</h3>
          <ol className="timeline">
            {result.actions.map((a, i) => (
              <li
                key={i}
                className={a.kind === 'declare' || a.kind === 'fix' ? (a.correct ? 'good' : 'bad') : a.kind === 'query' && isKey(a.key!) ? 'key' : ''}
              >
                <time>{fmt(a.clock)}</time>
                {a.kind === 'declare'
                  ? `${a.correct ? '✓' : '✗'} declared ${FAULTS[a.hyp!.fault].name} @ ${a.hyp!.service}${a.correct ? '' : ` (+${a.cost}s)`}`
                  : a.kind === 'fix'
                    ? `${a.correct ? '🔧 fixed' : '✗ wrong fix'}: ${FIXES[a.fix!]}${a.correct ? '' : ` (+${a.cost}s)`}`
                    : a.kind === 'hint'
                      ? `💡 hint${a.cost ? ` (+${a.cost}s)` : ''}`
                      : `${CHANNEL_ICON[describeQuery(a.key!).channel]} ${a.key}${isKey(a.key!) ? ' ⭐' : ''}`}
              </li>
            ))}
            {!result.actions.length && <li className="muted">no actions</li>}
          </ol>
        </section>
        <section className="card">
          <h3>AI investigation: its reasoning</h3>
          <ol className="timeline">
            <li>
              <time>0:00</time>🔔 reads the paging alerts
              <Suspects list={ai.prior} />
            </li>
            {ai.actions.map((a, i) => (
              <li key={i} className={a.kind === 'fix' ? 'good' : a.kind === 'declare' ? (a.correct ? 'good' : 'bad') : isKey(a.key) ? 'key' : ''}>
                <time>{fmt(a.wall + ai.actions.slice(0, i).reduce((sum, x) => sum + x.cost, 0))}</time>
                {a.kind === 'declare'
                  ? `${a.correct ? '✓' : '✗'} declared ${FAULTS[a.hyp.fault].name} @ ${a.hyp.service} (${Math.round(a.confidence * 100)}% sure)`
                  : a.kind === 'fix'
                    ? `🔧 applied: ${FIXES[a.fix]}`
                    : `${CHANNEL_ICON[describeQuery(a.key).channel]} ${a.key}${isKey(a.key) ? ' ⭐' : ''}`}
                {a.kind !== 'fix' && <Suspects list={a.suspects} />}
              </li>
            ))}
          </ol>
          <p className="hint">
            After every step the AI re-weighs all of its hypotheses, then opens the dashboard that should shrink its uncertainty most per
            second it costs. That is not always its top suspect: a probe that splits many hypotheses at once can be worth more. It sees only
            what you see.
          </p>
        </section>
      </div>

      <div className="pm-grid">
        <section className="card">
          <h3>What you didn't look at</h3>
          {missed.length ? (
            <ul className="missed">
              {missed.map((c) => (
                <li key={c}>
                  {CHANNEL_ICON[c]} <b>{c}</b> of {truth.service}: {evidence(c)}
                </li>
              ))}
            </ul>
          ) : (
            <p>You checked every signal on the culprit. 👏</p>
          )}
          {incident.herrings.length > 0 && (
            <>
              <h4>Red herrings in this incident</h4>
              <ul>
                {incident.herrings.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section className="card">
          <h3>How the AI adapted</h3>
          {setup.tutorial ? (
            <p>Training incidents are unranked: they don't change your AI calibration or your record. Ready for a real one?</p>
          ) : setup.daily ? (
            <>
              <p>Daily incidents use a fixed AI so everyone races the same opponent. Your skill profile still updated.</p>
              <p>
                {result.playerMttr === null ? (
                  <>
                    🔥 Streak reset: you didn't solve today's daily. Best streak: <b>{profile.streak.best}</b>.
                  </>
                ) : (
                  <>
                    🔥 Daily streak: <b>{profile.streak.current}</b> {profile.streak.current === 1 ? 'day' : 'days'} · best{' '}
                    <b>{profile.streak.best}</b>. Come back tomorrow to keep it going.
                  </>
                )}
              </p>
            </>
          ) : (
            <p>
              AI strength ({setup.mode}): <b>{Math.round(strengthBefore * 100)}</b> → <b>{Math.round(strengthAfter * 100)}</b>
              {strengthAfter > strengthBefore ? ' ⬆ it will be sharper next time.' : strengthAfter < strengthBefore ? ' ⬇ it will ease off a little.' : ''}
            </p>
          )}
          {weakest && (
            <p>
              Your weakest area so far: <b>{FAULTS[weakest].name}</b>. Upcoming incidents lean toward it.
            </p>
          )}
          <pre className="share">{share}</pre>
          <div className="row-buttons">
            <button onClick={copy}>{copied ? 'Copied ✓' : '📋 Copy result'}</button>
            {!setup.daily && (
              <button className="primary" onClick={onNext}>
                {setup.tutorial ? 'Play a real incident →' : setup.shift ? (setup.shift.n < setup.shift.of ? `Next in your shift (${setup.shift.n + 1}/${setup.shift.of}) →` : 'See your shift →') : 'Next incident →'}
              </button>
            )}
            <button onClick={onHome}>Home</button>
          </div>
        </section>
      </div>
    </div>
  );
}
