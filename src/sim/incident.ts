import { mulberry32, pick } from '../lib/rng';
import { COST } from './constants';
import { addHerrings, dropOneSignal, faultEffects } from './effects';
import { FAULT_IDS, isCompatible } from './faults';
import { renderAll } from './render';
import { generateTopology } from './topology';
import type { FaultId, Hypothesis, Incident, Mode, QueryKey, Topology } from './types';

export interface IncidentOptions {
  seed: number;
  mode: Mode;
  /** Force a fault type (used by the adaptive scenario picker); otherwise chosen from the seed. */
  fault?: FaultId;
}

export function hypotheses(t: Topology): Hypothesis[] {
  const out: Hypothesis[] = [];
  for (const s of t.services) for (const f of FAULT_IDS) if (isCompatible(t, s.id, f)) out.push({ service: s.id, fault: f });
  return out;
}

export function generateIncident({ seed, mode, fault }: IncidentOptions): Incident {
  const rng = mulberry32(seed);
  const topology = generateTopology(rng, mode);
  const wanted = fault ?? pick(rng, FAULT_IDS);
  let targets = topology.services.filter((s) => isCompatible(topology, s.id, wanted));
  let chosen = wanted;
  if (!targets.length) {
    // The generator guarantees targets for every fault, but stay safe.
    chosen = FAULT_IDS.find((f) => topology.services.some((s) => isCompatible(topology, s.id, f)))!;
    targets = topology.services.filter((s) => isCompatible(topology, s.id, chosen));
  }
  const truth: Hypothesis = { service: pick(rng, targets).id, fault: chosen };
  const fx = faultEffects(topology, truth);
  const herrings = addHerrings(topology, fx, truth, mode, rng);
  if (mode === 'hard') dropOneSignal(fx, truth, rng);
  const data = renderAll(rng, topology, fx);
  return { seed, mode, topology, truth, fx, herrings, data };
}

export function queryKeys(t: Topology): QueryKey[] {
  const keys: QueryKey[] = ['deploys'];
  for (const s of t.services) keys.push(`metrics:${s.id}`, `logs:${s.id}`, `traces:${s.id}`);
  return keys;
}

export function queryCost(key: QueryKey): number {
  return key === 'deploys' ? COST.deploys : COST[key.split(':')[0] as 'metrics' | 'logs' | 'traces'];
}

export const sameHypothesis = (a: Hypothesis, b: Hypothesis) => a.service === b.service && a.fault === b.fault;
