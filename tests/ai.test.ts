import { describe, expect, it } from 'vitest';
import { DEFAULT_STRENGTH, TARGET_WIN_RATE, nextStrength, newProfile, pickFault, recordMatch } from '../src/ai/adapter';
import { simulateAi } from '../src/ai/investigator';
import { mulberry32 } from '../src/lib/rng';
import { FAULT_IDS } from '../src/sim/faults';
import { generateIncident } from '../src/sim/incident';
import type { Mode } from '../src/sim/types';

describe('AI investigator', () => {
  it('always ends with the correct root cause', () => {
    for (let seed = 0; seed < 120; seed++) {
      const inc = generateIncident({ seed, mode: 'hard', fault: FAULT_IDS[seed % FAULT_IDS.length] });
      const run = simulateAi(inc, seed % 2 ? 1 : 0);
      const last = run.actions[run.actions.length - 1];
      expect(last.kind === 'declare' && last.correct, `seed ${seed}`).toBe(true);
    }
  });

  it('a strong AI is efficient and rarely guesses wrong', () => {
    let queries = 0;
    let wrong = 0;
    const n = 120;
    for (let seed = 0; seed < n; seed++) {
      const inc = generateIncident({ seed, mode: 'normal', fault: FAULT_IDS[seed % FAULT_IDS.length] });
      const run = simulateAi(inc, 1);
      queries += run.actions.filter((a) => a.kind === 'query').length;
      wrong += run.actions.filter((a) => a.kind === 'declare' && !a.correct).length;
    }
    expect(queries / n).toBeLessThan(8);
    expect(wrong / n).toBeLessThan(0.25);
  });

  it('strength actually changes how fast the AI resolves', () => {
    const avg = (strength: number) => {
      let total = 0;
      for (let seed = 0; seed < 80; seed++) total += simulateAi(generateIncident({ seed, mode: 'normal' }), strength).mttr;
      return total / 80;
    };
    const weak = avg(0);
    const mid = avg(0.5);
    const strong = avg(1);
    expect(weak).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(strong);
  });
});

describe('adaptation', () => {
  // A simulated player whose win chance falls as AI strength rises.
  const winChance = (skill: number, strength: number) => 1 / (1 + Math.exp(-6 * (skill - strength)));

  for (const mode of ['easy', 'normal', 'hard'] as Mode[]) {
    it(`converges to the ${mode} target win rate`, () => {
      const rng = mulberry32(42);
      for (const skill of [0.3, 0.6, 0.9]) {
        let s = DEFAULT_STRENGTH[mode];
        let wins = 0;
        const n = 2000;
        for (let i = 0; i < n; i++) {
          const won = rng() < winChance(skill, s);
          if (i >= n / 2) wins += won ? 1 : 0;
          s = nextStrength(s, mode, won, i);
        }
        expect(Math.abs(wins / (n / 2) - TARGET_WIN_RATE[mode]), `skill ${skill}`).toBeLessThan(0.1);
      }
    });
  }

  it('targets the fault types you lose on', () => {
    let p = newProfile();
    for (let i = 0; i < 12; i++) {
      for (const f of FAULT_IDS) {
        p = recordMatch(p, { at: '', mode: 'normal', fault: f, won: f !== 'retry_storm', playerMttr: 60, aiMttr: 90, daily: true }).profile;
      }
    }
    const rng = mulberry32(7);
    const picks = Array.from({ length: 300 }, () => pickFault(p, rng));
    const share = picks.filter((f) => f === 'retry_storm').length / picks.length;
    expect(share).toBeGreaterThan(0.6);
  });
});
