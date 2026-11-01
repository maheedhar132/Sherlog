import { between, gaussian, pick, randInt, shuffle, type Rng } from '../lib/rng';
import { MINUTES, ONSET } from './constants';
import type { DeployEvent, Fx, IncidentData, LogLevel, LogLine, MetricSeries, Service, ServiceKind, Span, Topology } from './types';

const ramp = (t: number) => Math.max(0, Math.min(1, (t - ONSET) / 3));
const round = (v: number) => Math.round(v * 100) / 100;

const BASE: Record<ServiceKind, { lat: [number, number]; rps: [number, number]; span: [number, number] }> = {
  gateway: { lat: [60, 90], rps: [800, 1200], span: [3, 8] },
  app: { lat: [30, 110], rps: [80, 400], span: [5, 40] },
  db: { lat: [4, 12], rps: [300, 900], span: [2, 12] },
  cache: { lat: [0.8, 2], rps: [600, 1500], span: [0.3, 1.5] },
  queue: { lat: [2, 5], rps: [50, 200], span: [1, 4] },
  worker: { lat: [150, 300], rps: [10, 40], span: [10, 50] },
  external: { lat: [120, 220], rps: [20, 80], span: [80, 200] },
};

// ---------------------------------------------------------------- metrics

export function renderMetrics(rng: Rng, s: Service, m: Set<string>): MetricSeries[] {
  const b = BASE[s.kind];
  const nodata = m.has('nodata');
  const gen = (f: (t: number) => number): (number | null)[] =>
    Array.from({ length: MINUTES }, (_, t) => (nodata && t >= ONSET ? null : round(f(t))));

  const latBase = between(rng, ...b.lat);
  const latK = between(rng, 3.5, 6);
  const latency = gen((t) => latBase * (1 + (m.has('lat_up') ? ramp(t) * (latK - 1) : 0)) * (1 + 0.05 * gaussian(rng)));

  const errBase = between(rng, 0.1, 0.6);
  const errAdd = between(rng, 9, 25);
  const errors = gen((t) => Math.max(0, errBase * (1 + 0.2 * gaussian(rng)) + (m.has('err_up') ? ramp(t) * errAdd : 0)));

  const rpsBase = between(rng, ...b.rps);
  const rpsK = m.has('rps_up') ? between(rng, 3, 6) : m.has('rps_drop') ? 0.02 : 1;
  const rps = gen((t) => rpsBase * (1 + ramp(t) * (rpsK - 1)) * (1 + 0.04 * gaussian(rng)));

  const series: MetricSeries[] = [
    { name: 'latency p99', unit: 'ms', values: latency },
    { name: 'error rate', unit: '%', values: errors },
    { name: 'requests', unit: 'req/s', values: rps },
  ];
  if (s.kind === 'external') return series;

  const cpuBase = between(rng, 18, 45);
  const cpuTop = between(rng, 86, 97);
  series.push({
    name: 'cpu',
    unit: '%',
    values: gen((t) => Math.min(100, (m.has('cpu_up') ? cpuBase + ramp(t) * (cpuTop - cpuBase) : cpuBase) + 2 * gaussian(rng))),
  });

  // Memory: a leak starts ~20 minutes before anyone notices and restarts the process whenever it hits the limit.
  const memBase = between(rng, 38, 55);
  const leakStart = ONSET - 20;
  const rate = (94 - memBase) / randInt(rng, 12, 16);
  let mem = memBase;
  series.push({
    name: 'memory',
    unit: '%',
    values: gen((t) => {
      if (m.has('mem_climb') && t >= leakStart) {
        mem += rate;
        if (mem >= 94) mem = memBase + 2;
      }
      return mem + 0.4 * gaussian(rng);
    }),
  });

  if (s.kind === 'cache') {
    const hitBase = between(rng, 90, 97);
    const hitLow = between(rng, 30, 50);
    series.push({
      name: 'hit ratio',
      unit: '%',
      values: gen((t) => (m.has('hit_drop') ? hitBase - ramp(t) * (hitBase - hitLow) : hitBase) + gaussian(rng)),
    });
  }
  if (s.kind === 'db') {
    const connBase = between(rng, 15, 40);
    series.push({
      name: 'connections (max 100)',
      unit: 'conns',
      values: gen((t) => Math.min(100, (m.has('conn_max') ? connBase + ramp(t) * (100 - connBase) : connBase) + 1.5 * gaussian(rng))),
    });
  }
  if (s.kind === 'db' || s.kind === 'worker') {
    const diskBase = between(rng, 38, 62);
    series.push({
      name: 'disk used',
      unit: '%',
      values: gen((t) => {
        const fill = Math.max(0, Math.min(1, (t - (ONSET - 18)) / 20));
        const level = m.has('disk_full') ? diskBase + fill * (100 - diskBase) : diskBase + t * 0.02;
        return Math.min(100, level + 0.3 * gaussian(rng));
      }),
    });
  }
  if (s.kind === 'queue') {
    const lagBase = between(rng, 0, 40);
    const lagRate = between(rng, 300, 800);
    series.push({
      name: 'consumer lag',
      unit: 'msgs',
      values: gen((t) => Math.max(0, lagBase * (1 + 0.3 * gaussian(rng)) + (m.has('lag_up') ? Math.max(0, t - ONSET) * lagRate : 0))),
    });
  }
  return series;
}

