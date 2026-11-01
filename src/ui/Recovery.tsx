import { useEffect, useState } from 'react';

export type RecoveryKind = 'fixed' | 'stopgap' | 'wrong';

const POINTS = 60;
const CUT = 0.35;
const HIGH = 0.85;
const LOW = 0.15;

/** Latency level (0 to 1) at point x of the response to a fix. Deterministic, so it can be tested. */
export function recoveryValue(kind: RecoveryKind, x: number): number {
  if (x < CUT || kind === 'wrong') return HIGH;
  const after = (x - CUT) / (1 - CUT);
  if (kind === 'fixed') return LOW + (HIGH - LOW) * Math.exp(-6 * after);
  // A stopgap: relief for a while, then the cause brings it back.
  const relief = 0.45 + (HIGH - 0.45) * Math.exp(-6 * Math.min(after, 0.45));
  return after < 0.5 ? relief : relief + (HIGH - relief) * Math.min(1, (after - 0.5) / 0.5);
}

const COPY: Record<RecoveryKind, string> = {
  fixed: 'Latency is recovering: that was the cause.',
  stopgap: 'Latency dips, then climbs back: the cause is still there.',
  wrong: 'Nothing changes: that was not it.',
};

export const RECOVERY_MS = 2200;

/** Plays the service's latency responding to the fix you chose. */
export function Recovery({ kind, service }: { kind: RecoveryKind; service: string }) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / (RECOVERY_MS - 300));
      setProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const shown = Math.max(2, Math.round(progress * POINTS));
  const pts = Array.from({ length: shown }, (_, i) => {
    const x = i / (POINTS - 1);
    const wobble = Math.sin(i * 1.7) * 0.025;
    return `${(x * 300).toFixed(1)},${(84 - (recoveryValue(kind, x) + wobble) * 76).toFixed(1)}`;
  }).join(' ');
  return (
    <div className="recovery" role="status">
      <div className="recovery-title">p99 latency on <code>{service}</code></div>
      <svg viewBox="0 0 300 90" role="img" aria-label={COPY[kind]}>
        <line x1="0" x2="300" y1={84 - LOW * 76} y2={84 - LOW * 76} className="base" />
        <line x1={CUT * 300} x2={CUT * 300} y1="0" y2="90" className="cut" />
        <polyline points={pts} className={`line ${kind}`} fill="none" />
      </svg>
      <p>{progress >= 1 ? COPY[kind] : 'Applying the fix…'}</p>
    </div>
  );
}
