import { describe, expect, it } from 'vitest';
import { DEFAULT_STRENGTH, TARGET_WIN_RATE, nextStrength, newProfile, pickFault, recordMatch } from '../src/ai/adapter';
import { simulateAi, type AiRun } from '../src/ai/investigator';
import { mulberry32, shuffle } from '../src/lib/rng';
import { wrongPenalty } from '../src/sim/constants';
import { FAULT_IDS } from '../src/sim/faults';
import { generateIncident, hypotheses, sameHypothesis } from '../src/sim/incident';
import type { Mode } from '../src/sim/types';

describe('AI investigator', () => {
  it('always ends with the correct root cause', () => {
    for (let seed = 0; seed < 50; seed++) {
      const inc = generateIncident({ seed, mode: 'hard', fault: FAULT_IDS[seed % FAULT_IDS.length] });
      const run = simulateAi(inc, seed % 2 ? 1 : 0);
      const declares = run.actions.filter((a) => a.kind === 'declare');
      const last = declares[declares.length - 1];
      expect(last.kind === 'declare' && last.correct, `seed ${seed}`).toBe(true);
      expect(run.actions[run.actions.length - 1].kind, `seed ${seed}`).toBe('fix');
    }
  });

  it('a strong AI is efficient and rarely guesses wrong', () => {
    let queries = 0;
    let wrong = 0;
    const n = 60;
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
      for (let seed = 0; seed < 40; seed++) total += simulateAi(generateIncident({ seed, mode: 'normal' }), strength).mttr;
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

describe('what the AI is allowed to know', () => {
  // The first steps of a run: every query, up to and including the first declaration.
  const trail = (r: AiRun) => {
    const out: string[] = [];
    for (const a of r.actions) {
      if (a.kind === 'fix') break;
      out.push(a.kind === 'query' ? a.key : `${a.hyp.fault}@${a.hyp.service}`);
      if (a.kind === 'declare') break;
    }
    return out;
  };

  it('behaves identically whatever the hidden answer is, until a declaration is judged', () => {
    for (let seed = 0; seed < 20; seed++) {
      const inc = generateIncident({ seed, mode: 'hard', fault: FAULT_IDS[seed % FAULT_IDS.length] });
      const decoy = hypotheses(inc.topology).find((h) => !sameHypothesis(h, inc.truth))!;
      // Swap the hidden answer and wipe the simulator's own symptom bookkeeping: only the rendered dashboards remain.
      const tampered = { ...inc, truth: decoy, fx: { services: {}, deploys: new Set<string>(), configs: new Set<string>() }, herrings: [] };
      expect(trail(simulateAi(tampered, 0.7)), `seed ${seed}`).toEqual(trail(simulateAi(inc, 0.7)));
    }
  });

  it('records sensible reasoning: sorted suspects whose leader is what it declares', () => {
    for (let seed = 0; seed < 40; seed++) {
      const run = simulateAi(generateIncident({ seed, mode: 'normal' }), 0.7);
      expect(run.prior.length).toBe(3);
      for (const a of run.actions) {
        const p = a.suspects.map((s) => s.p);
        expect([...p].sort((x, y) => y - x)).toEqual(p);
        expect(p[0]).toBeLessThanOrEqual(1);
      }
      const declares = run.actions.filter((a) => a.kind === 'declare');
      const last = declares[declares.length - 1];
      if (last.kind === 'declare' && last.correct) expect(last.suspects[0].hyp).toEqual(last.hyp);
    }
  });
});

describe('guessing does not pay', () => {
  it('charges 20s, 40s, 60s... for successive wrong declarations, for the AI too', () => {
    expect([1, 2, 3].map(wrongPenalty)).toEqual([20, 40, 60]);
    // The AI rarely guesses wrong, so look across many incidents for real wrong declarations.
    let found = 0;
    for (let seed = 0; seed < 700; seed++) {
      const run = simulateAi(generateIncident({ seed, mode: 'hard' }), DEFAULT_STRENGTH.easy);
      const wrongCosts = run.actions.filter((a) => a.kind === 'declare' && !a.correct).map((a) => a.cost);
      expect(wrongCosts, `seed ${seed}`).toEqual(wrongCosts.map((_, i) => 20 * (i + 1)));
      found += wrongCosts.length;
      if (found >= 2) break;
    }
    expect(found).toBeGreaterThan(0);
  }, 30_000);

  it('keeps a player who never opens a dashboard from beating the Normal AI most of the time', () => {
    const rng = mulberry32(99);
    let wins = 0;
    const n = 150;
    for (let seed = 0; seed < n; seed++) {
      const inc = generateIncident({ seed, mode: 'normal' });
      const order = shuffle(rng, hypotheses(inc.topology));
      const k = order.findIndex((h) => sameHypothesis(h, inc.truth));
      // 4.5s of clicking per guess, plus the escalating penalty for each miss.
      let clock = 0;
      for (let i = 0; i <= k; i++) clock += 4.5 + (i < k ? wrongPenalty(i + 1) : 0);
      if (clock < simulateAi(inc, DEFAULT_STRENGTH.normal).mttr) wins++;
    }
    expect(wins / n).toBeLessThan(0.3);
  }, 30_000);
});
