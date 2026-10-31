import type { Profile } from '../ai/adapter';
import { fmt, type MatchResult } from './session';
import { ERROR_BUDGET_SECONDS } from '../sim/slo';

export const SHIFT_LENGTH = 3;

export interface ShiftEntry {
  won: boolean;
  /** Null when the incident was never solved. */
  playerMttr: number | null;
  aiMttr: number;
}

export interface ShiftScore {
  solved: number;
  wins: number;
  /** Your total time, counting an unsolved incident as the whole error budget. */
  total: number;
  aiTotal: number;
}

export const toEntry = (r: MatchResult): ShiftEntry => ({ won: r.won, playerMttr: r.playerMttr, aiMttr: r.aiMttr });

export function scoreShift(entries: ShiftEntry[]): ShiftScore {
  return {
    solved: entries.filter((e) => e.playerMttr !== null).length,
    wins: entries.filter((e) => e.won).length,
    total: entries.reduce((n, e) => n + (e.playerMttr ?? ERROR_BUDGET_SECONDS), 0),
    aiTotal: entries.reduce((n, e) => n + e.aiMttr, 0),
  };
}

/** More incidents solved is better; on a tie, the faster total wins. */
export function isBetterShift(a: ShiftScore, b: Profile['bestShift']): boolean {
  if (a.solved === 0) return false;
  if (!b) return true;
  return a.solved > b.solved || (a.solved === b.solved && a.total < b.total);
}

export function shiftShareText(entries: ShiftEntry[], url: string): string {
  const s = scoreShift(entries);
  const lines = entries.map((e) => `${e.won ? '🏆' : e.playerMttr === null ? '⬛' : '🤖'} ${e.playerMttr === null ? 'unsolved' : fmt(e.playerMttr)} vs ${fmt(e.aiMttr)}`);
  return `Sherlog · on-call shift\n${s.wins}/${entries.length} beat the AI · ${fmt(s.total)} vs AI ${fmt(s.aiTotal)}\n${lines.join('\n')}\n${url}`;
}
