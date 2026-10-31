import { describe, expect, it } from 'vitest';
import { newProfile, weakestFault } from '../src/ai/adapter';
import { TUTORIAL_SEED, createFromSeed, createMatch, createTutorial, parseIncidentHash, shareText } from '../src/game/session';
import { importProfile } from '../src/lib/storage';
import { detectAlerts } from '../src/sim/detect';
import { FAULT_IDS } from '../src/sim/faults';
import { FIXES, FIX_FOR, fixOptions } from '../src/sim/fixes';
import { generateIncident } from '../src/sim/incident';
import { pages } from '../src/sim/slo';

describe('mitigation', () => {
  it('has an explained fix for every fault', () => {
    for (const f of FAULT_IDS) {
      expect(FIX_FOR[f], f).toBeDefined();
      expect(FIXES[FIX_FOR[f].fix]).toBeTruthy();
      expect(FIX_FOR[f].why.length).toBeGreaterThan(40);
    }
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

describe('the weakest-area label', () => {
  it('waits for a few matches before naming one', () => {
    const p = newProfile();
    p.played = 2;
    p.faults.retry_storm = { a: 1, b: 4, played: 1, solved: 0, avgMttr: null };
    expect(weakestFault(p)).toBeNull();
    p.played = 3;
    expect(weakestFault(p)).toBe('retry_storm');
  });
});

describe('alert noise and seeds', () => {
  it('some incidents page on unrelated, flapping alerts', () => {
    let withNoise = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const inc = generateIncident({ seed, mode: 'hard' });
      for (const line of inc.noise) expect(line).toMatch(/^[a-z-]+: /);
      if (inc.noise.length) withNoise++;
    }
    expect(withNoise).toBeGreaterThan(0);
  });

  it('new matches use short seeds and avoid repeating the last two faults', () => {
    const profile = newProfile();
    profile.played = 5;
    profile.history = [
      { at: '', mode: 'normal', fault: 'disk_full', won: true, playerMttr: 60, aiMttr: 90, daily: false },
      { at: '', mode: 'normal', fault: 'db_pool', won: true, playerMttr: 60, aiMttr: 90, daily: false },
    ];
    let repeats = 0;
    for (let i = 0; i < 60; i++) {
      const m = createMatch(profile, 'normal');
      expect(m.incident.seed).toBeLessThan(1_000_000);
      if (m.forced === 'disk_full' || m.forced === 'db_pool') repeats++;
    }
    expect(repeats).toBeLessThan(6);
  });
});

describe('shared incident links', () => {
  it('parses valid links and rejects bad ones', () => {
    expect(parseIncidentHash('#seed=229&mode=normal')).toEqual({ seed: 229, mode: 'normal', fault: undefined });
    expect(parseIncidentHash('#seed=5&mode=hard&fault=disk_full')).toEqual({ seed: 5, mode: 'hard', fault: 'disk_full' });
    for (const bad of ['', '#seed=abc&mode=normal', '#seed=1&mode=insane', '#seed=-4&mode=easy', '#seed=1&mode=easy&fault=nope']) {
      expect(parseIncidentHash(bad), bad).toBeNull();
    }
  });

  it('rebuilds the exact incident a result was shared from, including a forced fault', () => {
    const profile = newProfile();
    profile.played = 5; // past the first game, so the scenario picker forces a fault
    for (let i = 0; i < 10; i++) {
      const match = createMatch(profile, 'normal');
      const shared = shareText(match, { won: true, playerMttr: 60, aiMttr: 90, actions: [] }, 'https://example.test/');
      const link = shared.split('\n').pop()!;
      const parsed = parseIncidentHash(link.slice(link.indexOf('#')));
      expect(parsed).not.toBeNull();
      const again = createFromSeed(parsed!.seed, parsed!.mode, profile, parsed!.fault);
      expect(again.incident.truth).toEqual(match.incident.truth);
      expect(again.incident.topology.services.map((x) => x.id)).toEqual(match.incident.topology.services.map((x) => x.id));
    }
  });
});
