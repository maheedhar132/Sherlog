import { useState, type PointerEvent } from 'react';
import { ONSET, clockLabel } from '../sim/constants';
import type { DeployEvent, LogLine, MetricSeries, Span } from '../sim/types';

// ---------------------------------------------------------------- metrics

const clock = (i: number) => clockLabel(i).slice(0, 5);
const fmtV = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v >= 100 ? Math.round(v).toString() : v.toFixed(v >= 10 ? 1 : 2));

/** A deploy or config change, drawn on every chart at the minute it landed. */
export interface ChartMarker {
  t: number;
  label: string;
}

/** SLO lines: p99 within 1.5x of normal, and at most 1% errors. */
function sloFor(s: MetricSeries): number | undefined {
  const v = s.values.filter((x): x is number => x !== null);
  if (s.name.startsWith('latency')) return (v.slice(0, 18).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(18, v.length))) * 1.5;
  if (s.name.startsWith('error')) return 1;
  return undefined;
}

interface ChartProps {
  series: MetricSeries;
  slo?: number;
  markers: ChartMarker[];
  /** Minute under the pointer, shared by every chart in the panel. */
  hover: number | null;
  onHover: (i: number | null) => void;
}

function MetricChart({ series, slo, markers, hover, onHover }: ChartProps) {
  const w = 300;
  const h = 92;
  const padL = 4;
  const vals = series.values;
  const nums = vals.filter((v): v is number => v !== null);
  const max = Math.max(1, ...nums) * 1.15;
  const x = (i: number) => padL + (i / (vals.length - 1)) * (w - padL * 2);
  const y = (v: number) => h - 6 - (v / max) * (h - 16);
  const segments: string[] = [];
  let cur = '';
  vals.forEach((v, i) => {
    if (v === null) {
      if (cur) segments.push(cur);
      cur = '';
    } else cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
  });
  if (cur) segments.push(cur);
  const last = [...vals].reverse().find((v) => v !== null);
  const firstNull = vals.findIndex((v) => v === null);
  const at = hover !== null ? vals[hover] : undefined;
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onHover(Math.max(0, Math.min(vals.length - 1, Math.round(((e.clientX - r.left) / r.width) * (vals.length - 1)))));
  };
  return (
    <figure className="metric">
      <figcaption>
        <span>{series.name}</span>
        <b>
          {hover !== null
            ? at === null || at === undefined
              ? `${clock(hover)} · no data`
              : `${clock(hover)} · ${fmtV(at)} ${series.unit}`
            : firstNull >= 0
              ? 'no data'
              : `${fmtV(last ?? 0)} ${series.unit}`}
        </b>
      </figcaption>
      <div className="plot">
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" onPointerMove={move} onPointerLeave={() => onHover(null)}>
          {firstNull >= 0 && <rect className="nodata" x={x(firstNull)} y={0} width={w - x(firstNull)} height={h} />}
          <line className="onset" x1={x(ONSET)} x2={x(ONSET)} y1={0} y2={h} />
          {slo !== undefined && slo < max && <line className="slo" x1={padL} x2={w - padL} y1={y(slo)} y2={y(slo)} />}
          {markers.map((m, i) => (
            <g key={i}>
              <path className="marker" d={`M${x(m.t)},${h - 7} l-3.5,6 l7,0 z`} />
              <title>{m.label}</title>
            </g>
          ))}
          {segments.map((d, i) => (
            <path key={i} d={d} className="line" />
          ))}
          {hover !== null && <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={0} y2={h} />}
          {hover !== null && at !== null && at !== undefined && <circle className="point" cx={x(hover)} cy={y(at)} r={3} />}
        </svg>
        <span className="ymax">{fmtV(max / 1.15)}</span>
        {slo !== undefined && slo < max && (
          <span className="slolabel" style={{ top: `${(y(slo) / h) * 100}%` }}>
            SLO
          </span>
        )}
      </div>
      <div className="xticks" aria-hidden="true">
        {[0, 15, 30, 45, 59].map((m) => (
          <span key={m}>{clock(m)}</span>
        ))}
      </div>
    </figure>
  );
}

export function MetricsPanel({ series, markers = [] }: { series: MetricSeries[]; markers?: ChartMarker[] }) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="metrics-grid">
      {series.map((s) => (
        <MetricChart key={s.name} series={s} slo={sloFor(s)} markers={markers} hover={hover} onHover={setHover} />
      ))}
      <p className="hint">
        Last 60 minutes · hover a chart to read every metric at that minute · red dashes = alert fired at {clockLabel(ONSET)} · amber dashes = SLO ·
        ▲ = a deploy or config change
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- logs

