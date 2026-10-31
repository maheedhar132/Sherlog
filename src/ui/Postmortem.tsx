import { useState } from 'react';
import { weakestFault, type Profile } from '../ai/adapter';
import { fmt, shareText, type MatchResult, type MatchSetup } from '../game/session';
import { WRONG_PENALTY } from '../sim/constants';
import { detectLogs, observe } from '../sim/detect';
import { FAULTS } from '../sim/faults';
import type { Channel, QueryKey } from '../sim/types';
import { CHANNEL_ICON, FEATURE_LABEL, describeQuery } from './labels';

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

  const isKey = (key: QueryKey) => (key === 'deploys' ? truth.fault === 'bad_deploy' : key.endsWith(`:${truth.service}`));
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
  const share = shareText(setup, result, location.href.split('#')[0]);
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
        <h1>{headline}</h1>
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
        <section className="card">
          <h3>Your investigation</h3>
          <ol className="timeline">
            {result.actions.map((a, i) => (
              <li key={i} className={a.kind === 'declare' ? (a.correct ? 'good' : 'bad') : isKey(a.key!) ? 'key' : ''}>
                <time>{fmt(a.clock)}</time>
                {a.kind === 'declare'
                  ? `${a.correct ? '✓' : '✗'} declared ${FAULTS[a.hyp!.fault].name} @ ${a.hyp!.service}${a.correct ? '' : ` (+${WRONG_PENALTY}s)`}`
                  : `${CHANNEL_ICON[describeQuery(a.key!).channel]} ${a.key}${isKey(a.key!) ? ' ⭐' : ''}`}
              </li>
            ))}
            {!result.actions.length && <li className="muted">no actions</li>}
          </ol>
        </section>
        <section className="card">
          <h3>AI investigation</h3>
          <ol className="timeline">
            {ai.actions.map((a, i) => (
              <li key={i} className={a.kind === 'declare' ? (a.correct ? 'good' : 'bad') : isKey(a.key) ? 'key' : ''}>
                <time>{fmt(a.wall + ai.actions.slice(0, i).reduce((sum, x) => sum + x.cost, 0))}</time>
                {a.kind === 'declare'
                  ? `${a.correct ? '✓' : '✗'} declared ${FAULTS[a.hyp.fault].name} @ ${a.hyp.service} (${Math.round(a.confidence * 100)}% sure)`
                  : `${CHANNEL_ICON[describeQuery(a.key).channel]} ${a.key}${isKey(a.key) ? ' ⭐' : ''}  → ${Math.round(a.confidence * 100)}% sure`}
              </li>
            ))}
          </ol>
          <p className="hint">
            The AI picks the query with the most expected information per second it costs, and declares once it's confident enough.
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
          {setup.daily ? (
            <p>Daily incidents use a fixed AI so everyone races the same opponent. Your skill profile still updated.</p>
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
                Next incident →
              </button>
            )}
            <button onClick={onHome}>Home</button>
          </div>
        </section>
      </div>
    </div>
  );
}
