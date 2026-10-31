import { useEffect, useMemo, useRef, useState } from 'react';
import { aiStateAt } from '../ai/investigator';
import { fmt, type MatchResult, type MatchSetup, type PlayerAction } from '../game/session';
import { loadCoachPref, saveCoachPref } from '../lib/storage';
import { COST, WRONG_PENALTY, wrongPenalty } from '../sim/constants';
import { detectAlerts, observe } from '../sim/detect';
import { shortlist } from '../game/shortlist';
import { RECOVERY_MS, Recovery, type RecoveryKind } from './Recovery';
import { FAULTS, FAULT_IDS, isCompatible } from '../sim/faults';
import { FIXES, FIX_FOR, STOPGAP_FOR, fixOptions, type FixId } from '../sim/fixes';
import { queryCost, sameHypothesis } from '../sim/incident';
import { ERROR_BUDGET_SECONDS, pages } from '../sim/slo';
import type { FaultId, QueryKey, ServiceKind } from '../sim/types';
import { CHANNEL_ICON, KIND_LABEL, describeQuery } from './labels';
import { Modal } from './Modal';
import { DeploysPanel, LogsPanel, MetricsPanel, TracePanel } from './Panels';
import { ServiceChips, ServiceMap } from './ServiceMap';
import { FEATURE_TIPS } from './tips';

type Tab = 'metrics' | 'logs' | 'traces' | 'deploys';

const TAB_KEYS: Record<string, Tab> = { m: 'metrics', l: 'logs', t: 'traces', d: 'deploys' };
const HINT_COST = 15;
/** A stopgap fix buys time without curing the cause, so it costs less than a plain wrong fix. */
const STOPGAP_PENALTY = 10;
const KIND_WORD: Record<ServiceKind, string> = {
  gateway: 'the gateway',
  app: 'an application service',
  db: 'a database',
  cache: 'a cache',
  queue: 'the queue',
  worker: 'a background worker',
  external: 'a third-party API',
};

interface Props {
  setup: MatchSetup;
  /** Whether the coach starts on (new players and Easy), unless the player already chose. */
  coachDefault: boolean;
  onFinish: (r: MatchResult) => void;
  onOpenGuide: () => void;
}

