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
      `${s}'s client was set to make three immediate retries with no backoff. One slow response turned into 3× the traffic, which overloaded its dependencies, which made more calls slow, which caused more retries.`,
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
  thread_pool: {
    id: 'thread_pool',
    name: 'Thread pool exhaustion',
    short: 'Every request thread is blocked, so work queues up',
    targets: ['app'],
    story: (s) =>
      `${s} made a blocking call inside its request threads. Slow responses held every thread, the pool filled up, and new requests queued and timed out, while CPU and memory looked normal.`,
    signals: [
      'Latency and errors climb, but CPU and memory stay flat',
      'It sheds load: "queue full" / "load shedding" in its own logs',
      'Its own span is slow, with no memory or restart pattern',
    ],
    tip: 'High latency with low CPU points at blocked threads, not at load.',
    effects: (_t, s, fx) => {
      addFx(fx, s, 'metrics', 'lat_up', 'err_up');
      addFx(fx, s, 'logs', 'log_overload');
      addFx(fx, s, 'traces', 'tr_self_slow');
    },
  },

  slow_third_party: {
    id: 'slow_third_party',
    name: 'Slow third-party API',
    short: 'A vendor API gets slow and drags every caller down',
    targets: ['external'],
    story: (s) =>
      `${s}, a third-party API, started answering in seconds instead of milliseconds. Every service calling it waited on it, so latency rose all the way up the call chain even though nothing in your own systems had changed.`,
    signals: [
      "The third-party API's own latency climbs while its error rate stays low",
      'Callers log upstream timeouts',
      'Traces show the slow span sitting on the external call',
    ],
    tip: 'When the slow span is outside your boundary, the fix is a timeout and a fallback, not a restart.',
    applies: (t, s) => t.callers[s].length > 0,
    effects: (_t, s, fx) => {
      addFx(fx, s, 'metrics', 'lat_up');
      addFx(fx, s, 'traces', 'tr_self_slow');
    },
  },

  certificate_expiry: {
    id: 'certificate_expiry',
    name: 'Certificate expiry',
    short: 'An expired TLS certificate makes every connection fail instantly',
    targets: ['external', 'app'],
    story: (s) =>
      `The TLS certificate for ${s} expired. Callers' handshakes failed immediately, so errors shot up while latency stayed normal and no traffic reached ${s}.`,
    signals: [
      'Callers fail instantly: errors up, latency flat',
      'x509 / "certificate has expired" in the callers\' logs',
      'Traffic to the target drops to about zero',
    ],
    tip: 'Instant failures plus an x509 error is a certificate, not the network. DNS failures look the same until you read the log line.',
    applies: (t, s) => t.callers[s].length > 0,
    effects: (t, s, fx) => {
      addFx(fx, s, 'metrics', 'rps_drop');
      for (const c of t.callers[s]) {
        addFx(fx, c, 'metrics', 'err_up');
        addFx(fx, c, 'logs', 'log_tls');
        addFx(fx, c, 'traces', 'tr_dep_fastfail');
      }
    },
  },

  disk_full: {
    id: 'disk_full',
    name: 'Disk full',
    short: 'The disk fills up and every write fails',
    targets: ['db', 'worker'],
    story: (s) =>
      `The data volume on ${s} filled up because logs and temp files were never rotated. Writes started failing with "no space left on device", so everything depending on it began to error.`,
    signals: [
      'Disk usage pinned at 100%',
      '"No space left on device" in its own logs',
      'Errors on it and on its callers, with CPU and memory looking normal',
    ],
    tip: 'Saturation is not only CPU and memory: disks, connections and queues fill up too.',
    effects: (_t, s, fx) => {
      addFx(fx, s, 'metrics', 'disk_full', 'err_up');
      addFx(fx, s, 'logs', 'log_disk');
      addFx(fx, s, 'traces', 'tr_self_err');
    },
  },

  poison_message: {
    id: 'poison_message',
    name: 'Stuck consumer (poison message)',
    short: 'One bad message crash-loops the consumer and the queue backs up',
    targets: ['worker'],
    story: (s) =>
      `A malformed message made ${s} fail every time it retried. The consumer stopped making progress and the queue backed up. Nothing user-facing paged, because the work is asynchronous.`,
    signals: [
      "The queue's consumer lag climbs steadily",
      "The worker stops processing: its request rate drops to about zero",
      '"Failed to process message" repeated in the worker\'s logs, with little or no customer-facing alert',
    ],
    tip: "Asynchronous failures often page nobody. Look at queue depth and consumer lag, not only at user-facing latency.",
    effects: (t, s, fx) => {
      addFx(fx, s, 'metrics', 'rps_drop');
      addFx(fx, s, 'logs', 'log_poison', 'log_exception');
      addFx(fx, s, 'traces', 'tr_self_err');
      for (const d of t.byId[s].deps) if (t.byId[d].kind === 'queue') addFx(fx, d, 'metrics', 'lag_up');
    },
  },

  config_flag: {
    id: 'config_flag',
    name: 'Bad config or feature flag',
    short: 'A flag flip breaks a hot code path with no deploy at all',
    targets: ['app'],
    story: (s) =>
      `A feature flag for ${s} was switched on without a deploy. It enabled a code path that throws, so errors began the minute the flag flipped while the deploy log stayed quiet.`,
    signals: [
      'Errors jump but latency stays normal',
      'A "config change applied" line in its logs, and a flag flip in the change log',
      'Stack traces in its logs; its own span errors',
    ],
    tip: 'No deploy does not mean no change: check config and flag history before assuming the code is the same.',
    effects: (_t, s, fx) => {
      addFx(fx, s, 'metrics', 'err_up');
      addFx(fx, s, 'logs', 'log_exception', 'log_config');
      addFx(fx, s, 'traces', 'tr_self_err');
      fx.configs.add(s);
    },
  },
  partial_zone: {
    id: 'partial_zone',
    name: 'Partial zone failure',
    short: 'Some instances in one availability zone go unhealthy',
    targets: ['app'],
    story: (s) =>
      `A few ${s} instances in one availability zone stopped passing health checks after a network fault there. The load balancer kept routing some requests to them, so a slice of traffic failed while the rest was fine.`,
    signals: [
      'Errors climb, but latency stays normal',
      '"health check failed for N of 6 instances in zone ..." in its logs',
      'No deploy or config change near the alert, and no stack traces',
    ],
    tip: 'A partial failure hits a slice of traffic. Look for instances or zones, not a bug in the code.',
    effects: (_t, s, fx) => {
      addFx(fx, s, 'metrics', 'err_up');
      addFx(fx, s, 'logs', 'log_zone');
      addFx(fx, s, 'traces', 'tr_self_err');
    },
  },

  traffic_spike: {
    id: 'traffic_spike',
    name: 'Legitimate traffic spike',
    short: 'Real demand outgrows capacity',
    targets: ['app'],
    story: (s) =>
      `A promotion drove several times the normal traffic to ${s}. Nothing was broken: demand simply outgrew the capacity it was running with, so CPU saturated and latency climbed.`,
    signals: [
      "Its own request rate jumps, with CPU saturated and latency up",
      'Load shedding in its own logs, but no retries anywhere',
      'No deploy, no config change and no errors from a dependency',
    ],
    tip: 'Not every incident is a bug. Check traffic first: if demand is the cause, adding capacity is the right fix.',
    effects: (_t, s, fx) => {
      addFx(fx, s, 'metrics', 'rps_up', 'cpu_up', 'lat_up');
      addFx(fx, s, 'logs', 'log_overload');
      addFx(fx, s, 'traces', 'tr_self_slow');
    },
  },

  perf_regression: {
    id: 'perf_regression',
    name: 'Performance regression',
    short: 'A release is correct but much slower',
    targets: ['app', 'worker'],
    story: (s) =>
      `A new version of ${s} shipped with an inefficient code path. It returns the right answers, just slowly, so latency rose the minute the deploy finished while the error rate stayed flat.`,
    signals: [
      'A deploy lands right before the alert',
      'Latency climbs but errors stay normal',
      'Its own span is slow; no memory pattern, no log errors',
    ],
    tip: 'Latency up with no errors right after a deploy is a performance regression, not a crash.',
    effects: (_t, s, fx) => {
      addFx(fx, s, 'metrics', 'lat_up');
      addFx(fx, s, 'traces', 'tr_self_slow');
      fx.deploys.add(s);
    },
  },

  rate_limited: {
    id: 'rate_limited',
    name: 'Vendor rate limit',
    short: 'A healthy third party starts rejecting your calls with 429',
    targets: ['external'],
    story: (s) =>
      `${s} is perfectly healthy, but a traffic increase pushed your calls past your quota, so it began answering 429 Too Many Requests. Its dashboards look fine; only your side shows errors.`,
    signals: [
      'Callers see errors, with "429 Too Many Requests" in their logs',
      "The third party's own metrics look healthy",
      'The failing span is the call to the third party',
    ],
    tip: 'The other side can be healthy and still be the cause: check whether you are being limited.',
    applies: (t, s) => t.callers[s].length > 0,
    effects: (t, s, fx) => {
      for (const c of t.callers[s]) {
        addFx(fx, c, 'metrics', 'err_up');
        addFx(fx, c, 'logs', 'log_ratelimit');
        addFx(fx, c, 'traces', 'tr_dep_err');
      }
    },
  },

  noisy_neighbour: {
    id: 'noisy_neighbour',
    name: 'Noisy neighbour',
    short: 'Another workload on the same node steals the CPU',
    targets: ['app', 'db'],
    story: (s) =>
      `A batch job from another team landed on the same node as ${s} and consumed most of its CPU. Traffic and code were unchanged, but ${s} slowed to a crawl.`,
    signals: [
      'CPU saturated and latency up, with no extra traffic',
      'No log errors, no deploy and no connection or memory pattern',
      'Its own span is slow',
    ],
    tip: 'Saturated CPU without more traffic means something else is using it.',
    effects: (_t, s, fx) => {
      addFx(fx, s, 'metrics', 'cpu_up', 'lat_up');
      addFx(fx, s, 'traces', 'tr_self_slow');
    },
  },
  gc_pause: {
    id: 'gc_pause',
    name: 'Long GC pauses',
    short: 'Stop-the-world garbage collection stalls the service',
    targets: ['app'],
    story: (s) =>
      `${s} ran with a heap that was too small for its working set. The garbage collector kept stopping the world for seconds at a time, so latency spiked in waves even though traffic, code and CPU looked ordinary.`,
    signals: [
      'Latency up in waves with CPU not saturated',
      'Multi-second stop-the-world GC pauses with a nearly full heap in its own logs',
      'Its own span is slow, with no deploy and no leak (memory does not climb)',
    ],
    tip: 'Slow, bursty latency with healthy CPU and a GC pause in the log points at the heap, not at traffic.',
    effects: (_t, s, fx) => {
      addFx(fx, s, 'metrics', 'lat_up');
      addFx(fx, s, 'logs', 'log_gc');
      addFx(fx, s, 'traces', 'tr_self_slow');
    },
  },
  clock_skew: {
    id: 'clock_skew',
    name: 'Clock skew',
    short: 'A drifting node clock makes tokens and signatures fail',
    targets: ['app'],
    story: (s) =>
      `The clock on the node running ${s} drifted ahead after its NTP sync broke. Tokens it issued looked "from the future" to everyone else, so requests were rejected while the service itself seemed healthy.`,
    signals: [
      'Errors up on the service with no deploy and no resource pressure',
      '"clock skew" / "token issued in the future" in its logs',
      'Its own span fails quickly',
    ],
    tip: 'Auth errors that appear with no change and no load are often time: check the clocks.',
    effects: (_t, s, fx) => {
      addFx(fx, s, 'metrics', 'err_up');
      addFx(fx, s, 'logs', 'log_clock');
      addFx(fx, s, 'traces', 'tr_self_err');
    },
  },
  lock_contention: {
    id: 'lock_contention',
    name: 'Lock contention',
    short: 'A long migration holds a table lock and queries pile up behind it',
    targets: ['db'],
    story: (s) =>
      `A schema migration on ${s} took an exclusive lock on a hot table and ran for minutes. Every query touching that table queued behind it, so latency climbed for all callers while the database stayed mostly idle.`,
    signals: [
      'Latency up on the database with CPU low',
      '"waiting for lock" / "deadlock detected" in its logs',
      'Callers slow down too, but connections are not exhausted',
    ],
    tip: 'A database that is slow but idle is waiting on something: look for locks before you blame load.',
    effects: (_t, s, fx) => {
      addFx(fx, s, 'metrics', 'lat_up');
      addFx(fx, s, 'logs', 'log_lock');
      addFx(fx, s, 'traces', 'tr_self_slow');
    },
  },
  runaway_job: {
    id: 'runaway_job',
    name: 'Runaway batch job',
    short: 'A scheduled job floods the service with work',
    targets: ['app', 'db'],
    story: (s) =>
      `A scheduled reindex job on ${s} started with no concurrency cap. It consumed CPU and flooded the service with its own requests, so real traffic slowed down although nothing was deployed.`,
    signals: [
      'Traffic and CPU up together, starting on the minute',
      '"cron job started" in its logs',
      'Latency up, with no deploy and no config change',
    ],
    tip: 'Load that starts exactly on a schedule is usually a job, not users.',
    effects: (_t, s, fx) => {
      addFx(fx, s, 'metrics', 'rps_up', 'cpu_up', 'lat_up');
      addFx(fx, s, 'logs', 'log_cron');
      addFx(fx, s, 'traces', 'tr_self_slow');
    },
  },
  deploy_retry_storm: {
    id: 'deploy_retry_storm',
    name: 'Bad deploy that triggers a retry storm',
    short: 'A release starts failing, and its retries flatten a dependency',
    targets: ['app'],
    story: (s) =>
      `A new version of ${s} shipped with a bug that made some calls fail, and its client retries failures immediately. The errors began with the deploy, and the retries then multiplied traffic onto its dependencies until they were overloaded too: two causes, one incident.`,
    signals: [
      'A deploy lands right before the alert, and the service itself throws errors (stack traces)',
      'It also logs aggressive retries, and its traces repeat the same downstream call',
      'Its dependencies are overloaded: request rate jumps and they shed load',
    ],
    tip: 'When the change log and the overloaded dependency both point somewhere, check whether one service explains both: roll back the change that started it.',
    applies: (t, s) => t.byId[s].deps.some((d) => ['app', 'db'].includes(t.byId[d].kind)),
    effects: (t, s, fx) => {
      addFx(fx, s, 'metrics', 'err_up');
      addFx(fx, s, 'logs', 'log_exception', 'log_retry');
      addFx(fx, s, 'traces', 'tr_self_err', 'tr_fanout_retry');
      fx.deploys.add(s);
      for (const d of t.byId[s].deps) {
        if (!['app', 'db'].includes(t.byId[d].kind)) continue;
        addFx(fx, d, 'metrics', 'rps_up', 'cpu_up', 'lat_up', 'err_up');
        addFx(fx, d, 'logs', 'log_overload');
      }
    },
  },
  silent_failure: {
    id: 'silent_failure',
    name: 'Failing behind a healthy dashboard',
    short: 'The service fails, but its own metrics exporter died and the charts look fine',
    targets: ['app'],
    story: (s) =>
      `${s} was throwing errors on many requests, but its metrics exporter had crashed earlier, so its dashboards showed a flat, healthy line. Only its logs and traces told the truth, and its callers were the ones who saw the errors.`,
    signals: [
      'Its own metrics look normal, yet its callers are erroring',
      'Stack traces in its logs, and its own spans fail',
      'No deploy and no resource pressure anywhere',
    ],
    tip: 'A flat dashboard is not proof of health: if the callers disagree with a service\'s own metrics, believe the logs and traces.',
    applies: (t, s) => t.callers[s].length > 0,
    effects: (t, s, fx) => {
      addFx(fx, s, 'logs', 'log_exception');
      addFx(fx, s, 'traces', 'tr_self_err');
      for (const c of t.callers[s]) {
        addFx(fx, c, 'metrics', 'err_up');
        addFx(fx, c, 'traces', 'tr_dep_err');
      }
    },
  },
};

export const FAULT_IDS = Object.keys(FAULTS) as FaultId[];
/** The original seventeen: what a seed picks when no fault is forced, so old seeds and shared links keep their incident. */
export const CORE_FAULT_IDS = FAULT_IDS.slice(0, 17);

export function isCompatible(t: Topology, service: string, fault: FaultId): boolean {
  const def = FAULTS[fault];
  return def.targets.includes(t.byId[service].kind) && (def.applies?.(t, service) ?? true);
}