/** Log volume in three-minute buckets, so you can see when the errors started. */
function LogTimeline({ lines }: { lines: LogLine[] }) {
  const buckets = Array.from({ length: 20 }, () => ({ info: 0, bad: 0 }));
  for (const l of lines) buckets[Math.min(19, Math.floor(l.t / 3))][l.level === 'INFO' ? 'info' : 'bad']++;
  const max = Math.max(1, ...buckets.map((b) => b.info + b.bad));
  const onset = Math.floor(ONSET / 3);
  return (
    <div className="log-timeline">
      <div className="bars" role="img" aria-label="Log volume over the last hour, warnings and errors in red">
        {buckets.map((b, i) => (
          <div key={i} className={`col ${i === onset ? 'onset' : ''}`} title={`${clockLabel(i * 3).slice(0, 5)}: ${b.info} info, ${b.bad} warn or error`}>
            <i className="bad" style={{ height: `${(b.bad / max) * 100}%` }} />
            <i className="info" style={{ height: `${(b.info / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="xticks" aria-hidden="true">
        {[0, 15, 30, 45, 59].map((m) => (
          <span key={m}>{clockLabel(m).slice(0, 5)}</span>
        ))}
      </div>
    </div>
  );
}

/** Wrap each match of the filter text in a highlight. */
function highlight(msg: string, q: string) {
  if (!q) return msg;
  const parts = msg.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i'));
  return parts.map((p, i) => (p.toLowerCase() === q.toLowerCase() ? <mark key={i}>{p}</mark> : p));
}

export function LogsPanel({ lines }: { lines: LogLine[] }) {
  const [q, setQ] = useState('');
  const [problemsOnly, setProblemsOnly] = useState(false);
  const shown = lines.filter((l) => (!problemsOnly || l.level !== 'INFO') && (!q || l.msg.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="logs">
      <LogTimeline lines={lines} />
      <div className="logs-bar">
        <input placeholder="filter logs…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter logs" />
        <span className="count">
          {shown.length} of {lines.length}
        </span>
        <label>
          <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} /> WARN/ERROR only
        </label>
      </div>
      <ol className="log-lines">
        {shown.map((l, i) => (
          <li key={i} className={`lvl-${l.level}`}>
            <time>{clockLabel(l.t)}</time>
            <span className="lvl">{l.level}</span>
            <span className="msg">{highlight(l.msg, q)}</span>
          </li>
        ))}
        {!shown.length && <li className="empty">no matching lines</li>}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------- traces

export function TracePanel({ root }: { root: Span }) {
  const childTotal = root.children.reduce((a, c) => a + c.duration, 0);
  const self = root.duration - childTotal;
  const rows: { span: Span; start: number; depth: number }[] = [{ span: root, start: 0, depth: 0 }];
  let t = self * 0.6;
  for (const c of root.children) {
    rows.push({ span: c, start: t, depth: 1 });
    t += c.duration;
  }
  const total = Math.max(root.duration, 1);
  const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${v.toFixed(v < 10 ? 1 : 0)}ms`);
  return (
    <div className="trace">
      <p className="hint">
        Sample request through <b>{root.service}</b> · total {ms(root.duration)} · own time {ms(self)}
      </p>
      {rows.map(({ span, start, depth }, i) => (
        <div key={i} className={`span-row ${span.status === 'error' ? 'err' : ''}`}>
          <div className="span-label" style={{ paddingLeft: depth * 14 }}>
            <b>{span.service}</b> <span>{span.op}</span>
            {Object.entries(span.attrs).map(([k, v]) => (
              <code key={k}>
                {k}={v}
              </code>
            ))}
          </div>
          <div className="span-track">
            <div className="span-bar" style={{ left: `${(start / total) * 100}%`, width: `${Math.max(0.6, (span.duration / total) * 100)}%` }} />
            <span className="span-ms">{ms(span.duration)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- deploys

export function DeploysPanel({ events }: { events: DeployEvent[] }) {
  const rows = [...events.map((e) => ({ t: e.t, e })), { t: ONSET, e: null }].sort((a, b) => a.t - b.t);
  return (
    <table className="deploys">
      <thead>
        <tr>
          <th>time</th>
          <th>vs alert</th>
          <th>type</th>
          <th>service</th>
          <th>change</th>
          <th>by</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ t, e }, i) =>
          e ? (
            <tr key={i}>
              <td>{clockLabel(t)}</td>
              <td>{`${t < ONSET ? '-' : '+'}${Math.abs(ONSET - t).toFixed(1)}m`}</td>
              <td>{e.kind === 'config' ? 'config' : 'deploy'}</td>
              <td>{e.service}</td>
              <td>{e.version}</td>
              <td>{e.author}</td>
            </tr>
          ) : (
            <tr key={i} className="alert-row">
              <td>{clockLabel(t)}</td>
              <td colSpan={5}>🔔 alert fired</td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}