export function Match({ setup, coachDefault, onFinish, onOpenGuide }: Props) {
  const { incident, ai } = setup;
  const t = incident.topology;
  const truth = incident.truth;
  const startRef = useRef(performance.now());
  const [wall, setWall] = useState(0);
  const [extra, setExtra] = useState(0);
  const [queried, setQueried] = useState<Set<QueryKey>>(new Set());
  const [actions, setActions] = useState<PlayerAction[]>([]);
  const [selected, setSelected] = useState(t.services[0].id);
  const [tab, setTab] = useState<Tab>('metrics');
  const [phase, setPhase] = useState<'running' | 'lost' | 'practice'>('running');
  const [declService, setDeclService] = useState(t.services[0].id);
  // Starts on the gateway, where no fault originates, so Declare stays disabled until a service is picked.
  const [declFault, setDeclFault] = useState<FaultId | ''>('');
  const breachedRef = useRef(false);
  const [wrongNote, setWrongNote] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<RecoveryKind | null>(null);
  const recoveryTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(recoveryTimer.current), []);
  const [toast, setToast] = useState<string | null>(null);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [mitigating, setMitigating] = useState(false);
  const [badFixes, setBadFixes] = useState<FixId[]>([]);
  const [hints, setHints] = useState(0);
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  // No runbook on Hard, so no coach there either.
  const [coachOn, setCoachOn] = useState(() => !!setup.tutorial || (setup.mode !== 'hard' && (loadCoachPref() ?? coachDefault)));

  useEffect(() => {
    const id = setInterval(() => setWall((performance.now() - startRef.current) / 1000), 200);
    return () => clearInterval(id);
  }, []);

  const clock = wall + extra;
  const misses = actions.filter((a) => a.kind === 'declare' && !a.correct).length;
  const nextPenalty = wrongPenalty(misses + 1);
  const nextFixPenalty = wrongPenalty(badFixes.length + 1);
  const aiNow = aiStateAt(ai, wall);
  const alerts = useMemo(() => detectAlerts(incident), [incident]);
  const pageLines = useMemo(
    () => [...pages(incident, alerts), ...incident.noise.map((text) => ({ service: text, text }))],
    [incident, alerts],
  );
  const options = useMemo(() => fixOptions(incident.seed, truth.fault), [incident, truth.fault]);

  useEffect(() => {
    if (phase === 'running' && !mitigating && !setup.tutorial && aiNow.finished && clock > ai.mttr) setPhase('lost');
  }, [phase, mitigating, setup.tutorial, aiNow.finished, clock, ai.mttr]);

  useEffect(() => {
    if (clock >= ERROR_BUDGET_SECONDS && !breachedRef.current) {
      breachedRef.current = true;
      setToast('🔥 SLO error budget exhausted: the incident is now a breach');
    }
  }, [clock]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(id);
  }, [toast]);

  // Only offer faults that can physically happen on that kind of service (the AI's hypothesis space is the same).
  const validFaults = (id: string) => FAULT_IDS.filter((f) => isCompatible(t, id, f));
  // A shortlist of faults that explain what you have opened on this service (no aids on Hard).
  const likely = setup.mode === 'hard' && !setup.tutorial ? [] : shortlist(incident, declService, queried);
  const pickDeclService = (id: string) => setDeclService(id);

  const select = (id: string) => {
    setSelected(id);
    pickDeclService(id);
    if (tab === 'deploys') setTab('metrics');
  };

  const keyFor = (tb: Tab): QueryKey => (tb === 'deploys' ? 'deploys' : `${tb}:${selected}`);
  const currentKey = keyFor(tab);

  const runQuery = (key: QueryKey) => {
    if (queried.has(key)) return;
    const cost = queryCost(key);
    setQueried((q) => new Set(q).add(key));
    setActions((a) => [...a, { kind: 'query', key, clock, cost }]);
    setExtra((e) => e + cost);
  };

  const declare = () => {
    if (!declFault) return;
    const hyp = { service: declService, fault: declFault };
    const correct = sameHypothesis(hyp, truth);
    const penalty = correct ? 0 : nextPenalty;
    setActions([...actions, { kind: 'declare', hyp, correct, clock, cost: penalty }]);
    if (!correct) {
      setExtra((e) => e + penalty);
      setToast(`✗ Not it: ${FAULTS[declFault].name} on ${declService}. +${penalty}s`);
      setWrongNote(`Not ${FAULTS[declFault].name} on ${declService}. Compare that service's own signals with what it depends on.`);
      return;
    }
    // Diagnosis is not the end of the incident: now stop the bleeding.
    setMitigating(true);
  };

  const chooseFix = (fix: FixId) => {
    const correct = fix === (FIX_FOR[truth.fault]?.fix ?? 'restart');
    const partial = !correct && fix === STOPGAP_FOR[truth.fault]?.fix;
    const penalty = correct ? 0 : partial ? STOPGAP_PENALTY : nextFixPenalty;
    const all = [...actions, { kind: 'fix' as const, fix, correct, partial, clock, cost: penalty }];
    setActions(all);
    // Show the service responding to the fix before moving on.
    setRecovery(correct ? 'fixed' : partial ? 'stopgap' : 'wrong');
    const result = { won: phase === 'running' && clock < ai.mttr, playerMttr: clock, aiMttr: ai.mttr, actions: all, breached: clock >= ERROR_BUDGET_SECONDS };
    recoveryTimer.current = setTimeout(() => {
      setRecovery(null);
      if (correct) onFinish(result);
    }, RECOVERY_MS);
    if (!correct) {
      setBadFixes((b) => [...b, fix]);
      setExtra((e) => e + penalty);
      setToast(partial ? `🩹 Errors dip, then climb back: that only treats the symptom. +${penalty}s` : `✗ That does not stop it. +${penalty}s`);
    }
  };

  const giveUp = () => onFinish({ won: false, playerMttr: null, aiMttr: ai.mttr, actions });

  const useHint = () => {
    if (hints >= 3) return;
    const cost = setup.tutorial ? 0 : HINT_COST;
    setHints((h) => h + 1);
    setExtra((e) => e + cost);
    setActions((a) => [...a, { kind: 'hint', clock, cost }]);
  };
  const hintTexts = [
    `The culprit is ${KIND_WORD[t.byId[truth.service].kind]}.`,
    `Look at ${truth.service}.`,
    `The fault is: ${FAULTS[truth.fault].name}.`,
  ].slice(0, hints);

  // Keyboard shortcuts, off while a dialog is open or a form field has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[role="dialog"]')) return;
      if ((e.target as HTMLElement).closest('input, select, textarea')) return;
      const k = e.key.toLowerCase();
      if (TAB_KEYS[k]) setTab(TAB_KEYS[k]);
      else if (k === 'r') runQuery(currentKey);
      else if (k === 'e') setMapExpanded(true);
      else if (k === 'h') useHint();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The coach reads only what the player has already opened.
  const services = new Set([...queried].map((k) => describeQuery(k).service).filter(Boolean));
  const lastQuery = [...actions].reverse().find((a) => a.kind === 'query');
  const tips = useMemo(() => {
    if (!lastQuery?.key) return [];
    const found = [...observe(incident, lastQuery.key)].map((f) => FEATURE_TIPS[f.split(':')[0] === 'dep' || f.split(':')[0] === 'cfg' ? f.split(':')[0] : f]);
    return [...new Set(found.filter(Boolean))].slice(0, 3);
  }, [lastQuery?.key, incident]);
  const nudge = mitigating
    ? 'You found it. Now pick the fix that stops the bleeding.'
    : queried.size === 0
      ? 'Start with a paging service: click it on the map, then pull its metrics.'
      : services.size < 2
        ? 'That service may only be a victim. Click something it depends on and compare.'
        : tips.length === 0
          ? 'Nothing odd there: rule it out and look somewhere else.'
          : 'Found a tell-tale sign? Confirm it in another dashboard, then declare.';

  const steps: [string, boolean][] = [
    ['Read the page: the red services are alerting.', true],
    ['Pull a dashboard. Every one costs time.', queried.size > 0],
    ['Pull a dashboard for a second service: click it on the map first.', services.size >= 2],
    ['Find the odd one out: whose own numbers look wrong, not just slow?', services.has(truth.service)],
    ['Declare the service and the fault.', actions.some((a) => a.kind === 'declare' && a.correct)],
    ['Choose the fix that stops the bleeding.', false],
  ];
  const nextStep = steps.findIndex(([, done]) => !done);

  const svc = t.byId[selected];
  const aiFeed = [...aiNow.visible].reverse();
  const aiConfidence = aiNow.visible.length ? aiNow.visible[aiNow.visible.length - 1].confidence : 0;
  const masked = (s: string) => '▒'.repeat(Math.min(12, s.length));

  // The race: where each side is between "paged" and "mitigated".
  const aiQueries = aiNow.visible.filter((a) => a.kind === 'query').length;
  const aiProgress = aiNow.visible.some((a) => a.kind === 'fix')
    ? 1
    : aiNow.visible.some((a) => a.kind === 'declare' && a.correct)
      ? 0.75
      : aiQueries
        ? 0.25 + Math.min(0.4, aiQueries * 0.06)
        : 0.1;
  const youProgress = mitigating ? 0.75 : queried.size ? 0.25 + Math.min(0.4, queried.size * 0.06) : 0.1;
  const budgetUsed = Math.min(1, clock / ERROR_BUDGET_SECONDS);
  const nextAi = ai.actions.find((a) => a.wall > wall);
  // The rival closing in: no conclusions are shown, only how little time is left to beat it.
  const aiDiagnosed = aiNow.visible.some((a) => a.kind === 'declare' && a.correct);
  const rivalAlert =
    phase === 'running' && !setup.tutorial && !aiNow.finished
      ? aiDiagnosed
        ? `🤖 The AI has found the cause and is applying the fix: about ${Math.max(1, Math.ceil(ai.wallEnd - wall))}s left to beat it`
        : nextAi?.kind === 'declare' && nextAi.wall - wall <= 12
          ? '🤖 The AI is about to commit to a diagnosis'
          : null
      : null;
  const aiEta = !aiNow.finished && nextAi ? Math.max(1, Math.ceil(nextAi.wall - wall)) : null;
  // No runbook on Hard: the field guide lists every signal and fix.
  const guideLocked = setup.mode === 'hard' && !setup.tutorial;
  const markers = incident.data.deploys
    .filter((e) => e.service === selected)
    .map((e) => ({ t: e.t, label: `${e.kind === 'config' ? 'Config change' : 'Deploy'}: ${e.version} by ${e.author}` }));
  const toggleCoach = () =>
    setCoachOn((on) => {
      saveCoachPref(!on);
      return !on;
    });

  return (
    <div className="match">
      <header className="race-bar">
        <div className="clock you">
          <span>YOU</span>
          <b>{fmt(clock)}</b>
          <small>{phase === 'practice' ? 'practice' : `${queried.size} queries`}</small>
        </div>
        <div className="incident-title">
          <div className="inc-id">
            {setup.tutorial ? 'TRAINING' : setup.wave ? `AFTERSHOCK · INC-${incident.seed}` : setup.shift ? `SHIFT ${setup.shift.n}/${setup.shift.of} · INC-${incident.seed}` : setup.daily ? `DAILY #${setup.daily.number}` : `INC-${incident.seed}`} · {setup.mode.toUpperCase()}
          </div>
          <div className="paging">
            🔔 PAGED 14:02 · {alerts.size ? `${alerts.size} alerting` : 'customers report problems, no alert fired'}
          </div>
          <ul className="page-lines">
            {pageLines.slice(0, 3).map((p) => (
              <li key={p.service}>{p.text}</li>
            ))}
            {pageLines.length > 3 && <li>+{pageLines.length - 3} more</li>}
          </ul>
        </div>
        <div className={`clock ai ${aiNow.finished ? 'done' : ''}`}>
          <span>AI</span>
          <b>{fmt(aiNow.clock)}</b>
          <small>{aiNow.finished ? 'resolved ✓' : `confidence ${Math.round(aiConfidence * 100)}%`}</small>
        </div>
        <div className="race-track" role="img" aria-label={`Race: you are ${Math.round(youProgress * 100)}% of the way, the AI ${Math.round(aiProgress * 100)}%`}>
          <div className="stops" aria-hidden="true">
            <span style={{ left: '10%' }}>Paged</span>
            <span style={{ left: '40%' }}>Investigating</span>
            <span style={{ left: '75%' }}>Diagnosed</span>
            <span style={{ left: '100%' }}>Mitigated</span>
          </div>
          <div className="lane you">
            <div className="fill" style={{ width: `${youProgress * 100}%` }} />
            <b style={{ left: `${youProgress * 100}%` }}>YOU</b>
          </div>
          <div className="lane ai">
            <div className="fill" style={{ width: `${aiProgress * 100}%` }} />
            <b style={{ left: `${aiProgress * 100}%` }}>AI</b>
          </div>
          <div className="budget" title="The SLO error budget burns for as long as the incident runs">
            <div className={budgetUsed > 0.8 ? 'hot' : budgetUsed > 0.5 ? 'warm' : ''} style={{ width: `${budgetUsed * 100}%` }} />
            <span>
              SLO error budget: {Math.round(budgetUsed * 100)}% burned{budgetUsed >= 1 ? ' (exhausted)' : ''}
            </span>
          </div>
        </div>
      </header>
      {rivalAlert && (
        <div className="rival-alert" role="status">
          {rivalAlert}
        </div>
      )}

      <section className="card map-strip">
        <div className="card-head">
          <h3>Service map</h3>
          <span className="hint-inline">Red = paging · click a service to inspect it · letters show what you pulled (M L T)</span>
          <button className="icon-btn" onClick={() => setMapExpanded(true)} aria-label="Expand service map" title="Expand service map (E)">
            ⤢ Expand
          </button>
        </div>
        <ServiceMap topology={t} alerts={alerts} selected={selected} queried={queried} onSelect={select} />
        <ServiceChips topology={t} alerts={alerts} selected={selected} queried={queried} onSelect={select} />
      </section>

      <div className="match-grid">
        <aside className="col-left">
          {setup.tutorial && (
            <section className="card training">
              <h3>Training: your first incident</h3>
              <ol>
                {steps.map(([text, done], i) => (
                  <li key={text} className={done ? 'done' : i === nextStep ? 'now' : ''}>
                    {done ? '✓' : i === nextStep ? '▶' : '○'} {text}
                  </li>
                ))}
              </ol>
            </section>
          )}
          {coachOn && (
            <section className="card coach">
              <div className="card-head">
                <h3>Coach</h3>
                {!setup.tutorial && (
                  <button className="icon-btn" onClick={toggleCoach}>
                    Hide
                  </button>
                )}
              </div>
              <p className="nudge">{nudge}</p>
              {wrongNote && <p className="hint-text">✗ {wrongNote}</p>}
              {tips.length > 0 && (
                <ul className="tips">
                  {tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              )}
              {hintTexts.map((h) => (
                <p key={h} className="hint-text">
                  💡 {h}
                </p>
              ))}
            </section>
          )}
          <section className="card declare">
            <h3>Declare root cause</h3>
            <label>
              Service
              <select value={declService} onChange={(e) => pickDeclService(e.target.value)}>
                {t.services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Fault
              <select value={declFault} onChange={(e) => setDeclFault(e.target.value as FaultId | '')}>
                <option value="">Choose a fault…</option>
                {likely.length > 0 && (
                  <optgroup label="Best match for what you've seen">
                    {likely.map((f) => (
                      <option key={f} value={f}>
                        {FAULTS[f].name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {validFaults(declService).filter((f) => !likely.includes(f)).length > 0 && (
                  <optgroup label="Fits this kind of service">
                    {validFaults(declService).filter((f) => !likely.includes(f)).map((f) => (
                      <option key={f} value={f}>
                        {FAULTS[f].name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Other faults">
                  {FAULT_IDS.filter((f) => !validFaults(declService).includes(f)).map((f) => (
                    <option key={f} value={f}>
                      {FAULTS[f].name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <button className="primary" onClick={declare} disabled={!declFault || t.byId[declService].kind === 'gateway'}>
              Declare
            </button>
            <p className="hint">
              {misses === 0 ? `Wrong answer: +${WRONG_PENALTY}s, and each miss costs ${WRONG_PENALTY}s more.` : `Next wrong answer: +${nextPenalty}s.`} Name the cause,
              not the victim.
            </p>
            <button onClick={useHint} disabled={hints >= 3} title="Hint (H)">
              💡 {hints >= 3 ? 'No more hints' : `Hint (${setup.tutorial ? 'free' : `+${HINT_COST}s`})`}
            </button>
            {!coachOn && setup.mode !== 'hard' && (
              <button className="link-btn" onClick={toggleCoach}>
                Show the coach
              </button>
            )}
          </section>
        </aside>

        <main className="col-center card">
          <div className="inspector-head">
            <h2>
              {tab === 'deploys' ? 'Change log' : svc.id} {tab !== 'deploys' && <span className="kind">{KIND_LABEL[svc.kind]}</span>}
            </h2>
            <nav className="tabs">
              {(['metrics', 'logs', 'traces', 'deploys'] as Tab[]).map((tb) => (
                <button
                  key={tb}
                  title={`${tb === 'deploys' ? 'changes' : tb} (${tb[0].toUpperCase()})`}
                  className={`${tab === tb ? 'active' : ''} ${queried.has(keyFor(tb)) ? 'seen' : ''}`}
                  onClick={() => setTab(tb)}
                >
                  {CHANNEL_ICON[tb]} {tb === 'deploys' ? 'changes' : tb}
                </button>
              ))}
            </nav>
            {!queried.has(currentKey) && (
              <button className="primary run-now" onClick={() => runQuery(currentKey)}>
                Run · +{COST[tab]}s
              </button>
            )}
          </div>
          {!queried.has(currentKey) ? (
            <div className="query-cta">
              <p>
                {tab === 'deploys' ? 'Pull the change history: deploys and config or flag changes.' : `Pull ${tab} for ${svc.id}.`} Costs{' '}
                <b>{COST[tab]}s</b> of investigation time.
              </p>
              <p className="hint">
                Press <b>Run</b> above, or the R key.
              </p>
            </div>
          ) : tab === 'metrics' ? (
            <MetricsPanel series={incident.data.metrics[selected]} markers={markers} />
          ) : tab === 'logs' ? (
            <LogsPanel lines={incident.data.logs[selected]} />
          ) : tab === 'traces' ? (
            <TracePanel root={incident.data.traces[selected]} />
          ) : (
            <DeploysPanel events={incident.data.deploys} />
          )}
          <p className="hint shortcuts">Shortcuts: M L T D switch tabs · R run the query · E expand the map · H hint</p>
        </main>

        <aside className="col-right">
          <section className="card feed">
            <h3>🤖 AI investigator</h3>
            <div className="confidence">
              <div style={{ width: `${Math.round((aiNow.finished ? 1 : aiConfidence) * 100)}%` }} />
            </div>
            {aiEta !== null && <p className="ai-next">⏱ next move in {aiEta}s</p>}
            <ol>
              {aiFeed.map((a, i) => {
                if (a.kind === 'declare')
                  return (
                    <li key={i} className={a.correct ? 'good' : 'bad'}>
                      {a.correct ? '✓ root cause found' : `✗ wrong guess (+${a.cost}s)`}
                    </li>
                  );
                if (a.kind === 'fix')
                  return (
                    <li key={i} className="good">
                      🔧 mitigated · MTTR {fmt(ai.mttr)}
                    </li>
                  );
                const q = describeQuery(a.key);
                return (
                  <li key={i}>
                    {CHANNEL_ICON[q.channel]} pulled {q.channel === 'deploys' ? 'changes' : q.channel}
                    {q.service && <span className="masked"> {masked(q.service)}</span>}
                  </li>
                );
              })}
              {!aiFeed.length && <li className="muted">reading the alerts…</li>}
            </ol>
          </section>
          <section className="card feed">
            <h3>Your trail</h3>
            <ol>
              {[...actions].reverse().map((a, i) => (
                <li key={i} className={a.kind === 'declare' || a.kind === 'fix' ? (a.correct ? 'good' : 'bad') : ''}>
                  <time>{fmt(a.clock)}</time>{' '}
                  {a.kind === 'declare'
                    ? `${a.correct ? '✓' : '✗'} ${FAULTS[a.hyp!.fault].name} @ ${a.hyp!.service}`
                    : a.kind === 'fix'
                      ? `${a.correct ? '🔧 fixed' : '✗ wrong fix'}: ${FIXES[a.fix!]}`
                      : a.kind === 'hint'
                        ? '💡 hint'
                        : `${CHANNEL_ICON[describeQuery(a.key!).channel]} ${a.key}`}
                </li>
              ))}
              {!actions.length && <li className="muted">nothing yet: start with the paging services</li>}
            </ol>
          </section>
          <div className="row-buttons">
            <button onClick={onOpenGuide} disabled={guideLocked} title={guideLocked ? 'No runbook on Hard' : undefined}>
              📘 Field guide{guideLocked ? ' (off in Hard)' : ''}
            </button>
            <button onClick={() => setConfirmGiveUp(true)}>Give up</button>
          </div>
        </aside>
      </div>

      {toast && <div className="toast">{toast}</div>}

      {mapExpanded && (
        <Modal label="Service map" className="map-modal" onClose={() => setMapExpanded(false)}>
          <div className="modal-head">
            <h2>Service map</h2>
            <button onClick={() => setMapExpanded(false)} aria-label="Close">
              ✕
            </button>
          </div>
          <ServiceMap
            topology={t}
            alerts={alerts}
            selected={selected}
            queried={queried}
            expanded
            onSelect={(id) => {
              select(id);
              setMapExpanded(false);
            }}
          />
          <p className="hint">
            Red = paging. Arrows point from caller to dependency. Click a service to inspect it. Letters show what you pulled (M = metrics, L =
            logs, T = traces). Esc to close.
          </p>
        </Modal>
      )}

      {mitigating && (
        <Modal label="Choose the fix" onClose={() => undefined}>
          <h2>🔧 Root cause confirmed</h2>
          <p>
            <b>{FAULTS[truth.fault].name}</b> on <code>{truth.service}</code>. The clock is still running: stop the bleeding.
          </p>
          {recovery ? (
            <Recovery kind={recovery} service={truth.service} />
          ) : (
          <div className="fix-options">
            {options.map((f) => (
              <button key={f} className="fix" onClick={() => chooseFix(f)} disabled={badFixes.includes(f)}>
                {FIXES[f]}
              </button>
            ))}
          </div>
          )}
          <p className="hint">A wrong fix costs +{nextFixPenalty}s, and the next one more. Some fixes only buy a minute: choose the one that removes the cause.</p>
        </Modal>
      )}

      {confirmGiveUp && (
        <Modal label="Give up?" onClose={() => setConfirmGiveUp(false)}>
          <h2>Give up on this incident?</h2>
          <p>{setup.daily ? "This ends today's daily and resets your streak." : 'This ends the incident without a result and goes to the postmortem.'}</p>
          <div className="row-buttons">
            <button className="primary" onClick={() => setConfirmGiveUp(false)}>
              Keep investigating
            </button>
            <button onClick={giveUp}>Give up</button>
          </div>
        </Modal>
      )}

      {phase === 'lost' && (
        <Modal label="The AI resolved it first" onClose={() => setPhase('practice')}>
          <h2>🤖 The AI resolved it first</h2>
          <p>
            AI MTTR <b>{fmt(ai.mttr)}</b>, and your clock is already past that. You can keep investigating unranked, or go straight to the
            postmortem.
          </p>
          <div className="row-buttons">
            <button className="primary" onClick={() => setPhase('practice')}>
              Keep investigating
            </button>
            <button onClick={giveUp}>Show postmortem</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
