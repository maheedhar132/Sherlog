import { useMemo } from 'react';
import { depths } from '../sim/topology';
import type { QueryKey, ServiceKind, Topology } from '../sim/types';
import { KIND_LABEL } from './labels';

const PAD = 10;

/** Compact fits the sidebar; expanded has room for full names and larger text. */
const SIZES = {
  compact: { w: 150, h: 46, gapX: 56, gapY: 16, maxChars: 19 },
  expanded: { w: 190, h: 52, gapX: 70, gapY: 22, maxChars: 40 },
};

const KIND_LONG: Record<ServiceKind, string> = {
  gateway: 'gateway',
  app: 'service',
  db: 'database',
  cache: 'cache',
  queue: 'queue',
  worker: 'worker',
  external: 'third-party API',
};

interface Props {
  topology: Topology;
  alerts: Set<string>;
  selected: string;
  queried: Set<QueryKey>;
  onSelect: (id: string) => void;
  expanded?: boolean;
}

export function ServiceMap({ topology, alerts, selected, queried, onSelect, expanded = false }: Props) {
  const size = expanded ? SIZES.expanded : SIZES.compact;
  const { w: W, h: H, gapX, gapY } = size;

  const layout = useMemo(() => {
    const d = depths(topology);
    const cols: string[][] = [];
    for (const s of topology.services) (cols[d[s.id]] ??= []).push(s.id);
    const pos: Record<string, { x: number; y: number }> = {};
    cols.forEach((col, c) => col.forEach((id, r) => (pos[id] = { x: PAD + c * (W + gapX), y: PAD + r * (H + gapY) })));
    const width = PAD * 2 + cols.length * W + (cols.length - 1) * gapX;
    const height = PAD * 2 + Math.max(...cols.map((c) => c.length)) * (H + gapY) - gapY;
    return { pos, width, height };
  }, [topology, W, H, gapX, gapY]);

  const markerId = expanded ? 'arrow-x' : 'arrow-c';

  const svg = (
    <svg
      className={`service-map ${expanded ? 'expanded' : ''}`}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      // Expanded renders at natural size and scrolls, so text stays readable on small screens.
      style={expanded ? { width: layout.width, maxWidth: 'none' } : undefined}
      role="img"
      aria-label="Service dependency map"
    >
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth={expanded ? 7 : 6} markerHeight={expanded ? 7 : 6} orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="arrow" />
        </marker>
      </defs>
      {topology.services.flatMap((s) =>
        s.deps.map((d) => {
          const a = layout.pos[s.id];
          const b = layout.pos[d];
          const x1 = a.x + W;
          const y1 = a.y + H / 2;
          const x2 = b.x;
          const y2 = b.y + H / 2;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={`${s.id}-${d}`}
              className="edge"
              d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
              markerEnd={`url(#${markerId})`}
            />
          );
        }),
      )}
      {topology.services.map((s) => {
        const p = layout.pos[s.id];
        const alerting = alerts.has(s.id);
        const seen = (['metrics', 'logs', 'traces'] as const).filter((c) => queried.has(`${c}:${s.id}`));
        const name = s.id.length > size.maxChars ? `${s.id.slice(0, size.maxChars - 1)}…` : s.id;
        return (
          <g
            key={s.id}
            className={`node ${alerting ? 'alerting' : ''} ${selected === s.id ? 'selected' : ''}`}
            transform={`translate(${p.x},${p.y})`}
            onClick={() => onSelect(s.id)}
            role="button"
            aria-label={`${s.id}, ${KIND_LONG[s.kind]}${alerting ? ', paging' : ''}`}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(s.id);
              }
            }}
          >
            <title>{`${s.id} (${KIND_LONG[s.kind]})${alerting ? ': PAGING' : ''}`}</title>
            <rect width={W} height={H} rx={7} />
            <text x={10} y={expanded ? 22 : 20} className="node-name">
              {name}
            </text>
            <text x={10} y={expanded ? 40 : 37} className="node-kind">
              {expanded ? KIND_LONG[s.kind] : KIND_LABEL[s.kind]}
              {seen.length ? `  · ${seen.map((c) => c[0].toUpperCase()).join('')}` : ''}
            </text>
            {alerting && <circle className="pulse" cx={W - 12} cy={12} r={expanded ? 5.5 : 4.5} />}
          </g>
        );
      })}
    </svg>
  );
  return expanded ? <div className="map-scroll">{svg}</div> : svg;
}

/** The same services as a wrapping list of buttons, shown instead of the diagram on narrow screens. */
export function ServiceChips({ topology, alerts, selected, queried, onSelect }: Omit<Props, 'expanded'>) {
  return (
    <div className="service-chips" role="group" aria-label="Services">
      {topology.services.map((s) => {
        const seen = (['metrics', 'logs', 'traces'] as const)
          .filter((c) => queried.has(`${c}:${s.id}`))
          .map((c) => c[0].toUpperCase())
          .join('');
        return (
          <button
            key={s.id}
            className={`chip ${alerts.has(s.id) ? 'alerting' : ''} ${selected === s.id ? 'selected' : ''}`}
            aria-pressed={selected === s.id}
            onClick={() => onSelect(s.id)}
          >
            {alerts.has(s.id) && <i className="dot" aria-hidden="true" />}
            {s.id}
            <small>
              {KIND_LABEL[s.kind]}
              {seen ? ` · ${seen}` : ''}
            </small>
          </button>
        );
      })}
    </div>
  );
}
