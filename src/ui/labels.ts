import type { QueryKey, ServiceKind } from '../sim/types';

export const KIND_LABEL: Record<ServiceKind, string> = {
  gateway: 'GW',
  app: 'SVC',
  db: 'DB',
  cache: 'CACHE',
  queue: 'QUEUE',
  worker: 'WORKER',
  external: '3RD-PARTY',
};

export const FEATURE_LABEL: Record<string, string> = {
  lat_up: 'latency way up',
  err_up: 'error rate up',
  cpu_up: 'CPU saturated',
  mem_climb: 'memory climbing',
  restarts: 'process restarts',
  rps_up: 'traffic surge',
  rps_drop: 'traffic dropped to ~0',
  hit_drop: 'cache hit ratio collapsed',
  conn_max: 'connection pool maxed out',
  nodata: 'no data at all',
  disk_full: 'disk full (100%)',
  lag_up: 'consumer lag climbing',
  log_tls: 'x509 / certificate expired',
  log_zone: 'instances failing in one zone',
  log_ratelimit: '429 rate limited',
  log_disk: '"No space left on device"',
  log_config: 'config / flag change applied',
  log_poison: '"failed to process message"',
  log_oom: 'OutOfMemory / OOMKilled',
  log_pool_timeout: 'timeouts acquiring DB connections',
  log_slow_query: 'slow queries / lock waits',
  log_exception: 'stack traces (NPE / TypeError)',
  log_evict: 'mass key eviction',
  log_cache_miss: 'cache MISS fallbacks',
  log_retry: 'aggressive retries',
  log_overload: 'load shedding / queue full',
  log_dns: 'ENOTFOUND / no such host',
  log_upstream_timeout: 'upstream timeouts',
  log_upstream_error: 'upstream 5xx',
  tr_self_slow: 'its own span is slow',
  tr_self_err: 'its own span errors',
  tr_dep_slow: 'a dependency span is slow',
  tr_dep_err: 'a dependency span errors',
  tr_dep_fastfail: 'a dependency fails instantly',
  tr_fanout_retry: 'same call repeated 3×',
  tr_cache_miss: 'cache miss in the path',
};

export function describeQuery(key: QueryKey): { channel: string; service: string | null } {
  if (key === 'deploys') return { channel: 'deploys', service: null };
  const [channel, service] = key.split(':');
  return { channel, service };
}

export const CHANNEL_ICON: Record<string, string> = { metrics: '📈', logs: '📜', traces: '🧵', deploys: '🚀' };