// ---------------------------------------------------------------- logs

const PATHS = ['products', 'cart', 'orders', 'users/me', 'search?q=boots', 'prices', 'session', 'recommendations'];
const TABLES = ['orders', 'users', 'line_items', 'sessions', 'products'];
const ip = (rng: Rng) => `10.0.${randInt(rng, 0, 9)}.${randInt(rng, 2, 250)}`;

const BENIGN: Record<ServiceKind, ((rng: Rng) => [LogLevel, string])[]> = {
  gateway: [
    (r) => ['INFO', `GET /api/v1/${pick(r, PATHS)} 200 ${randInt(r, 20, 140)}ms`],
    (r) => ['INFO', `TLS handshake ok client=${ip(r)}`],
    () => ['INFO', 'route table reloaded (no changes)'],
  ],
  app: [
    (r) => ['INFO', `GET /v1/${pick(r, PATHS)} 200 ${randInt(r, 8, 120)}ms`],
    (r) => ['INFO', `POST /v1/${pick(r, PATHS)} 201 ${randInt(r, 15, 160)}ms`],
    () => ['INFO', 'health check passed'],
    () => ['INFO', 'feature flag cache refreshed'],
    (r) => ['WARN', `GC pause ${randInt(r, 20, 60)}ms (young gen)`],
    (r) => ['WARN', `deprecated config key "http.legacyMode" (used ${randInt(r, 2, 9)} times)`],
  ],
  db: [
    (r) => ['INFO', `checkpoint complete: wrote ${randInt(r, 200, 4000)} buffers`],
    (r) => ['INFO', `autovacuum: processing table "${pick(r, TABLES)}"`],
    () => ['INFO', 'connection authorized: user=app database=prod'],
  ],
  cache: [
    () => ['INFO', 'Background saving started'],
    () => ['INFO', 'DB saved on disk'],
    (r) => ['INFO', `Accepted connection from ${ip(r)}`],
  ],
  queue: [
    () => ['INFO', 'partition rebalance complete'],
    () => ['INFO', 'segment rolled for topic "events"'],
  ],
  worker: [
    (r) => ['INFO', `processed batch of ${randInt(r, 20, 400)} jobs in ${randInt(r, 100, 900)}ms`],
    (r) => ['INFO', `polling events-queue (lag=${randInt(r, 0, 40)})`],
  ],
  external: [
    (r) => ['INFO', `synthetic probe ok (${randInt(r, 90, 230)}ms)`],
    () => ['INFO', 'synthetic probe: TLS certificate valid for 61 days'],
  ],
};

type Ctx = { t: Topology; fx: Fx; s: Service; rng: Rng };

/** Name of the dependency whose metrics match `pred`, else any dependency. */
function depWhere({ t, fx, s, rng }: Ctx, pred: (m: Set<string>) => boolean): string {
  const hits = s.deps.filter((d) => pred(fx.services[d].metrics));
  if (hits.length) return pick(rng, hits);
  return s.deps.length ? pick(rng, s.deps) : pick(rng, t.services.filter((x) => x.id !== s.id)).id;
}

