import { describe, expect, it } from 'vitest';
import { newProfile, type Profile } from '../src/ai/adapter';
import { dayDiff, recordDaily, streakView } from '../src/game/streak';
import { importProfile } from '../src/lib/storage';

/** Play a daily on each date: 's' = solved and won, 'l' = solved but lost to the AI, 'x' = gave up. */
function play(p: Profile, ...days: [string, 's' | 'l' | 'x'][]): Profile {
  return days.reduce((acc, [date, r]) => recordDaily(acc, date, r === 's', r !== 'x'), p);
}

describe('dayDiff', () => {
  it('counts calendar days across month, year and leap-day boundaries', () => {
    expect(dayDiff('2026-10-31', '2026-11-01')).toBe(1);
    expect(dayDiff('2026-12-31', '2027-01-01')).toBe(1);
    expect(dayDiff('2028-02-28', '2028-03-01')).toBe(2);
    expect(dayDiff('2028-02-29', '2028-03-01')).toBe(1);
    expect(dayDiff('2026-11-05', '2026-11-05')).toBe(0);
  });

  it('is not thrown off by daylight saving changes', () => {
    expect(dayDiff('2026-03-07', '2026-03-09')).toBe(2);
    expect(dayDiff('2026-10-31', '2026-11-02')).toBe(2);
  });
});

describe('daily streak', () => {
  it('starts at 1 and grows on consecutive days', () => {
    const p = play(newProfile(), ['2026-11-01', 's'], ['2026-11-02', 's'], ['2026-11-03', 's']);
    expect(p.streak).toEqual({ current: 3, best: 3, last: '2026-11-03' });
  });

  it('counts a solved daily even when you lose to the AI', () => {
    const p = play(newProfile(), ['2026-11-01', 'l'], ['2026-11-02', 'l']);
    expect(p.streak.current).toBe(2);
    expect(p.dailyStats).toEqual({ played: 2, solved: 2, won: 0 });
  });

  it('restarts at 1 after a missed day but remembers the best', () => {
    const p = play(newProfile(), ['2026-11-01', 's'], ['2026-11-02', 's'], ['2026-11-03', 's'], ['2026-11-05', 's']);
    expect(p.streak).toEqual({ current: 1, best: 3, last: '2026-11-05' });
  });

  it('is broken by giving up, and the next solved day starts again at 1', () => {
    let p = play(newProfile(), ['2026-11-01', 's'], ['2026-11-02', 's'], ['2026-11-03', 'x']);
    expect(p.streak).toMatchObject({ current: 0, best: 2 });
    p = play(p, ['2026-11-04', 's']);
    expect(p.streak).toMatchObject({ current: 1, best: 2, last: '2026-11-04' });
  });

  it('carries across month and year ends', () => {
    const p = play(newProfile(), ['2026-12-30', 's'], ['2026-12-31', 's'], ['2027-01-01', 's']);
    expect(p.streak.current).toBe(3);
  });

  it('does not double count the same day', () => {
    const p = play(newProfile(), ['2026-11-01', 's'], ['2026-11-01', 's']);
    expect(p.streak.current).toBe(1);
  });

  it('survives the clock being set backwards', () => {
    const p = play(newProfile(), ['2026-11-05', 's'], ['2026-11-03', 's']);
    expect(p.streak.current).toBe(1);
    expect(p.streak.best).toBe(1);
  });

  it('tracks played, solved and won separately', () => {
    const p = play(newProfile(), ['2026-11-01', 's'], ['2026-11-02', 'l'], ['2026-11-03', 'x']);
    expect(p.dailyStats).toEqual({ played: 3, solved: 2, won: 1 });
  });
});

describe('streak display', () => {
  const p = play(newProfile(), ['2026-11-01', 's'], ['2026-11-02', 's']);

  it('stays alive and safe on the day you solved it', () => {
    expect(streakView(p.streak, '2026-11-02')).toEqual({ current: 2, best: 2, atRisk: false });
  });

  it('is at risk the next day until you solve that day', () => {
    expect(streakView(p.streak, '2026-11-03')).toEqual({ current: 2, best: 2, atRisk: true });
  });

  it('reads 0 once a full day has been missed, keeping the best', () => {
    expect(streakView(p.streak, '2026-11-04')).toEqual({ current: 0, best: 2, atRisk: false });
  });

  it('is empty for a new player', () => {
    expect(streakView(newProfile().streak, '2026-11-01')).toEqual({ current: 0, best: 0, atRisk: false });
  });
});

describe('profiles saved before streaks existed', () => {
  it('load with an empty streak instead of crashing', () => {
    const old = newProfile() as Partial<Profile>;
    delete old.streak;
    delete old.dailyStats;
    const loaded = importProfile(JSON.stringify(old));
    expect(loaded.streak).toEqual({ current: 0, best: 0, last: null });
    expect(loaded.dailyStats).toEqual({ played: 0, solved: 0, won: 0 });
    expect(streakView(loaded.streak, '2026-11-01').current).toBe(0);
  });

  it('are repaired when the streak data is damaged or hand-edited', () => {
    const bad = (streak: unknown, dailyStats?: unknown) => importProfile(JSON.stringify({ ...newProfile(), streak, dailyStats }));
    expect(bad({}).streak).toEqual({ current: 0, best: 0, last: null });
    expect(bad(null).streak).toEqual({ current: 0, best: 0, last: null });
    expect(bad({ current: 'lots', best: -4, last: 'yesterday' }).streak).toEqual({ current: 0, best: 0, last: null });
    // A streak with no valid last date can't be alive.
    expect(bad({ current: 9, best: 2, last: null }).streak).toEqual({ current: 0, best: 2, last: null });
    // Best is never lower than current.
    expect(bad({ current: 7, best: 3, last: '2026-11-01' }).streak).toEqual({ current: 7, best: 7, last: '2026-11-01' });
    expect(bad({}, { played: Infinity, solved: NaN, won: '3' }).dailyStats).toEqual({ played: 0, solved: 0, won: 0 });
  });

  it('keep a streak through export and import', () => {
    const p = play(newProfile(), ['2026-11-01', 's'], ['2026-11-02', 's']);
    expect(importProfile(JSON.stringify(p)).streak).toEqual(p.streak);
  });
});
