import { describe, expect, it } from 'vitest';
import { observe } from '../src/sim/detect';
import { FAULT_IDS } from '../src/sim/faults';
import { generateIncident, queryKeys } from '../src/sim/incident';
import type { Mode } from '../src/sim/types';

const MODES: Mode[] = ['easy', 'normal', 'hard'];

describe('incident generation', () => {
  it('is deterministic for a seed', () => {
    const a = generateIncident({ seed: 1234, mode: 'normal' });
    const b = generateIncident({ seed: 1234, mode: 'normal' });
    expect(JSON.stringify(a.data)).toEqual(JSON.stringify(b.data));
    expect(a.truth).toEqual(b.truth);
  });

  it('can generate every fault type', () => {
    for (const fault of FAULT_IDS) {
      for (let seed = 0; seed < 30; seed++) {
        expect(generateIncident({ seed, mode: 'normal', fault }).truth.fault).toBe(fault);
      }
    }
  });

  it('distinguishes a multi-region cascade from a traffic spike and shows its caller stage', () => {
    const cascade = Array.from({ length: 100 }, (_, seed) =>
      generateIncident({ seed, mode: 'normal', fault: 'multi_region_cascade' }),
    ).find((inc) => inc.topology.callers[inc.truth.service].length > 0);
    if (!cascade) throw new Error('expected a generated cascade with at least one caller');

    const targetLogs = observe(cascade, `logs:${cascade.truth.service}`);
    expect(targetLogs.has('log_failover')).toBe(true);

    const caller = cascade.topology.callers[cascade.truth.service][0];
    expect(observe(cascade, `logs:${caller}`).has('log_cross_region_timeout')).toBe(true);

    const spike = generateIncident({ seed: cascade.seed, mode: 'normal', fault: 'traffic_spike' });
    expect(observe(spike, `logs:${spike.truth.service}`).has('log_failover')).toBe(false);
    expect(
      spike.topology.services.some((service) =>
        observe(spike, `logs:${service.id}`).has('log_cross_region_timeout'),
      ),
    ).toBe(false);
  });

  it('detection reads back exactly the symptoms that were rendered', () => {
    for (const mode of MODES) {
      for (let seed = 0; seed < 150; seed++) {
        const inc = generateIncident({ seed, mode, fault: FAULT_IDS[seed % FAULT_IDS.length] });
        for (const key of queryKeys(inc.topology)) {
          const obs = [...observe(inc, key)].sort();
          let want: string[];
          if (key === 'deploys') want = [...[...inc.fx.deploys].map((s) => `dep:${s}`), ...[...inc.fx.configs].map((s) => `cfg:${s}`)];
          else {
            const [ch, svc] = key.split(':') as ['metrics' | 'logs' | 'traces', string];
            want = [...inc.fx.services[svc][ch]];
          }
          expect(obs, `seed ${seed} ${mode} ${key}`).toEqual(want.sort());
        }
      }
    }
  });
});
