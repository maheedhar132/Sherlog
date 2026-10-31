import { useMemo } from 'react';
import { depths } from '../sim/topology';
import type { QueryKey, Topology } from '../sim/types';
import { KIND_LABEL } from './labels';

const W = 132;
const H = 40;
const GAP_X = 44;
const GAP_Y = 14;
const PAD = 10;

interface Props {
  topology: Topology;
  alerts: Set<string>;
  selected: string;
  queried: Set<QueryKey>;
  onSelect: (id: string) => void;
}

export function ServiceMap({ topology, alerts, selected, queried, onSelect }: Props) {
  const layout = useMemo(() => {
    const d = depths(topology);
    const cols: string[][] = [];
    for (const s of topology.services) (cols[d[s.id]] ??= []).push(s.id);
    const pos: Record<string, { x: number; y: number }> = {};
    cols.forEach((col, c) => col.forEach((id, r) => (pos[id] = { x: PAD + c * (W + GAP_X), y: PAD + r * (H + GAP_Y) })));
    const width = PAD * 2 + cols.length * W + (cols.length - 1) * GAP_X;
    const height = PAD * 2 + Math.max(...cols.map((c) => c.length)) * (H + GAP_Y) - GAP_Y;
    return { pos, width, height };
  }, [topology]);

  return (
    <svg className="service-map" viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label="Service dependency map">
      {topology.services.flatMap((s) =>
        s.deps.map((d) => {
          const a = layout.pos[s.id];
          const b = layout.pos[d];
          const x1 = a.x + W;
          const y1 = a.y + H / 2;
          const x2 = b.x;
          const y2 = b.y + H / 2;
          const mx = (x1 + x2) / 2;
          return <path key={`${s.id}-${d}`} className="edge" d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} />;
        }),
      )}
      {topology.services.map((s) => {
        const p = layout.pos[s.id];
        const alerting = alerts.has(s.id);
        const seen = (['metrics', 'logs', 'traces'] as const).filter((c) => queried.has(`${c}:${s.id}`));
        return (
          <g
            key={s.id}
            className={`node ${alerting ? 'alerting' : ''} ${selected === s.id ? 'selected' : ''}`}
            transform={`translate(${p.x},${p.y})`}
            onClick={() => onSelect(s.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(s.id)}
          >
            <title>{`${s.id} (${s.kind})${alerting ? ' — ALERTING' : ''}`}</title>
            <rect width={W} height={H} rx={7} />
            <text x={10} y={17} className="node-name">
              {s.id.length > 17 ? `${s.id.slice(0, 16)}…` : s.id}
            </text>
            <text x={10} y={31} className="node-kind">
              {KIND_LABEL[s.kind]}
              {seen.length ? `  · ${seen.map((c) => c[0].toUpperCase()).join('')}` : ''}
            </text>
            {alerting && <circle className="pulse" cx={W - 12} cy={12} r={4.5} />}
          </g>
        );
      })}
    </svg>
  );
}
