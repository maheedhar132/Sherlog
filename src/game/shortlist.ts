import { observe } from '../sim/detect';
import { faultEffects } from '../sim/effects';
import { FAULT_IDS, isCompatible } from '../sim/faults';
import type { FaultId, Incident, QueryKey } from '../sim/types';

/**
 * Faults that fit a service, ranked by how well each one explains what the player has opened on it.
 * It only reads dashboards the player paid for, never the hidden cause. Empty when nothing has been opened there yet.
 */
export function shortlist(incident: Incident, service: string, queried: Set<QueryKey>, limit = 3): FaultId[] {
  const seen = new Set<string>();
  for (const key of queried) if (key !== 'deploys' && key.endsWith(`:${service}`)) for (const f of observe(incident, key)) seen.add(f);
  if (!seen.size) return [];
  const scored = FAULT_IDS.filter((f) => isCompatible(incident.topology, service, f)).map((fault) => {
    const fx = faultEffects(incident.topology, { service, fault }).services[service];
    const expected = new Set([...fx.metrics, ...fx.logs, ...fx.traces]);
    let matched = 0;
    for (const f of seen) if (expected.has(f)) matched++;
    return { fault, score: matched - 0.3 * (seen.size - matched) };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.fault);
}
