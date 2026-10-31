import { DAILY_STRENGTH, pickFault, type Profile } from '../ai/adapter';
import { simulateAi, type AiRun } from '../ai/investigator';
import { hashString } from '../lib/rng';
import { generateIncident } from '../sim/incident';
import type { FixId } from '../sim/fixes';
import { FAULT_IDS } from '../sim/faults';
import type { FaultId, Hypothesis, Incident, Mode, QueryKey } from '../sim/types';

export interface MatchSetup {
  incident: Incident;
  ai: AiRun;
  mode: Mode;
  daily: { date: string; number: number } | null;
  /** The guided first incident: unranked, with the coach on. */
  tutorial?: boolean;
  /** Set when the scenario picker forced the fault, which a shared link must repeat to rebuild the same incident. */
  forced?: FaultId;
  /** Position in an on-call shift, a run of back-to-back incidents scored together. */
  shift?: { n: number; of: number };
  /** True when a second, unrelated fault will hit this system once this one is fixed. */
  aftershock?: boolean;
  /** Set on the second incident of a system. */
  wave?: 2;
}

export interface PlayerAction {
  kind: 'query' | 'declare' | 'fix' | 'hint';
  key?: QueryKey;
  hyp?: Hypothesis;
  fix?: FixId;
  correct?: boolean;
  /** Your incident clock when you took the action. */
  clock: number;
  cost: number;
}

export interface MatchResult {
  won: boolean;
  /** True when the incident outlasted the whole SLO error budget. */
  breached?: boolean;
  /** Null when you never found the root cause. */
  playerMttr: number | null;
  aiMttr: number;
  actions: PlayerAction[];
}

export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Daily #1 is the public launch day.
const EPOCH = Date.UTC(2026, 9, 31);
export function dailyNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.max(1, Math.floor((Date.UTC(y, m - 1, d) - EPOCH) / 86400000) + 1);
}

export function createMatch(profile: Profile, mode: Mode): MatchSetup {
  const seed = Math.floor(Math.random() * 1_000_000);
  // Avoid showing the same fault as either of the last two matches.
  const recent = profile.history.slice(0, 2).map((h) => h.fault);
  let fault = profile.played < 1 ? undefined : pickFault(profile, Math.random);
  for (let i = 0; fault && recent.includes(fault) && i < 4; i++) fault = pickFault(profile, Math.random);
  const incident = generateIncident({ seed, mode, fault });
  return { incident, ai: simulateAi(incident, profile.strength[mode]), mode, daily: null, forced: fault, aftershock: hasAftershock(seed, mode) };
}

/** Rebuild a specific incident from a shared link, racing the AI at the player's own level. */
export function createFromSeed(seed: number, mode: Mode, profile: Profile, forced?: FaultId): MatchSetup {
  const incident = generateIncident({ seed, mode, fault: forced });
  return { incident, ai: simulateAi(incident, profile.strength[mode]), mode, daily: null, forced, aftershock: hasAftershock(seed, mode) };
}

/** Parse `#seed=123&mode=normal&fault=disk_full`; null when it is not a valid incident link. */
export function parseIncidentHash(hash: string): { seed: number; mode: Mode; fault?: FaultId } | null {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const seed = Number(q.get('seed'));
  const mode = q.get('mode');
  const fault = q.get('fault');
  if (!Number.isInteger(seed) || seed < 0 || seed > 2 ** 31) return null;
  if (mode !== 'easy' && mode !== 'normal' && mode !== 'hard') return null;
  if (fault && !(FAULT_IDS as string[]).includes(fault)) return null;
  return { seed, mode, fault: (fault as FaultId) || undefined };
}

/** Same incident and same AI for everyone on a given day. */
export function createDaily(date = todayKey()): MatchSetup {
  const incident = generateIncident({ seed: hashString(`daily:${date}`), mode: 'normal' });
  return { incident, ai: simulateAi(incident, DAILY_STRENGTH), mode: 'normal', daily: { date, number: dailyNumber(date) } };
}

/** The guided first incident: a database saturation where only its callers page. */
export const TUTORIAL_SEED = 110;
export function createTutorial(): MatchSetup {
  const incident = generateIncident({ seed: TUTORIAL_SEED, mode: 'easy' });
  return { incident, ai: simulateAi(incident, 0.1), mode: 'easy', daily: null, tutorial: true };
}

export function fmt(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const EMOJI: Record<string, string> = { metrics: '🟦', logs: '🟨', traces: '🟪', deploys: '⬜' };

export function shareText(setup: MatchSetup, result: MatchResult, url: string, streak = 0): string {
  const trail = result.actions
    .map((a) => {
      if (a.kind === 'declare') return a.correct ? '🟩' : '🟥';
      if (a.kind === 'fix') return a.correct ? '🔧' : '🟥';
      if (a.kind === 'hint') return '💡';
      return EMOJI[a.key === 'deploys' ? 'deploys' : a.key!.split(':')[0]];
    })
    .join('');
  const fire = setup.daily && streak >= 2 ? ` · 🔥 ${streak}` : '';
  const title = setup.daily ? `Sherlog · Daily #${setup.daily.number}${fire}` : `Sherlog · ${setup.mode}`;
  const you = result.playerMttr === null ? 'unsolved' : fmt(result.playerMttr);
  const verdict = `${result.won ? 'beat the AI 🏆' : 'lost to the AI 🤖'}${result.breached ? ' · SLO breached 🔥' : ''}`;
  // A shared result links to the exact incident, so a friend can try to beat it.
  const link = setup.daily || setup.tutorial ? url : `${url}#seed=${setup.incident.seed}&mode=${setup.mode}${setup.forced ? `&fault=${setup.forced}` : ''}`;
  return `${title}\nMTTR ${you} vs AI ${fmt(result.aiMttr)}: ${verdict}\n${trail || '⬛'}\n${link}`;
}

/** One incident of an on-call shift: the player's usual difficulty, with the AI at their level. */
export function createShiftIncident(profile: Profile, mode: Mode, n: number, of: number): MatchSetup {
  return { ...createMatch(profile, mode), shift: { n, of }, aftershock: false };
}

/** Whether fixing this incident leaves a second fault behind. Decided by the seed, so a shared link behaves the same for everyone. */
export function hasAftershock(seed: number, mode: Mode): boolean {
  if (mode === 'easy') return false;
  return (hashString(`aftershock:${seed}`) % 100) / 100 < (mode === 'hard' ? 0.6 : 0.4);
}

/** A second fault on the system you just fixed: a new race against an AI at your level. */
export function createAftershock(prev: MatchSetup, profile: Profile): MatchSetup {
  const incident = generateIncident({ seed: prev.incident.seed, mode: prev.mode, aftershockOf: prev.incident.truth });
  return { incident, ai: simulateAi(incident, profile.strength[prev.mode]), mode: prev.mode, daily: null, wave: 2 };
}
