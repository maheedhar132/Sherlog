import { describe, expect, it } from 'vitest';
import { isBetterShift, scoreShift, shiftShareText } from '../src/game/shift';

const win = { won: true, playerMttr: 100, aiMttr: 150 };
const slow = { won: false, playerMttr: 200, aiMttr: 120 };
const unsolved = { won: false, playerMttr: null, aiMttr: 90 };

describe('on-call shift', () => {
  it('counts an unsolved incident as the whole error budget', () => {
    const s = scoreShift([win, slow, unsolved]);
    expect(s).toEqual({ solved: 2, wins: 1, total: 100 + 200 + 600, aiTotal: 360 });
  });

  it('prefers more solved incidents, then the faster total', () => {
    const base = { solved: 2, total: 400, date: '2026-11-01' };
    expect(isBetterShift({ solved: 3, wins: 0, total: 900, aiTotal: 0 }, base)).toBe(true);
    expect(isBetterShift({ solved: 2, wins: 0, total: 300, aiTotal: 0 }, base)).toBe(true);
    expect(isBetterShift({ solved: 2, wins: 0, total: 500, aiTotal: 0 }, base)).toBe(false);
    expect(isBetterShift({ solved: 1, wins: 0, total: 50, aiTotal: 0 }, base)).toBe(false);
    expect(isBetterShift({ solved: 1, wins: 0, total: 900, aiTotal: 0 }, undefined)).toBe(true);
    expect(isBetterShift({ solved: 0, wins: 0, total: 1800, aiTotal: 0 }, undefined)).toBe(false);
  });

  it('writes a shareable summary', () => {
    const t = shiftShareText([win, slow, unsolved], 'https://example.test/');
    expect(t).toContain('1/3 beat the AI');
    expect(t).toContain('unsolved');
  });
});
