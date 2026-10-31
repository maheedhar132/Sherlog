import { describe, expect, it } from 'vitest';
import { simulateAi } from '../src/ai/investigator';
import { hasAftershock } from '../src/game/session';
import { generateIncident } from '../src/sim/incident';

describe('aftershock', () => {
  it('hits the same system with a different fault', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const first = generateIncident({ seed, mode: 'normal' });
      const second = generateIncident({ seed, mode: 'normal', aftershockOf: first.truth });
      expect(second.topology.services.map((s) => s.id)).toEqual(first.topology.services.map((s) => s.id));
      expect(second.truth.fault).not.toBe(first.truth.fault);
    }
  });

  it('is solvable by the AI', () => {
    let solved = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const first = generateIncident({ seed, mode: 'hard' });
      const second = generateIncident({ seed, mode: 'hard', aftershockOf: first.truth });
      if (simulateAi(second, 0.8).actions.some((a) => a.kind === 'declare' && a.hyp.fault === second.truth.fault)) solved++;
    }
    expect(solved).toBeGreaterThanOrEqual(18);
  });

  it('is decided by the seed, never on Easy', () => {
    expect(hasAftershock(5, 'easy')).toBe(false);
    expect(hasAftershock(123, 'normal')).toBe(hasAftershock(123, 'normal'));
    const rate = Array.from({ length: 400 }, (_, i) => hasAftershock(i, 'hard')).filter(Boolean).length / 400;
    expect(rate).toBeGreaterThan(0.45);
    expect(rate).toBeLessThan(0.75);
  });
});
