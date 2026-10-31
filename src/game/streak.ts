import type { DailyStats, Profile, Streak } from '../ai/adapter';

/** Whole days from one local date key (YYYY-MM-DD) to another. UTC maths, so DST never shifts a day. */
export function dayDiff(from: string, to: string): number {
  const ms = (k: string) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(to) - ms(from)) / 86400000);
}

export interface StreakView {
  /** Streak to show today: 0 once a day has been missed. */
  current: number;
  best: number;
  /** A streak is alive but today's daily isn't solved yet. */
  atRisk: boolean;
}

export function streakView(streak: Streak, today: string): StreakView {
  const gap = streak.last === null ? Infinity : dayDiff(streak.last, today);
  const alive = streak.current > 0 && gap <= 1;
  return { current: alive ? streak.current : 0, best: streak.best, atRisk: alive && gap === 1 };
}

/** Record a finished daily. `date` is the incident's date, so a match that crosses midnight counts for the day it started. */
export function recordDaily(profile: Profile, date: string, won: boolean, solved: boolean): Profile {
  const stats: DailyStats = {
    played: profile.dailyStats.played + 1,
    solved: profile.dailyStats.solved + (solved ? 1 : 0),
    won: profile.dailyStats.won + (won ? 1 : 0),
  };
  const { streak } = profile;
  if (!solved) return { ...profile, dailyStats: stats, streak: { ...streak, current: 0 } };

  const gap = streak.last === null ? Infinity : dayDiff(streak.last, date);
  // Same day twice (e.g. an imported profile) keeps the streak; the next day extends it; anything else restarts at 1.
  const current = gap === 0 ? Math.max(1, streak.current) : gap === 1 ? streak.current + 1 : 1;
  return {
    ...profile,
    dailyStats: stats,
    streak: { current, best: Math.max(streak.best, current), last: date },
  };
}
