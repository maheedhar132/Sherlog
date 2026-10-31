import { mulberry32, type Rng } from '../lib/rng';
import { WRONG_PENALTY } from '../sim/constants';
import { detectAlerts, observe, pagingServices } from '../sim/detect';
import { faultEffects } from '../sim/effects';
import { hypotheses, queryCost, queryKeys, sameHypothesis } from '../sim/incident';
import type { Fx, Hypothesis, Incident, QueryKey } from '../sim/types';

/**
 * The AI opponent: a Bayesian investigator.
 *
 * It holds a probability for every (service, fault) hypothesis, picks the query with the best
 * expected information gain per second of cost, and declares once it is confident enough.
 * It reads the same dashboards as the player through `observe`; it never sees `incident.truth`.
 */

const MISS = 0.1; // P(symptom not seen | hypothesis predicts it)
const FALSE_ALARM = 0.15; // P(symptom seen | hypothesis does not predict it): red herrings

const L_HIT = Math.log(1 - MISS);
const L_MISS = Math.log(MISS);
const L_FA = Math.log(FALSE_ALARM);
const L_QUIET = Math.log(1 - FALSE_ALARM);

/** Log-likelihood of an observation given a prediction, up to a constant shared by all hypotheses. */
function logLik(obs: Set<string>, pred: Set<string>): number {
  let ll = 0;
  for (const f of pred) ll += obs.has(f) ? L_HIT : L_MISS;
  for (const f of obs) if (!pred.has(f)) ll += L_FA;
  // Features in neither set contribute L_QUIET; normalise so only the union matters.
  const union = new Set([...obs, ...pred]).size;
  return ll - union * L_QUIET;
}

function predicted(fx: Fx, key: QueryKey | 'alerts', paging: string[]): Set<string> {
  if (key === 'alerts') {
    const out = new Set<string>();
    for (const id of paging) {
      const m = fx.services[id].metrics;
      if (m.has('lat_up') || m.has('err_up') || m.has('nodata')) out.add(id);
    }
    return out;
  }
  if (key === 'deploys') return new Set([...fx.deploys].map((s) => `dep:${s}`));
  const [channel, service] = key.split(':') as ['metrics' | 'logs' | 'traces', string];
  return fx.services[service][channel];
}

const entropy = (p: number[]) => -p.reduce((a, x) => (x > 0 ? a + x * Math.log(x) : a), 0);

function normalise(logp: number[]): number[] {
  const max = Math.max(...logp);
  const e = logp.map((l) => (Number.isFinite(l) ? Math.exp(l - max) : 0));
  const z = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / z);
}

export interface AiParams {
  /** Softmax temperature over query scores: high = sloppy query choice. */
  temperature: number;
  /** Posterior needed before declaring: low = rash guesses. */
  threshold: number;
  /** Mean seconds of "thinking" per action. */
  thinkSeconds: number;
  /** Chance of a completely unfocused query. */
  randomQuery: number;
}

/** Strength 0..1 is reasoning quality; above 1 the reasoning is already optimal and only speed keeps rising. */
export const MAX_STRENGTH = 1.25;

/** Strength maps to every knob at once, so the adapter only has one dial to turn. */
export function aiParams(strength: number): AiParams {
  const s = Math.max(0, Math.min(1, strength));
  return {
    temperature: 0.03 + 0.5 * (1 - s),
    threshold: 0.75 + 0.22 * s,
    thinkSeconds: Math.max(2.5, 60 - 45 * Math.min(strength, MAX_STRENGTH)),
    randomQuery: 0.35 * (1 - s),
  };
}

export class Investigator {
  readonly hyps: Hypothesis[];
  private readonly fxs: Fx[];
  private logp: number[];
  private readonly done = new Set<QueryKey>();
  private readonly allKeys: QueryKey[];
  private readonly paging: string[];

  constructor(private readonly inc: Incident) {
    this.hyps = hypotheses(inc.topology);
    this.fxs = this.hyps.map((h) => faultEffects(inc.topology, h));
    this.logp = this.hyps.map(() => 0);
    this.allKeys = queryKeys(inc.topology);
    this.paging = pagingServices(inc.topology);
    this.update('alerts', detectAlerts(inc));
  }

  posterior(): number[] {
    return normalise(this.logp);
  }

