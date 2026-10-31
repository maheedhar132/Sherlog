import type { Channel } from './types';

/** Every incident shows a 60-minute window; the incident starts at minute ONSET. */
export const MINUTES = 60;
export const ONSET = 42;

/** Simulated investigation time each query costs, in seconds. */
export const COST: Record<Channel | 'deploys', number> = {
  metrics: 10,
  logs: 15,
  traces: 20,
  deploys: 5,
};

export const WRONG_PENALTY = 20;

export const METRIC_FEATURES = ['lat_up', 'err_up', 'cpu_up', 'mem_climb', 'restarts', 'rps_up', 'rps_drop', 'hit_drop', 'conn_max', 'nodata'] as const;
export const LOG_FEATURES = [
  'log_oom',
  'log_pool_timeout',
  'log_slow_query',
  'log_exception',
  'log_evict',
  'log_cache_miss',
  'log_retry',
  'log_overload',
  'log_dns',
  'log_upstream_timeout',
  'log_upstream_error',
] as const;
export const TRACE_FEATURES = ['tr_self_slow', 'tr_self_err', 'tr_dep_slow', 'tr_dep_err', 'tr_dep_fastfail', 'tr_fanout_retry', 'tr_cache_miss'] as const;

/** Wall-clock label for minute t of the window (onset lands at 14:02). */
export function clockLabel(t: number): string {
  const total = Math.round((13 * 60 + 20 + t) * 60);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
