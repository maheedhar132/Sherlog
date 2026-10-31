import { sampleBeta, type Rng } from '../lib/rng';
import { MAX_STRENGTH } from './investigator';
import { FAULT_IDS } from '../sim/faults';
import type { FaultId, Mode } from '../sim/types';

/**
 * How the game learns you, between matches only (never mid-race):
 *  1. AI strength per mode is nudged toward the mode's target win rate.
 *  2. The next incident's fault type is chosen by Thompson sampling toward your weakest areas.
 */

export const TARGET_WIN_RATE: Record<Mode, number> = { easy: 0.7, normal: 0.5, hard: 0.3 };
export const DEFAULT_STRENGTH: Record<Mode, number> = { easy: 0.15, normal: 0.4, hard: 0.7 };
export const PLACEMENT_MATCHES = 3;
export const DAILY_STRENGTH = 0.5;

export interface FaultStat {
  /** Beta posterior over P(you beat the AI on this fault type). */
  a: number;
  b: number;
  played: number;
  solved: number;
  /** Your mean MTTR when solved, in seconds. */
  avgMttr: number | null;
}

export interface MatchRecord {
  at: string;
  mode: Mode;
  fault: FaultId;
  won: boolean;
  playerMttr: number | null;
  aiMttr: number;
  daily: boolean;
}

/** Daily-incident streak. A day counts when you solve it (name the root cause), win or lose against the AI. */
export interface Streak {
  current: number;
  best: number;
  /** Local date (YYYY-MM-DD) of the last solved daily. */
  last: string | null;
}

export interface DailyStats {
  played: number;
  solved: number;
  won: number;
}

export interface Profile {
  v: 1;
  strength: Record<Mode, number>;
  played: number;
  faults: Record<FaultId, FaultStat>;
  history: MatchRecord[];
  daily?: { date: string; won: boolean; playerMttr: number | null; aiMttr: number; share: string };
  streak: Streak;
  dailyStats: DailyStats;
}

export function newProfile(): Profile {
  const faults = {} as Record<FaultId, FaultStat>;
  for (const f of FAULT_IDS) faults[f] = { a: 1, b: 1, played: 0, solved: 0, avgMttr: null };
  return {
    v: 1,
    strength: { ...DEFAULT_STRENGTH },
    played: 0,
    faults,
    history: [],
    streak: { current: 0, best: 0, last: null },
    dailyStats: { played: 0, solved: 0, won: 0 },
  };
}

/** Stochastic-approximation step: at equilibrium, P(you win | strength) = target. */
export function nextStrength(current: number, mode: Mode, won: boolean, played: number): number {
  const eta = played < PLACEMENT_MATCHES ? 0.2 : 0.07;
  const next = current + eta * ((won ? 1 : 0) - TARGET_WIN_RATE[mode]);
  return Math.max(0, Math.min(MAX_STRENGTH, next));
}

/** Thompson sampling: draw your win chance per fault type and train the one that looks weakest. */
export function pickFault(profile: Profile, rng: Rng): FaultId {
  let best = FAULT_IDS[0];
  let lowest = Infinity;
  for (const f of FAULT_IDS) {
    const { a, b } = profile.faults[f];
    const draw = sampleBeta(rng, a, b);
    if (draw < lowest) {
      lowest = draw;
      best = f;
    }
  }
  return best;
}

export function recordMatch(profile: Profile, rec: MatchRecord): { profile: Profile; before: number; after: number } {
  const before = profile.strength[rec.mode];
  const after = rec.daily ? before : nextStrength(before, rec.mode, rec.won, profile.played);
  const fs = profile.faults[rec.fault];
  const solved = rec.playerMttr !== null;
  const stat: FaultStat = {
    a: fs.a + (rec.won ? 1 : 0),
    b: fs.b + (rec.won ? 0 : 1),
    played: fs.played + 1,
    solved: fs.solved + (solved ? 1 : 0),
    avgMttr: solved ? ((fs.avgMttr ?? 0) * fs.solved + rec.playerMttr!) / (fs.solved + 1) : fs.avgMttr,
  };
  return {
    before,
    after,
    profile: {
      ...profile,
      strength: { ...profile.strength, [rec.mode]: after },
      played: profile.played + 1,
      faults: { ...profile.faults, [rec.fault]: stat },
      history: [rec, ...profile.history].slice(0, 100),
    },
  };
}

/** The fault type you currently do worst on (by posterior mean), once you've seen it at least once. */
export function weakestFault(profile: Profile): FaultId | null {
  const seen = FAULT_IDS.filter((f) => profile.faults[f].played > 0);
  if (!seen.length) return null;
  return seen.reduce((w, f) => {
    const m = (x: FaultId) => profile.faults[x].a / (profile.faults[x].a + profile.faults[x].b);
    return m(f) < m(w) ? f : w;
  });
}
