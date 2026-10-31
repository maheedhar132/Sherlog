import type { AiAction } from '../ai/investigator';
import { CHANNEL_ICON, describeQuery } from './labels';

interface Props {
  /** The AI's belief in the right answer before it opens anything. */
  prior: number;
  actions: AiAction[];
}

/** How sure the AI was of the correct answer after each step. Dips are where evidence pointed the wrong way. */
export function BeliefChart({ prior, actions }: Props) {
  const pts = [
    { p: prior, label: '🔔', note: 'alerts only' },
    ...actions.map((a) => ({
      p: a.pTruth,
      label: a.kind === 'declare' ? (a.correct ? '✓' : '✗') : a.kind === 'fix' ? '🔧' : CHANNEL_ICON[describeQuery(a.key).channel],
      note: a.kind === 'query' ? a.key : a.kind === 'declare' ? (a.correct ? 'declared correctly' : 'wrong guess') : 'applied the fix',
    })),
  ];
  const W = 520;
  const H = 200;
  const L = 44;
  const R = 16;
  const T = 14;
  const B = 36;
  const x = (i: number) => L + (pts.length === 1 ? 0 : (i / (pts.length - 1)) * (W - L - R));
  const y = (p: number) => T + (1 - Math.max(0, Math.min(1, p))) * (H - T - B);
  const line = pts.map((q, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(q.p).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1].p;

  return (
    <svg
      className="belief"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`The AI's belief in the correct answer went from ${Math.round(prior * 100)}% to ${Math.round(last * 100)}% over ${actions.length} steps`}
    >
      {[0, 0.5, 1].map((g) => (
        <g key={g}>
          <line className="grid" x1={L} x2={W - R} y1={y(g)} y2={y(g)} />
          <text className="axis" x={L - 8} y={y(g) + 4} textAnchor="end">
            {Math.round(g * 100)}%
          </text>
        </g>
      ))}
      <path className="belief-line" d={line} />
      {pts.map((q, i) => {
        const dip = i > 0 && pts[i - 1].p - q.p > 0.08;
        return (
          <g key={i}>
            <circle className={`dot ${dip ? 'dip' : ''}`} cx={x(i)} cy={y(q.p)} r={5} />
            <title>{`${q.note}: ${Math.round(q.p * 100)}% sure of the right answer`}</title>
            <text className="step" x={x(i)} y={H - 12} textAnchor="middle">
              {q.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
