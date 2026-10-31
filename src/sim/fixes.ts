import { mulberry32, shuffle } from '../lib/rng';
import type { FaultId } from './types';

export type FixId =
  | 'restart'
  | 'rollback'
  | 'scale_out'
  | 'raise_timeouts'
  | 'failover'
  | 'kill_query'
  | 'warm_cache'
  | 'backoff'
  | 'restore_dns'
  | 'shed_load'
  | 'circuit_breaker'
  | 'renew_cert'
  | 'expand_disk'
  | 'skip_message'
  | 'revert_config'
  | 'drain_zone'
  | 'throttle'
  | 'move_node'
  | 'tune_heap'
  | 'sync_clock'
  | 'cancel_migration'
  | 'cap_job';

export const FIXES: Record<FixId, string> = {
  restart: 'Restart the service',
  rollback: 'Roll back the latest deploy',
  scale_out: 'Scale out more replicas',
  raise_timeouts: 'Raise the client timeouts',
  failover: 'Fail over to a replica',
  kill_query: 'Kill the slow query and add the missing index',
  warm_cache: 'Pre-warm the cache and raise its memory limit',
  backoff: 'Revert the retry change and add backoff with a circuit breaker',
  restore_dns: 'Restore the missing DNS record',
  shed_load: 'Shed load and unblock the blocking call',
  circuit_breaker: 'Open a circuit breaker and serve a fallback',
  renew_cert: 'Renew and deploy the TLS certificate',
  expand_disk: 'Free space and expand the volume',
  skip_message: 'Quarantine the poison message and restart the consumer',
  revert_config: 'Revert the config change or switch the flag off',
  drain_zone: 'Drain the unhealthy zone and shift traffic',
  throttle: 'Throttle outbound calls and ask for a higher quota',
  move_node: 'Move the workload to a different node',
  tune_heap: 'Raise the heap size and tune the garbage collector',
  sync_clock: 'Fix NTP on the node and resync its clock',
  cancel_migration: 'Cancel the long migration holding the lock',
  cap_job: 'Pause the job and cap its concurrency',
};

/** The right mitigation for each fault, and why the tempting alternatives don't work. */
export const FIX_FOR: Record<FaultId, { fix: FixId; why: string }> = {
  memory_leak: { fix: 'restart', why: 'A restart frees the leaked memory and stops the OOM kills at once; the real fix is a code change afterwards. Scaling out only delays the crash, and there was no deploy to roll back.' },
  db_pool: { fix: 'kill_query', why: 'The slow query is what pins the connections. Killing it and adding the index frees the pool. Scaling out the callers sends even more load at a database that is already saturated.' },
  bad_deploy: { fix: 'rollback', why: 'The errors began with the release, so rolling it back is the fastest safe mitigation. A restart would just bring the same bad code back up.' },
  cache_stampede: { fix: 'warm_cache', why: 'The cache lost its hot keys and the database is carrying the load. Warm the cache and give it room; restarting the database would make the stampede worse.' },
  retry_storm: { fix: 'backoff', why: 'Retries are multiplying traffic. Reverting them and adding backoff with a circuit breaker stops the amplification. Scaling the victim only absorbs a bigger storm.' },
  dns_failure: { fix: 'restore_dns', why: 'The name no longer resolves, so nothing can connect. Only restoring the record fixes it; restarts, scaling and timeouts cannot make a missing name resolve.' },
  thread_pool: { fix: 'shed_load', why: 'Every thread is blocked on a slow call. Shed load to let the pool drain and fix the blocking call. Scaling out helps little when each replica jams the same way.' },
  slow_third_party: { fix: 'circuit_breaker', why: 'The slowness is outside your boundary. Stop waiting on it: open a circuit breaker and serve a fallback. Restarting your own services changes nothing.' },
  certificate_expiry: { fix: 'renew_cert', why: 'Handshakes fail because the certificate expired. Renew and deploy it. Rolling back or restarting cannot make an expired certificate valid.' },
  disk_full: { fix: 'expand_disk', why: 'Writes fail because the volume is full. Free space and expand it. Restarting or scaling out will not create disk space.' },
  poison_message: { fix: 'skip_message', why: 'The consumer is stuck on one bad message. Quarantine it and restart the consumer so the backlog can drain. Scaling consumers just crash-loops more of them.' },
  config_flag: { fix: 'revert_config', why: 'The errors began when the flag flipped, with no deploy. Reverting the flag is the fastest fix. A rollback would change nothing because the code never changed.' },
  partial_zone: { fix: 'drain_zone', why: 'Only some instances in one zone are unhealthy, so draining that zone restores service. Rolling back or restarting everything would disturb the healthy instances too.' },
  traffic_spike: { fix: 'scale_out', why: 'Real demand outgrew capacity, so adding replicas is exactly right here: scaling out is not always the wrong answer. A rollback or restart would not create capacity.' },
  perf_regression: { fix: 'rollback', why: 'Latency rose right after a release with no errors, so roll it back. A restart would bring the same slow code back, and scaling out only hides the regression at a higher cost.' },
  rate_limited: { fix: 'throttle', why: 'The vendor is healthy; you are being limited with 429s. Throttle your own calls and ask for a higher quota. More retries and longer timeouts make the limit worse.' },
  gc_pause: { fix: 'tune_heap', why: 'The heap is too small, so the collector keeps stopping the world. Give it more room and tune it. A restart only clears the heap for a minute, and scaling out spreads a problem each replica has.' },
  clock_skew: { fix: 'sync_clock', why: 'The node clock drifted, so tokens look like they come from the future. Resync it. A rollback changes nothing because the code never changed, and a restart does not fix the clock.' },
  lock_contention: { fix: 'cancel_migration', why: 'One migration holds a lock that every query waits on. Cancel it (and run it online later). Scaling out the callers only queues more requests behind the same lock.' },
  runaway_job: { fix: 'cap_job', why: 'A scheduled job is eating the capacity. Pause it and cap its concurrency. Scaling out chases the load, and a rollback changes nothing because nothing was deployed.' },
  noisy_neighbour: { fix: 'move_node', why: 'CPU is saturated without extra traffic, so another workload on the node is taking it. Move to a different node. Scaling out onto the same node would not help.' },
};

