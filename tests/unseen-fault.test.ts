import { afterAll, describe, expect, it } from 'vitest';
import { simulateAi } from '../src/ai/investigator';
import { addFx } from '../src/sim/effects';
import { FAULTS, FAULT_IDS, type FaultDef } from '../src/sim/faults';
import { generateIncident } from '../src/sim/incident';
import type { FaultId } from '../src/sim/types';

/**
 * Adding a fault needs no AI code changes: register a new fault type at runtime, describe only its symptoms,
 * and the same investigator can diagnose it. The AI is handed the symptom table (like any fault it knows);
 * what is tested is the reasoning over it, including that the new signature overlaps existing ones.
 */
describe('a new, data-driven fault type (no AI code changes)', () => {
  const id = 'thread_pool_exhaustion' as FaultId;
  const def: FaultDef = {
    id,
    name: 'Thread pool exhaustion',
    short: 'All worker threads are blocked, so requests queue',
    targets: ['app'],
    story: (s) => `${s} ran out of request threads.`,
    signals: ['Latency up and CPU high', 'Its own logs show it shedding load', 'Its own span is slow'],
    tip: 'Busy but not leaking: check the thread pool.',
    effects: (_t, s, fx) => {
      addFx(fx, s, 'metrics', 'lat_up', 'cpu_up');
      addFx(fx, s, 'logs', 'log_overload');
      addFx(fx, s, 'traces', 'tr_self_slow');
    },
  };
  FAULTS[id] = def;
  FAULT_IDS.push(id);
  afterAll(() => {
    delete (FAULTS as Partial<Record<FaultId, FaultDef>>)[id];
    FAULT_IDS.splice(FAULT_IDS.indexOf(id), 1);
  });

  it('is diagnosed, and usually on the first declaration', () => {
    let firstTry = 0;
    const n = 60;
    for (let seed = 0; seed < n; seed++) {
      const inc = generateIncident({ seed, mode: 'normal', fault: id });
      const run = simulateAi(inc, 1);
      const declares = run.actions.filter((a) => a.kind === 'declare');
      const last = declares[declares.length - 1];
      expect(last.kind === 'declare' && last.correct && last.hyp.fault === id, `seed ${seed}`).toBe(true);
      if (declares.length === 1) firstTry++;
    }
    expect(firstTry / n).toBeGreaterThan(0.9);
  });
});
