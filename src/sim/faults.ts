import { addFx } from './effects';
import type { FaultId, Fx, ServiceKind, Topology } from './types';

export interface FaultDef {
  id: FaultId;
  name: string;
  /** One-line description for pickers. */
  short: string;
  targets: ServiceKind[];
  /** What actually happened, for the postmortem. */
  story: (service: string) => string;
  /** The signals that give it away; this is the field guide. */
  signals: string[];
  tip: string;
  applies?: (t: Topology, service: string) => boolean;
  effects: (t: Topology, service: string, fx: Fx) => void;
}

export const FAULTS: Record<FaultId, FaultDef> = {
  memory_leak: {
    id: 'memory_leak',
    name: 'Memory leak',
    short: 'Heap grows until the process is OOM-killed',
    targets: ['app', 'worker'],
    story: (s) =>
      `A code path in ${s} kept references to request objects. Heap usage climbed for ~20 minutes, GC pauses got longer, and the container was repeatedly OOM-killed. Every restart dropped in-flight requests.`,
    signals: [
      'Memory climbs steadily, then drops sharply on each restart (saw-tooth)',
      'OutOfMemoryError / OOMKilled / GC overhead in its own logs',
      "Its own span time is slow (GC pauses), not its dependencies'",
    ],
    tip: 'Saw-tooth memory means a leak. Blame the service whose own span is slow, not the callers waiting on it.',
    effects: (_t, s, fx) => {
      addFx(fx, s, 'metrics', 'mem_climb', 'restarts', 'lat_up', 'err_up');
      addFx(fx, s, 'logs', 'log_oom');
      addFx(fx, s, 'traces', 'tr_self_slow');
    },
  },

  db_pool: {
    id: 'db_pool',
    name: 'Database saturation',
    short: 'Slow queries pin every connection in the pool',
    targets: ['db'],
    story: (s) =>
      `A query on ${s} lost its index and started doing sequential scans. Each one held a connection for seconds, the connection pool hit its maximum, and every caller queued up waiting for a connection.`,
    signals: [
      'DB connections pinned at the pool maximum',
      'Slow query / lock wait messages in the database logs',
      "Several callers log 'timeout acquiring connection'",
    ],
    tip: 'When many callers time out on the same database, the database is the suspect, not the callers.',
    effects: (t, s, fx) => {
      addFx(fx, s, 'metrics', 'cpu_up', 'conn_max', 'lat_up');
      addFx(fx, s, 'logs', 'log_slow_query');
      addFx(fx, s, 'traces', 'tr_self_slow');
      for (const c of t.callers[s]) {
        addFx(fx, c, 'logs', 'log_pool_timeout');
        addFx(fx, c, 'metrics', 'err_up');
      }
    },
  },

  bad_deploy: {
    id: 'bad_deploy',
    name: 'Bad deploy',
    short: 'A new release throws errors on a common path',
    targets: ['app', 'worker'],
    story: (s) =>
      `A new version of ${s} shipped with a null-handling bug on a hot code path. Errors started the minute the deploy finished, while latency stayed normal: the code failed fast.`,
    signals: [
      'A deploy lands right before the alert fires',
      'Error rate jumps but its latency stays normal',
      'Stack traces (NullPointerException / TypeError) in its logs; its own span errors',
    ],
    tip: 'Always check what changed first, then confirm the change actually lines up with the errors. Coincidental deploys happen.',
    effects: (_t, s, fx) => {
      addFx(fx, s, 'metrics', 'err_up');
      addFx(fx, s, 'logs', 'log_exception');
      addFx(fx, s, 'traces', 'tr_self_err');
      fx.deploys.add(s);
    },
  },

  cache_stampede: {
    id: 'cache_stampede',
    name: 'Cache stampede',
    short: 'Cache evicts its hot keys and the database gets hammered',
    targets: ['cache'],
    story: (s) =>
      `${s} hit its memory limit and evicted most hot keys at once. Every cache lookup became a miss, all that traffic fell through to the database, and the database slowed down for everyone.`,
    signals: [
      'Cache hit ratio collapses',
      'Mass key eviction / maxmemory in the cache logs',
      'Callers log cache MISS while the database suddenly gets far more traffic',
    ],
    tip: 'A hot database can be a victim. Ask why traffic to it suddenly jumped.',
    applies: (t, s) => t.callers[s].length > 0,
    effects: (t, s, fx) => {
      addFx(fx, s, 'metrics', 'hit_drop', 'cpu_up');
      addFx(fx, s, 'logs', 'log_evict');
      for (const c of t.callers[s]) {
        addFx(fx, c, 'logs', 'log_cache_miss');
        addFx(fx, c, 'traces', 'tr_cache_miss');
        for (const d of t.byId[c].deps) if (t.byId[d].kind === 'db') addFx(fx, d, 'metrics', 'rps_up', 'cpu_up', 'lat_up');
      }
    },
  },

  retry_storm: {
    id: 'retry_storm',
    name: 'Retry storm',
    short: 'Aggressive retries multiply traffic and flatten a dependency',
    targets: ['app'],
    story: (s) =>
      `A config change gave ${s} three immediate retries with no backoff. One slow response turned into 3× the traffic, which overloaded its dependencies, which made more calls slow, which caused more retries.`,
    signals: [
      'One service logs aggressive retries ("attempt 3/3")',
      'Its traces show the same downstream call repeated 3×',
      'The overloaded dependency is the victim: request rate jumps, it sheds load (queue full / 503)',
    ],
    tip: 'The service on fire is often not the culprit. Find who is multiplying the traffic.',
    applies: (t, s) => t.byId[s].deps.some((d) => ['app', 'db'].includes(t.byId[d].kind)),
    effects: (t, s, fx) => {
      addFx(fx, s, 'logs', 'log_retry');
      addFx(fx, s, 'traces', 'tr_fanout_retry');
      for (const d of t.byId[s].deps) {
        if (!['app', 'db'].includes(t.byId[d].kind)) continue;
        addFx(fx, d, 'metrics', 'rps_up', 'cpu_up', 'lat_up', 'err_up');
        addFx(fx, d, 'logs', 'log_overload');
      }
    },
  },

  dns_failure: {
    id: 'dns_failure',
    name: 'DNS failure',
    short: "A service's name stops resolving, so calls to it fail instantly",
    targets: ['external', 'app'],
    story: (s) =>
      `The DNS record for ${s} was removed during a cleanup. Callers could no longer resolve its name, so every call failed instantly with ENOTFOUND, even though ${s} itself was perfectly healthy.`,
    signals: [
      'Callers fail instantly with ENOTFOUND / "no such host"',
      'Errors go up but latency does not (fast failures)',
      'The target shows no data, or its traffic drops to zero',
    ],
    tip: 'Fast failures plus no traffic reaching a service means it cannot be resolved or reached.',
    applies: (t, s) => t.callers[s].length > 0,
    effects: (t, s, fx) => {
      if (t.byId[s].kind === 'external') {
        addFx(fx, s, 'metrics', 'nodata');
        addFx(fx, s, 'logs', 'log_dns');
      } else {
        addFx(fx, s, 'metrics', 'rps_drop');
      }
      for (const c of t.callers[s]) {
        addFx(fx, c, 'metrics', 'err_up');
        addFx(fx, c, 'logs', 'log_dns');
        addFx(fx, c, 'traces', 'tr_dep_fastfail');
      }
    },
  },
};

export const FAULT_IDS = Object.keys(FAULTS) as FaultId[];

export function isCompatible(t: Topology, service: string, fault: FaultId): boolean {
  const def = FAULTS[fault];
  return def.targets.includes(t.byId[service].kind) && (def.applies?.(t, service) ?? true);
}
