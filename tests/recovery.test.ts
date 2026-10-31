import { describe, expect, it } from 'vitest';
import { recoveryValue } from '../src/ui/Recovery';

describe('fix response curves', () => {
  it('a cure recovers close to baseline', () => {
    expect(recoveryValue('fixed', 0)).toBeGreaterThan(0.8);
    expect(recoveryValue('fixed', 1)).toBeLessThan(0.25);
  });

  it('a stopgap dips and then climbs back', () => {
    const dip = Math.min(...Array.from({ length: 60 }, (_, i) => recoveryValue('stopgap', 0.35 + (i / 60) * 0.65)));
    expect(dip).toBeLessThan(0.6);
    expect(recoveryValue('stopgap', 1)).toBeGreaterThan(dip + 0.2);
  });

  it('a wrong fix changes nothing', () => {
    expect(recoveryValue('wrong', 0.9)).toBe(recoveryValue('wrong', 0));
  });
});