/** A tempting fix that genuinely helps for a minute but leaves the cause in place. Not every fault has one. */
export const STOPGAP_FOR: Partial<Record<FaultId, { fix: FixId; why: string }>> = {
  memory_leak: { fix: 'scale_out', why: 'More replicas share the load, so the crashes spread out for a while, but every one of them leaks too.' },
  db_pool: { fix: 'failover', why: 'The replica takes the load, but the same slow query soon pins its connections as well.' },
  cache_stampede: { fix: 'scale_out', why: 'More database replicas absorb the stampede for a minute, but the cache is still cold and the cost climbs.' },
  retry_storm: { fix: 'shed_load', why: 'Dropping requests eases the pile-up, but the retries keep multiplying whatever you let through.' },
  thread_pool: { fix: 'scale_out', why: 'New replicas help until their threads block on the same slow call.' },
  perf_regression: { fix: 'scale_out', why: 'More replicas hide the slowdown at a higher cost, and the regression is still there.' },
  rate_limited: { fix: 'circuit_breaker', why: 'A breaker stops the 429s, but it also stops the calls the vendor would have allowed.' },
  gc_pause: { fix: 'restart', why: 'A restart clears the heap, so latency drops for a minute, then the heap fills again and the pauses return.' },
  lock_contention: { fix: 'scale_out', why: 'More callers do not help: they only queue behind the same lock, though a few get lucky for a moment.' },
  runaway_job: { fix: 'scale_out', why: 'More replicas absorb some of the job load for a while, but the job still takes everything it is given.' },
  noisy_neighbour: { fix: 'scale_out', why: 'Some new replicas land on quiet nodes, but the noisy node keeps degrading the ones on it.' },
};

/** Four options, one correct (and a stopgap where the fault has one), in a stable order for a given incident. */
export function fixOptions(seed: number, fault: FaultId): FixId[] {
  const rng = mulberry32((seed ^ 0x51ed270b) >>> 0);
  const correct = FIX_FOR[fault]?.fix ?? 'restart';
  const stopgap = STOPGAP_FOR[fault]?.fix;
  const others = (Object.keys(FIXES) as FixId[]).filter((f) => f !== correct && f !== stopgap);
  return shuffle(rng, [correct, ...(stopgap ? [stopgap] : []), ...shuffle(rng, others).slice(0, stopgap ? 2 : 3)]);
}