const FEATURE_LOGS: Record<string, (c: Ctx) => [LogLevel, string]> = {
  log_oom: ({ rng }) =>
    pick(rng, [
      ['ERROR', 'java.lang.OutOfMemoryError: Java heap space'],
      ['ERROR', 'container killed: OOMKilled (exit code 137), restarting'],
      ['WARN', 'GC overhead limit exceeded: 97% of time spent in GC'],
    ] as [LogLevel, string][]),
  log_pool_timeout: (c) => ['ERROR', `db pool: timeout acquiring connection to ${depWhere(c, (m) => m.has('conn_max'))} after 30000ms (active=100/100)`],
  log_slow_query: ({ rng }) =>
    pick(rng, [
      ['WARN', `slow query ${between(rng, 8, 19).toFixed(1)}s: SELECT * FROM ${pick(rng, TABLES)} WHERE status = $1 (seq scan)`],
      ['ERROR', 'lock wait timeout exceeded; try restarting transaction'],
    ] as [LogLevel, string][]),
  log_exception: ({ rng }) =>
    pick(rng, [
      ['ERROR', 'NullPointerException at PriceCalculator.apply(PriceCalculator.java:88)'],
      ['ERROR', "500 Internal Server Error: TypeError: cannot read properties of undefined (reading 'currency')"],
    ] as [LogLevel, string][]),
  log_evict: ({ rng }) =>
    pick(rng, [
      ['WARN', `evicted ${randInt(rng, 80000, 400000)} keys (maxmemory reached, policy=allkeys-lru)`],
      ['WARN', 'maxmemory limit reached: evicting hot keys'],
    ] as [LogLevel, string][]),
  log_cache_miss: (c) => ['WARN', `cache MISS for product:${randInt(c.rng, 1000, 9999)}, falling back to database`],
  log_retry: (c) => ['WARN', `retrying call to ${depWhere(c, (m) => m.has('rps_up'))} (attempt 3/3) after 200ms timeout`],
  log_overload: ({ rng }) =>
    pick(rng, [
      ['ERROR', 'rejecting request: worker queue full (1024/1024)'],
      ['WARN', 'load shedding active: returning 503 Service Unavailable'],
    ] as [LogLevel, string][]),
  log_zone: ({ rng }) => ['WARN', `health check failed for ${randInt(rng, 2, 4)} of 6 instances in zone ${pick(rng, ['us-east-1b', 'us-east-1c', 'eu-west-1a'])}, removing from rotation`],
  log_ratelimit: (c) => {
    const target = c.s.deps.find((d) => c.t.byId[d].kind === 'external') ?? c.s.deps[0];
    return ['WARN', `429 Too Many Requests from ${target} (retry-after 30s)`];
  },
  log_tls: (c) => ['ERROR', `tls: handshake with ${depWhere(c, (m) => m.has('rps_drop'))} failed: x509: certificate has expired or is not yet valid`],
  log_disk: ({ rng }) =>
    pick(rng, [
      ['ERROR', 'write failed: No space left on device (errno 28)'],
      ['ERROR', `could not extend file "base/16384/${randInt(rng, 1000, 9999)}": No space left on device`],
    ] as [LogLevel, string][]),
  log_gc: ({ rng }) => ['WARN', `GC pause ${randInt(rng, 18, 38) / 10}s (stop-the-world), heap ${randInt(rng, 91, 97)}% used after collection`],
  log_clock: ({ rng }) => ['ERROR', `token rejected: issued in the future (clock skew ${randInt(rng, 40, 140)}s)`],
  log_lock: ({ rng }) =>
    pick(rng, [
      ['WARN', `process waiting for ExclusiveLock on relation "orders" for ${randInt(rng, 20, 90)}s`],
      ['ERROR', 'deadlock detected while updating relation "orders"'],
    ] as [LogLevel, string][]),
  log_cron: ({ rng }) => ['INFO', `cron job "${pick(rng, ['nightly-reindex', 'rebuild-search', 'recompute-stats'])}" started (concurrency unlimited)`],
  log_config: ({ rng }) => ['WARN', `config change applied: flag "${pick(rng, ['new-pricing', 'fast-checkout', 'v2-search', 'promo-banner'])}" set to on by ${pick(rng, AUTHORS)}`],
  log_poison: ({ rng }) => ['ERROR', `failed to process message offset=${randInt(rng, 100000, 999999)} (attempt 5/5), will retry: invalid payload`],
  log_dns: (c) => {
    const target = c.s.kind === 'external' ? c.s.id : depWhere(c, (m) => m.has('nodata') || m.has('rps_drop'));
    return pick(c.rng, [
      ['ERROR', `getaddrinfo ENOTFOUND ${target}.internal`],
      ['ERROR', `dial tcp: lookup ${target}: no such host`],
    ] as [LogLevel, string][]);
  },
  log_upstream_timeout: (c) => {
    const d = depWhere(c, (m) => m.has('lat_up'));
    return pick(c.rng, [
      ['WARN', `upstream ${d} timed out after 5000ms`],
      ['ERROR', `context deadline exceeded calling ${d}`],
    ] as [LogLevel, string][]);
  },
  log_upstream_error: (c) => {
    const d = depWhere(c, (m) => m.has('err_up'));
    return pick(c.rng, [
      ['ERROR', `upstream ${d} returned 500`],
      ['ERROR', `502 Bad Gateway from ${d}`],
    ] as [LogLevel, string][]);
  },
};

