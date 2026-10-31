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

  it('detection reads back exactly the symptoms that were rendered', () => {
    for (const mode of MODES) {
      for (let seed = 0; seed < 150; seed++) {
        const inc = generateIncident({ seed, mode, fault: FAULT_IDS[seed % FAULT_IDS.length] });
        for (const key of queryKeys(inc.topology)) {
          const obs = [...observe(inc, key)].sort();
          let want: string[];
          if (key === 'deploys') want = [...inc.fx.deploys].map((s) => `dep:${s}`);
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
