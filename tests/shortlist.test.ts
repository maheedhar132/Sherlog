import { describe, expect, it } from 'vitest';
import { shortlist } from '../src/game/shortlist';
import { generateIncident } from '../src/sim/incident';
import type { QueryKey } from '../src/sim/types';

const openAll = (service: string): Set<QueryKey> => new Set<QueryKey>([`metrics:${service}`, `logs:${service}`, `traces:${service}`]);

describe('fault shortlist', () => {
  it('is empty until something has been opened on the service', () => {
    const inc = generateIncident({ seed: 3, mode: 'normal' });
    expect(shortlist(inc, inc.truth.service, new Set())).toEqual([]);
    expect(shortlist(inc, inc.truth.service, new Set<QueryKey>(['deploys']))).toEqual([]);
  });

  it('usually contains the real fault once the culprit is fully inspected', () => {
    let hit = 0;
    const n = 120;
    for (let seed = 1; seed <= n; seed++) {
      const inc = generateIncident({ seed, mode: 'normal' });
      if (shortlist(inc, inc.truth.service, openAll(inc.truth.service)).includes(inc.truth.fault)) hit++;
    }
    expect(hit / n).toBeGreaterThan(0.85);
  });

  it('is not simply the answer: it lists several candidates on a healthy service', () => {
    const inc = generateIncident({ seed: 8, mode: 'normal' });
    const other = inc.topology.services.find((s) => s.id !== inc.truth.service && s.kind === 'app')!;
    expect(shortlist(inc, other.id, openAll(other.id)).length).toBeLessThanOrEqual(3);
  });
});
