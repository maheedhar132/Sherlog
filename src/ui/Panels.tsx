import { useState } from 'react';
import { ONSET, clockLabel } from '../sim/constants';
import type { DeployEvent, LogLine, MetricSeries, Span } from '../sim/types';

// ---------------------------------------------------------------- metrics

function MetricChart({ series }: { series: MetricSeries }) {
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
  const fmtV = (v: number) => (v >= 100 ? Math.round(v).toString() : v.toFixed(v >= 10 ? 1 : 2));
  return (
    <figure className="metric">
      <figcaption>
        <span>{series.name}</span>
        <b>{firstNull >= 0 ? 'no data' : `${fmtV(last ?? 0)} ${series.unit}`}</b>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {firstNull >= 0 && <rect className="nodata" x={x(firstNull)} y={0} width={w - x(firstNull)} height={h} />}
        <line className="onset" x1={x(ONSET)} x2={x(ONSET)} y1={0} y2={h} />
        {segments.map((d, i) => (
          <path key={i} d={d} className="line" />
        ))}
        <text className="axis" x={w - 4} y={10} textAnchor="end">
          {fmtV(max / 1.15)}
        </text>
      </svg>
    </figure>
  );
}

export function MetricsPanel({ series }: { series: MetricSeries[] }) {
  return (
    <div className="metrics-grid">
      {series.map((s) => (
        <MetricChart key={s.name} series={s} />
      ))}
      <p className="hint">Last 60 minutes · dashed line = alert fired at {clockLabel(ONSET)}</p>
    </div>
  );
}

// ---------------------------------------------------------------- logs

export function LogsPanel({ lines }: { lines: LogLine[] }) {
  const [q, setQ] = useState('');
  const [problemsOnly, setProblemsOnly] = useState(false);
  const shown = lines.filter((l) => (!problemsOnly || l.level !== 'INFO') && (!q || l.msg.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="logs">
      <div className="logs-bar">
        <input placeholder="filter logs…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter logs" />
        <label>
          <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} /> WARN/ERROR only
        </label>
      </div>
      <ol className="log-lines">
        {shown.map((l, i) => (
          <li key={i} className={`lvl-${l.level}`}>
            <time>{clockLabel(l.t)}</time>
            <span className="lvl">{l.level}</span>
            <span className="msg">{l.msg}</span>
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
          <th>service</th>
          <th>version</th>
          <th>by</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ t, e }, i) =>
          e ? (
            <tr key={i}>
              <td>{clockLabel(t)}</td>
              <td>{`${t < ONSET ? '-' : '+'}${Math.abs(ONSET - t).toFixed(1)}m`}</td>
              <td>{e.service}</td>
              <td>{e.version}</td>
              <td>{e.author}</td>
            </tr>
          ) : (
            <tr key={i} className="alert-row">
              <td>{clockLabel(t)}</td>
              <td colSpan={4}>🔔 alert fired</td>
            </tr>
          ),
        )}
      </tbody>
    </table>
  );
}
