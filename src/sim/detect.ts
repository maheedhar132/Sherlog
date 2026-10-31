import { ONSET } from './constants';
import type { DeployEvent, Incident, LogLine, MetricSeries, QueryKey, Span, Topology } from './types';

/**
 * Reads raw signals back into symptoms. This is how the AI "looks at" a dashboard:
 * it only ever sees what the player sees, never the hidden truth.
 */

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const window = (vals: (number | null)[], from: number, to: number) =>
  vals.slice(from, to).filter((v): v is number => v !== null);

export function detectMetrics(series: MetricSeries[]): Set<string> {
  const out = new Set<string>();
  const get = (name: string) => series.find((s) => s.name.startsWith(name))?.values;
  const latency = get('latency')!;
  if (latency.slice(ONSET).some((v) => v === null)) {
    out.add('nodata');
    return out;
  }
  const base = (v: (number | null)[]) => mean(window(v, 0, 18));
  const post = (v: (number | null)[]) => mean(window(v, ONSET + 4, v.length));

  if (post(latency) / base(latency) > 2) out.add('lat_up');
  const err = get('error')!;
  if (post(err) - base(err) > 4) out.add('err_up');
  const rps = get('requests')!;
  const rpsRatio = post(rps) / base(rps);
  if (rpsRatio > 2) out.add('rps_up');
  if (rpsRatio < 0.3) out.add('rps_drop');

  const cpu = get('cpu');
  if (cpu && post(cpu) - base(cpu) > 25 && post(cpu) > 70) out.add('cpu_up');

  const mem = get('memory');
  if (mem) {
    const tail = window(mem, ONSET - 17, mem.length);
    const diffs = tail.slice(1).map((v, i) => v - tail[i]);
    const rising = diffs.filter((d) => d > 0).length / diffs.length;
    if (rising >= 0.7 && Math.max(...tail) - Math.min(...tail) > 25) out.add('mem_climb');
    if (diffs.some((d) => d < -25)) out.add('restarts');
  }
  const hit = get('hit');
  if (hit && base(hit) - post(hit) > 20) out.add('hit_drop');
  const conns = get('connections');
  if (conns && post(conns) >= 95) out.add('conn_max');
  return out;
}

const LOG_PATTERNS: [string, RegExp][] = [
  ['log_oom', /OutOfMemoryError|OOMKilled|GC overhead/],
  ['log_pool_timeout', /timeout acquiring connection/],
  ['log_slow_query', /slow query|lock wait timeout/],
  ['log_exception', /NullPointerException|TypeError/],
  ['log_evict', /evicted \d+ keys|maxmemory/],
  ['log_cache_miss', /cache MISS/],
  ['log_retry', /retrying call/],
  ['log_overload', /queue full|load shedding/],
  ['log_dns', /ENOTFOUND|no such host/],
  ['log_upstream_timeout', /timed out after|deadline exceeded/],
  ['log_upstream_error', /returned 5\d\d|Bad Gateway/],
];

export function detectLogs(lines: LogLine[]): Set<string> {
  const out = new Set<string>();
  for (const l of lines) for (const [f, re] of LOG_PATTERNS) if (re.test(l.msg)) out.add(f);
  return out;
}

export function detectTrace(root: Span): Set<string> {
  const out = new Set<string>();
  const kids = root.children;
  const self = root.duration - kids.reduce((a, c) => a + c.duration, 0);
  if (self > 1000) out.add('tr_self_slow');
  if (root.status === 'error') out.add('tr_self_err');
  if (kids.some((c) => c.duration > 1000)) out.add('tr_dep_slow');
  if (kids.some((c) => c.status === 'error' && c.duration >= 5)) out.add('tr_dep_err');
  if (kids.some((c) => c.status === 'error' && c.duration < 5)) out.add('tr_dep_fastfail');
  if (kids.some((c) => c.attrs['cache.hit'] === 'false')) out.add('tr_cache_miss');
  const counts = new Map<string, number>();
  for (const c of kids) counts.set(c.service, (counts.get(c.service) ?? 0) + 1);
  if ([...counts.values()].some((n) => n >= 3)) out.add('tr_fanout_retry');
  return out;
}

/** Deploys within a few minutes of the alert. */
export function detectDeploys(events: DeployEvent[]): Set<string> {
  return new Set(events.filter((e) => Math.abs(e.t - ONSET) <= 4).map((e) => `dep:${e.service}`));
}

/**
 * Only customer-facing services have paging alerts: entry points (nobody calls them) and the
 * gateway's direct dependencies. You get paged on symptoms, and finding the cause is the game.
 */
export function pagingServices(t: Topology): string[] {
  const roots = t.services.filter((s) => t.callers[s.id].length === 0);
  const ids = new Set(roots.map((s) => s.id));
  for (const r of roots) if (r.kind === 'gateway') for (const d of r.deps) ids.add(d);
  return t.services.map((s) => s.id).filter((id) => ids.has(id));
}

/** The free starting view: which paging services are alerting. */
export function detectAlerts(inc: Incident): Set<string> {
  const out = new Set<string>();
  for (const id of pagingServices(inc.topology)) {
    const s = inc.topology.byId[id];
    const m = detectMetrics(inc.data.metrics[s.id]);
    if (m.has('lat_up') || m.has('err_up') || m.has('nodata')) out.add(s.id);
  }
  return out;
}

export function observe(inc: Incident, key: QueryKey): Set<string> {
  if (key === 'deploys') return detectDeploys(inc.data.deploys);
  const [channel, service] = key.split(':') as ['metrics' | 'logs' | 'traces', string];
  if (channel === 'metrics') return detectMetrics(inc.data.metrics[service]);
  if (channel === 'logs') return detectLogs(inc.data.logs[service]);
  return detectTrace(inc.data.traces[service]);
}

/**
 * Everything a player is allowed to know: the service map, which services are paging, and the dashboards
 * they pay to open. The AI is handed only this, so it cannot read the hidden root cause by construction.
 */
export interface PlayerView {
  topology: Topology;
  alerts: Set<string>;
  observe: (key: QueryKey) => Set<string>;
}

export function playerView(inc: Incident): PlayerView {
  return { topology: inc.topology, alerts: detectAlerts(inc), observe: (key) => observe(inc, key) };
}
