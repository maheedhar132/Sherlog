import { describe, expect, it } from 'vitest';
import { newProfile } from '../src/ai/adapter';
import { TUTORIAL_SEED, createTutorial } from '../src/game/session';
import { importProfile } from '../src/lib/storage';
import { detectAlerts } from '../src/sim/detect';
import { FAULT_IDS } from '../src/sim/faults';
import { FIXES, FIX_FOR, fixOptions } from '../src/sim/fixes';
import { generateIncident } from '../src/sim/incident';
import { pages } from '../src/sim/slo';

describe('mitigation', () => {
  it('has a distinct, explained fix for every fault', () => {
    for (const f of FAULT_IDS) {
      expect(FIX_FOR[f], f).toBeDefined();
      expect(FIXES[FIX_FOR[f].fix]).toBeTruthy();
      expect(FIX_FOR[f].why.length).toBeGreaterThan(40);
    }
    expect(new Set(FAULT_IDS.map((f) => FIX_FOR[f].fix)).size).toBe(FAULT_IDS.length);
  });

  it('offers four unique options with exactly one correct, stable for an incident', () => {
    for (const f of FAULT_IDS) {
      for (let seed = 0; seed < 20; seed++) {
        const options = fixOptions(seed, f);
        expect(options).toHaveLength(4);
        expect(new Set(options).size).toBe(4);
        expect(options.filter((o) => o === FIX_FOR[f].fix)).toHaveLength(1);
        expect(fixOptions(seed, f)).toEqual(options);
      }
    }
  });
});

describe('training incident', () => {
  it('is a clear Easy incident whose culprit is not paging', () => {
    const t = createTutorial();
    expect(t.tutorial).toBe(true);
    expect(t.mode).toBe('easy');
    expect(t.incident.seed).toBe(TUTORIAL_SEED);
    expect(t.incident.truth.fault).toBe('db_pool');
    expect(detectAlerts(t.incident).has(t.incident.truth.service)).toBe(false);
  });
});

describe('saves from before the newer fault types', () => {
  it('load with a record for every fault', () => {
    const old = newProfile();
    for (const f of FAULT_IDS.slice(6)) delete (old.faults as Partial<typeof old.faults>)[f];
    const loaded = importProfile(JSON.stringify(old));
    for (const f of FAULT_IDS) expect(loaded.faults[f], f).toBeDefined();
  });
});

describe('pages', () => {
  it('describe each paging service in SLO terms', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const inc = generateIncident({ seed, mode: 'normal' });
      for (const p of pages(inc, detectAlerts(inc))) expect(p.text.startsWith(p.service)).toBe(true);
    }
  });
});
