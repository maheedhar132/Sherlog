import { DAILY_STRENGTH, pickFault, type Profile } from '../ai/adapter';
import { simulateAi, type AiRun } from '../ai/investigator';
import { hashString } from '../lib/rng';
import { generateIncident } from '../sim/incident';
import type { Hypothesis, Incident, Mode, QueryKey } from '../sim/types';

export interface MatchSetup {
  incident: Incident;
  ai: AiRun;
  mode: Mode;
  daily: { date: string; number: number } | null;
}

export interface PlayerAction {
  kind: 'query' | 'declare';
  key?: QueryKey;
  hyp?: Hypothesis;
  correct?: boolean;
  /** Your incident clock when you took the action. */
  clock: number;
  cost: number;
}

export interface MatchResult {
  won: boolean;
  /** Null when you never found the root cause. */
  playerMttr: number | null;
  aiMttr: number;
  actions: PlayerAction[];
}

export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const EPOCH = Date.UTC(2026, 10, 1);
export function dailyNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - EPOCH) / 86400000) + 1;
}

export function createMatch(profile: Profile, mode: Mode): MatchSetup {
  const seed = Math.floor(Math.random() * 2 ** 31);
  const fault = profile.played < 1 ? undefined : pickFault(profile, Math.random);
  const incident = generateIncident({ seed, mode, fault });
  return { incident, ai: simulateAi(incident, profile.strength[mode]), mode, daily: null };
}

/** Same incident and same AI for everyone on a given day. */
export function createDaily(date = todayKey()): MatchSetup {
  const incident = generateIncident({ seed: hashString(`daily:${date}`), mode: 'normal' });
  return { incident, ai: simulateAi(incident, DAILY_STRENGTH), mode: 'normal', daily: { date, number: dailyNumber(date) } };
}

export function fmt(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const EMOJI: Record<string, string> = { metrics: '🟦', logs: '🟨', traces: '🟪', deploys: '⬜' };

export function shareText(setup: MatchSetup, result: MatchResult, url: string): string {
  const trail = result.actions
    .map((a) => (a.kind === 'declare' ? (a.correct ? '🟩' : '🟥') : EMOJI[a.key === 'deploys' ? 'deploys' : a.key!.split(':')[0]]))
    .join('');
  const title = setup.daily ? `Sherlog · Daily #${setup.daily.number}` : `Sherlog · ${setup.mode}`;
  const you = result.playerMttr === null ? 'unsolved' : fmt(result.playerMttr);
  const verdict = result.won ? 'beat the AI 🏆' : 'lost to the AI 🤖';
  return `${title}\nMTTR ${you} vs AI ${fmt(result.aiMttr)}: ${verdict}\n${trail || '⬛'}\n${url}`;
}