export function renderLogs(rng: Rng, t: Topology, fx: Fx, s: Service): LogLine[] {
  const lines: LogLine[] = [];
  const benign = BENIGN[s.kind];
  for (let i = randInt(rng, 9, 14); i > 0; i--) {
    const [level, msg] = pick(rng, benign)(rng);
    lines.push({ t: rng() * MINUTES, level, service: s.id, msg });
  }
  const ctx: Ctx = { t, fx, s, rng };
  for (const f of fx.services[s.id].logs) {
    const from = f === 'log_oom' ? ONSET - 15 : ONSET;
    for (let i = randInt(rng, 3, 6); i > 0; i--) {
      const [level, msg] = FEATURE_LOGS[f](ctx);
      lines.push({ t: from + rng() * (MINUTES - from), level, service: s.id, msg });
    }
  }
  return lines.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------- traces

const OPS: Record<ServiceKind, (rng: Rng) => string> = {
  gateway: (r) => `HTTP GET /api/v1/${pick(r, PATHS)}`,
  app: (r) => `${pick(r, ['GET', 'POST'])} /v1/${pick(r, PATHS)}`,
  db: (r) => `SELECT ${pick(r, TABLES)}`,
  cache: (r) => `GET product:${randInt(r, 1000, 9999)}`,
  queue: () => 'publish events',
  worker: () => 'process job',
  external: () => 'POST /v1/request',
};

export function renderTrace(rng: Rng, t: Topology, fx: Fx, s: Service): Span {
  const tr = fx.services[s.id].traces;
  const kids = s.deps.map((d) => t.byId[d]);
  const metr = (id: string) => fx.services[id].metrics;
  const select = (feature: string, pred: (k: Service) => boolean): Set<string> => {
    if (!tr.has(feature)) return new Set();
    const hits = kids.filter(pred);
    return new Set((hits.length ? hits : kids.slice(0, 1)).map((k) => k.id));
  };
  const slow = select('tr_dep_slow', (k) => metr(k.id).has('lat_up'));
  const err = select('tr_dep_err', (k) => metr(k.id).has('err_up'));
  const fastfail = select('tr_dep_fastfail', (k) => metr(k.id).has('nodata') || metr(k.id).has('rps_drop'));
  const retry = select('tr_fanout_retry', (k) => metr(k.id).has('lat_up'));
  const miss = tr.has('tr_cache_miss');

  const children: Span[] = [];
  for (const k of kids) {
    const op = OPS[k.kind](rng);
    if (fastfail.has(k.id)) {
      children.push({ service: k.id, op, duration: round(between(rng, 0.4, 2)), status: 'error', attrs: { error: `ENOTFOUND ${k.id}` }, children: [] });
      continue;
    }
    let duration = between(rng, ...BASE[k.kind].span);
    const attrs: Record<string, string> = {};
    let status: Span['status'] = 'ok';
    if (slow.has(k.id)) duration = between(rng, 1800, 4500);
    if (err.has(k.id)) {
      status = 'error';
      attrs['http.status'] = '500';
      duration = Math.max(duration, 12);
    }
    if (k.kind === 'cache') attrs['cache.hit'] = miss ? 'false' : 'true';
    const reps = retry.has(k.id) ? 3 : 1;
    for (let r = 0; r < reps; r++) {
      children.push({
        service: k.id,
        op,
        duration: round(duration * (1 + 0.1 * rng())),
        status,
        attrs: reps > 1 ? { ...attrs, 'retry.attempt': String(r + 1) } : attrs,
        children: [],
      });
    }
  }

  const attrs: Record<string, string> = {};
  let self = between(rng, ...BASE[s.kind].span);
  if (tr.has('tr_self_slow')) {
    self += between(rng, 1500, 3500);
    // A span tag should only point at the cause that is real: a GC pause only when memory is climbing, a query plan only for a saturated database.
    const own = fx.services[s.id].metrics;
    if (s.kind === 'db' && own.has('conn_max')) attrs['db.plan'] = 'Seq Scan (rows=4.2M)';
    else if (s.kind === 'external') attrs['net.peer.rtt_ms'] = String(Math.round(self));
    else if (own.has('mem_climb')) attrs['runtime.gc_pause_ms'] = String(Math.round(self * 0.8));
    else attrs['span.self_ms'] = String(Math.round(self));
  }
  let status: Span['status'] = 'ok';
  if (tr.has('tr_self_err')) {
    status = 'error';
    attrs.exception = 'NullPointerException';
  }
  const childTotal = children.reduce((a, c) => a + c.duration, 0);
  return { service: s.id, op: OPS[s.kind](rng), duration: round(self + childTotal), status, attrs, children };
}

// ---------------------------------------------------------------- deploys

const AUTHORS = ['release-bot', 'ci-pipeline', 'dev-ana', 'dev-kenji', 'dev-omar', 'dev-priya'];
const version = (rng: Rng) => `v${randInt(rng, 1, 4)}.${randInt(rng, 0, 30)}.${randInt(rng, 0, 9)}`;

export function renderDeploys(rng: Rng, t: Topology, fx: Fx): DeployEvent[] {
  const events: DeployEvent[] = [];
  const deployable = t.services.filter((s) => s.kind === 'app' || s.kind === 'worker' || s.kind === 'gateway');
  for (const s of shuffle(rng, deployable).slice(0, randInt(rng, 1, 3))) {
    if (fx.deploys.has(s.id)) continue;
    events.push({ t: between(rng, 3, 26), service: s.id, version: version(rng), author: pick(rng, AUTHORS) });
  }
  for (const id of fx.deploys) events.push({ t: ONSET - between(rng, 0.5, 2.5), service: id, version: version(rng), author: pick(rng, AUTHORS) });
  for (const id of fx.configs) {
    const flag = pick(rng, ['new-pricing', 'fast-checkout', 'v2-search', 'promo-banner']);
    events.push({ t: ONSET - between(rng, 0.5, 2.5), service: id, version: `flag ${flag}=on`, author: pick(rng, AUTHORS), kind: 'config' });
  }
  return events.sort((a, b) => a.t - b.t);
}

export function renderAll(rng: Rng, t: Topology, fx: Fx): IncidentData {
  const data: IncidentData = { metrics: {}, logs: {}, traces: {}, deploys: [] };
  for (const s of t.services) {
    data.metrics[s.id] = renderMetrics(rng, s, fx.services[s.id].metrics);
    data.logs[s.id] = renderLogs(rng, t, fx, s);
    data.traces[s.id] = renderTrace(rng, t, fx, s);
  }
  data.deploys = renderDeploys(rng, t, fx);
  return data;
}
