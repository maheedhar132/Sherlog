import { useEffect, useMemo, useRef, useState } from 'react';
import { aiStateAt } from '../ai/investigator';
import { fmt, type MatchResult, type MatchSetup, type PlayerAction } from '../game/session';
import { COST, WRONG_PENALTY } from '../sim/constants';
import { detectAlerts, detectMetrics } from '../sim/detect';
import { FAULTS, FAULT_IDS, isCompatible } from '../sim/faults';
import { queryCost, sameHypothesis } from '../sim/incident';
import type { FaultId, QueryKey } from '../sim/types';
import { CHANNEL_ICON, KIND_LABEL, describeQuery } from './labels';
import { DeploysPanel, LogsPanel, MetricsPanel, TracePanel } from './Panels';
import { ServiceMap } from './ServiceMap';

type Tab = 'metrics' | 'logs' | 'traces' | 'deploys';

interface Props {
  setup: MatchSetup;
  onFinish: (r: MatchResult) => void;
  onOpenGuide: () => void;
}

export function Match({ setup, onFinish, onOpenGuide }: Props) {
  const { incident, ai } = setup;
  const t = incident.topology;
  const startRef = useRef(performance.now());
  const [wall, setWall] = useState(0);
  const [extra, setExtra] = useState(0);
  const [queried, setQueried] = useState<Set<QueryKey>>(new Set());
  const [actions, setActions] = useState<PlayerAction[]>([]);
  const [selected, setSelected] = useState(t.services[0].id);
  const [tab, setTab] = useState<Tab>('metrics');
  const [phase, setPhase] = useState<'running' | 'lost' | 'practice'>('running');
  const [declService, setDeclService] = useState(t.services[0].id);
  const [declFault, setDeclFault] = useState<FaultId>(FAULT_IDS[0]);
  // The first service is always the gateway, where no fault originates; picking a service fixes this.
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setWall((performance.now() - startRef.current) / 1000), 200);
    return () => clearInterval(id);
  }, []);

  const clock = wall + extra;
  const aiNow = aiStateAt(ai, wall);
  const alerts = useMemo(() => detectAlerts(incident), [incident]);
  const pageSummary = useMemo(
    () =>
      [...alerts].map((id) => {
        const m = detectMetrics(incident.data.metrics[id]);
        const what = [m.has('lat_up') && 'latency', m.has('err_up') && 'errors', m.has('nodata') && 'no data'].filter(Boolean).join(' + ');
        return `${id} (${what})`;
      }),
    [alerts, incident],
  );

  useEffect(() => {
    if (phase === 'running' && aiNow.finished && clock > ai.mttr) setPhase('lost');
  }, [phase, aiNow.finished, clock, ai.mttr]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(id);
  }, [toast]);

  // Only offer faults that can physically happen on that kind of service (the AI's hypothesis space is the same).
  const validFaults = (id: string) => FAULT_IDS.filter((f) => isCompatible(t, id, f));
  const pickDeclService = (id: string) => {
    setDeclService(id);
    const valid = validFaults(id);
    if (valid.length && !valid.includes(declFault)) setDeclFault(valid[0]);
  };

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
    const hyp = { service: declService, fault: declFault };
    const correct = sameHypothesis(hyp, incident.truth);
    const action: PlayerAction = { kind: 'declare', hyp, correct, clock, cost: correct ? 0 : WRONG_PENALTY };
    const all = [...actions, action];
    setActions(all);
    if (!correct) {
      setExtra((e) => e + WRONG_PENALTY);
      setToast(`✗ Not it: ${FAULTS[declFault].name} on ${declService}. +${WRONG_PENALTY}s`);
      return;
    }
    const won = phase === 'running' && clock < ai.mttr;
    onFinish({ won, playerMttr: clock, aiMttr: ai.mttr, actions: all });
  };

  const giveUp = () => onFinish({ won: false, playerMttr: null, aiMttr: ai.mttr, actions });

  const svc = t.byId[selected];
  const aiFeed = [...aiNow.visible].reverse();
  const aiConfidence = aiNow.visible.length ? aiNow.visible[aiNow.visible.length - 1].confidence : 0;
  const masked = (s: string) => '▒'.repeat(Math.min(12, s.length));

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
            {setup.daily ? `DAILY #${setup.daily.number}` : `INC-${String(incident.seed).slice(-5)}`} · {setup.mode.toUpperCase()}
          </div>
          <div className="paging">🔔 Paging: {pageSummary.join(', ') || 'customer complaints, no alerts firing'}</div>
        </div>
        <div className={`clock ai ${aiNow.finished ? 'done' : ''}`}>
          <span>AI</span>
          <b>{fmt(aiNow.clock)}</b>
          <small>{aiNow.finished ? 'resolved ✓' : `confidence ${Math.round(aiConfidence * 100)}%`}</small>
        </div>
      </header>

      <div className="match-grid">
        <aside className="col-left">
          <section className="card">
            <h3>Service map</h3>
            <ServiceMap topology={t} alerts={alerts} selected={selected} queried={queried} onSelect={select} />
            <p className="hint">Red = paging. Click a service to investigate it. Letters show what you pulled (M/L/T).</p>
          </section>
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
              <select value={declFault} onChange={(e) => setDeclFault(e.target.value as FaultId)}>
                {validFaults(declService).map((f) => (
                  <option key={f} value={f}>
                    {FAULTS[f].name}
                  </option>
                ))}
                {!validFaults(declService).length && <option>(the edge only relays errors)</option>}
              </select>
            </label>
            <button className="primary" onClick={declare} disabled={!validFaults(declService).includes(declFault)}>
              Declare
            </button>
            <p className="hint">Wrong answer = +{WRONG_PENALTY}s. Name the cause, not the victim.</p>
          </section>
        </aside>

        <main className="col-center card">
          <div className="inspector-head">
            <h2>
              {tab === 'deploys' ? 'Change log' : svc.id} {tab !== 'deploys' && <span className="kind">{KIND_LABEL[svc.kind]}</span>}
            </h2>
            <nav className="tabs">
              {(['metrics', 'logs', 'traces', 'deploys'] as Tab[]).map((tb) => (
                <button key={tb} className={`${tab === tb ? 'active' : ''} ${queried.has(keyFor(tb)) ? 'seen' : ''}`} onClick={() => setTab(tb)}>
                  {CHANNEL_ICON[tb]} {tb}
                </button>
              ))}
            </nav>
          </div>
          {!queried.has(currentKey) ? (
            <div className="query-cta">
              <p>
                {tab === 'deploys'
                  ? 'Pull the deploy history for every service.'
                  : `Pull ${tab} for ${svc.id}.`}{' '}
                Costs <b>{COST[tab]}s</b> of investigation time.
              </p>
              <button className="primary big" onClick={() => runQuery(currentKey)}>
                {CHANNEL_ICON[tab]} Run query · +{COST[tab]}s
              </button>
            </div>
          ) : tab === 'metrics' ? (
            <MetricsPanel series={incident.data.metrics[selected]} />
          ) : tab === 'logs' ? (
            <LogsPanel lines={incident.data.logs[selected]} />
          ) : tab === 'traces' ? (
            <TracePanel root={incident.data.traces[selected]} />
          ) : (
            <DeploysPanel events={incident.data.deploys} />
          )}
        </main>

        <aside className="col-right">
          <section className="card feed">
            <h3>🤖 AI investigator</h3>
            <div className="confidence">
              <div style={{ width: `${Math.round((aiNow.finished ? 1 : aiConfidence) * 100)}%` }} />
            </div>
            <ol>
              {aiFeed.map((a, i) => {
                if (a.kind === 'declare')
                  return (
                    <li key={i} className={a.correct ? 'good' : 'bad'}>
                      {a.correct ? `✓ resolved · MTTR ${fmt(ai.mttr)}` : `✗ wrong guess (+${WRONG_PENALTY}s)`}
                    </li>
                  );
                const q = describeQuery(a.key);
                return (
                  <li key={i}>
                    {CHANNEL_ICON[q.channel]} pulled {q.channel}
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
                <li key={i} className={a.kind === 'declare' ? (a.correct ? 'good' : 'bad') : ''}>
                  <time>{fmt(a.clock)}</time>{' '}
                  {a.kind === 'declare'
                    ? `${a.correct ? '✓' : '✗'} ${FAULTS[a.hyp!.fault].name} @ ${a.hyp!.service}`
                    : `${CHANNEL_ICON[describeQuery(a.key!).channel]} ${a.key}`}
                </li>
              ))}
              {!actions.length && <li className="muted">nothing yet: start with the paging services</li>}
            </ol>
          </section>
          <div className="row-buttons">
            <button onClick={onOpenGuide}>📘 Field guide</button>
            <button onClick={giveUp}>Give up</button>
          </div>
        </aside>
      </div>

      {toast && <div className="toast">{toast}</div>}

      {phase === 'lost' && (
        <div className="overlay">
          <div className="modal">
            <h2>🤖 The AI resolved it first</h2>
            <p>
              AI MTTR <b>{fmt(ai.mttr)}</b>, and your clock is already past that. You can keep investigating unranked, or go
              straight to the postmortem.
            </p>
            <div className="row-buttons">
              <button className="primary" onClick={() => setPhase('practice')}>
                Keep investigating
              </button>
              <button onClick={giveUp}>Show postmortem</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
