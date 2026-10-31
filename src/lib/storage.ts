import { newProfile, type Profile, type Streak } from '../ai/adapter';

const KEY = 'sherlog.profile.v1';
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0);

/** Fill in fields that older saves don't have, and repair streak data that was hand-edited or damaged. */
function hydrate(p: Profile): Profile {
  const s = p.streak as Partial<Streak> | undefined;
  const d = p.dailyStats as Partial<Profile['dailyStats']> | undefined;
  const last = typeof s?.last === 'string' && DATE_KEY.test(s.last) ? s.last : null;
  const current = last ? count(s?.current) : 0;
  return {
    ...newProfile(),
    ...p,
    faults: { ...newProfile().faults, ...p.faults },
    streak: { current, best: Math.max(count(s?.best), current), last },
    dailyStats: { played: count(d?.played), solved: count(d?.solved), won: count(d?.won) },
  };
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return newProfile();
    const p = JSON.parse(raw) as Profile;
    return p.v === 1 ? hydrate(p) : newProfile();
  } catch {
    return newProfile();
  }
}

/** Whether the in-match coach is on: null until the player chooses. */
export function loadCoachPref(): boolean | null {
  try {
    const v = localStorage.getItem('sherlog.coach');
    return v === null ? null : v === 'on';
  } catch {
    return null;
  }
}

export function saveCoachPref(on: boolean): void {
  try {
    localStorage.setItem('sherlog.coach', on ? 'on' : 'off');
  } catch {
    // Storage unavailable: the choice just won't persist.
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Private mode or storage full: the game still works, it just won't remember you.
  }
}

export function exportProfile(p: Profile): string {
  return JSON.stringify(p, null, 2);
}

export function importProfile(json: string): Profile {
  const p = JSON.parse(json) as Profile;
  if (p.v !== 1 || !p.strength || !p.faults) throw new Error('Not a Sherlog profile');
  return hydrate(p);
}