  best(): { hyp: Hypothesis; p: number } {
    const p = this.posterior();
    let i = 0;
    for (let j = 1; j < p.length; j++) if (p[j] > p[i]) i = j;
    return { hyp: this.hyps[i], p: p[i] };
  }

  remaining(): QueryKey[] {
    return this.allKeys.filter((k) => !this.done.has(k));
  }

  update(key: QueryKey | 'alerts', obs: Set<string>): void {
    if (key !== 'alerts') this.done.add(key);
    this.logp = this.logp.map((l, i) => l + logLik(obs, predicted(this.fxs[i], key, this.paging)));
  }

  eliminate(h: Hypothesis): void {
    this.logp = this.logp.map((l, i) => (sameHypothesis(this.hyps[i], h) ? -Infinity : l));
  }

  /** Expected drop in entropy from running `key`, assuming the observation matches some hypothesis's prediction. */
  infoGain(key: QueryKey, p = this.posterior()): number {
    const preds = this.fxs.map((fx) => predicted(fx, key, this.paging));
    const h0 = entropy(p);
    let expected = 0;
    for (let i = 0; i < p.length; i++) {
      if (p[i] < 1e-4) continue;
      const post = normalise(this.logp.map((l, j) => l + logLik(preds[i], preds[j])));
      expected += p[i] * entropy(post);
    }
    const mass = p.reduce((a, x, i) => (x >= 1e-4 ? a + p[i] : a), 0);
    return h0 - expected / mass;
  }

  chooseQuery(params: AiParams, rng: Rng): QueryKey {
    const keys = this.remaining();
    if (rng() < params.randomQuery) return keys[Math.floor(rng() * keys.length)];
    const p = this.posterior();
    const scores = keys.map((k) => Math.max(0, this.infoGain(k, p)) / queryCost(k));
    const top = Math.max(...scores, 1e-9);
    const w = scores.map((s) => Math.exp((s / top - 1) / params.temperature));
    let r = rng() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < keys.length; i++) {
      r -= w[i];
      if (r <= 0) return keys[i];
    }
    return keys[keys.length - 1];
  }

  observe(key: QueryKey): Set<string> {
    const obs = observe(this.inc, key);
    this.update(key, obs);
    return obs;
  }
}

export type AiAction =
  | { kind: 'query'; key: QueryKey; wall: number; cost: number; confidence: number }
  | { kind: 'declare'; hyp: Hypothesis; correct: boolean; wall: number; cost: number; confidence: number };

export interface AiRun {
  strength: number;
  actions: AiAction[];
  /** Real seconds after the start at which the AI solves it. */
  wallEnd: number;
  /** Its final incident clock: thinking time + query costs + wrong-answer penalties. */
  mttr: number;
}

/**
 * The AI never depends on what the player does, so its whole race is simulated up front and
 * replayed against the wall clock. That keeps it deterministic and lets the postmortem show every step.
 */
export function simulateAi(inc: Incident, strength: number, seed = inc.seed): AiRun {
  const params = aiParams(strength);
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const ai = new Investigator(inc);
  const actions: AiAction[] = [];
  let wall = 0;
  let extra = 0;
  const think = () => params.thinkSeconds * (0.7 + 0.6 * rng());

  for (let step = 0; step < 80; step++) {
    const { hyp, p } = ai.best();
    if (p >= params.threshold || ai.remaining().length === 0) {
      wall += think() * 0.5;
      const correct = sameHypothesis(hyp, inc.truth);
      const cost = correct ? 0 : WRONG_PENALTY;
      extra += cost;
      actions.push({ kind: 'declare', hyp, correct, wall, cost, confidence: p });
      if (correct) break;
      ai.eliminate(hyp);
      continue;
    }
    const key = ai.chooseQuery(params, rng);
    wall += think();
    const cost = queryCost(key);
    extra += cost;
    ai.observe(key);
    actions.push({ kind: 'query', key, wall, cost, confidence: ai.best().p });
  }
  return { strength, actions, wallEnd: wall, mttr: wall + extra };
}

/** What the AI has done by `wall` seconds, and its clock at that moment. */
export function aiStateAt(run: AiRun, wall: number) {
  const visible = run.actions.filter((a) => a.wall <= wall);
  const finished = wall >= run.wallEnd;
  const clock = finished ? run.mttr : wall + visible.reduce((a, x) => a + x.cost, 0);
  return { visible, finished, clock };
}
