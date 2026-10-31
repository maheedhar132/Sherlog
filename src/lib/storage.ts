import { newProfile, type Profile } from '../ai/adapter';

const KEY = 'sherlog.profile.v1';

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return newProfile();
    const p = JSON.parse(raw) as Profile;
    return p.v === 1 ? { ...newProfile(), ...p } : newProfile();
  } catch {
    return newProfile();
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
  return { ...newProfile(), ...p };
}
