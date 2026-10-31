export type ServiceKind = 'gateway' | 'app' | 'db' | 'cache' | 'queue' | 'worker' | 'external';

export interface Service {
  id: string;
  kind: ServiceKind;
  /** Services this one calls. */
  deps: string[];
}

export interface Topology {
  services: Service[];
  byId: Record<string, Service>;
  /** Reverse edges: who calls each service. */
  callers: Record<string, string[]>;
}

export type FaultId =
  | 'memory_leak'
  | 'db_pool'
  | 'bad_deploy'
  | 'cache_stampede'
  | 'retry_storm'
  | 'dns_failure'
  | 'thread_pool'
  | 'slow_third_party'
  | 'certificate_expiry'
  | 'disk_full'
  | 'poison_message'
  | 'config_flag'
  | 'partial_zone'
  | 'traffic_spike'
  | 'perf_regression'
  | 'rate_limited'
  | 'noisy_neighbour'
  | 'gc_pause'
  | 'clock_skew'
  | 'lock_contention'
  | 'runaway_job'
  | 'deploy_retry_storm';

export type Channel = 'metrics' | 'logs' | 'traces';
export type QueryKey = `${Channel}:${string}` | 'deploys';

export type Mode = 'easy' | 'normal' | 'hard';

export interface Hypothesis {
  service: string;
  fault: FaultId;
}

/** Abstract symptoms per service. Rendering turns these into raw signals; detection turns signals back into these. */
export interface ServiceEffects {
  metrics: Set<string>;
  logs: Set<string>;
  traces: Set<string>;
}

export interface Fx {
  services: Record<string, ServiceEffects>;
  /** Services that shipped a deploy right around incident onset. */
  deploys: Set<string>;
  /** Services that had a config or feature-flag change right around incident onset. */
  configs: Set<string>;
}

export interface MetricSeries {
  name: string;
  unit: string;
  values: (number | null)[];
}

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface LogLine {
  /** Minutes into the 60-minute window. */
  t: number;
  level: LogLevel;
  service: string;
  msg: string;
}

export interface Span {
  service: string;
  op: string;
  /** Milliseconds. */
  duration: number;
  status: 'ok' | 'error';
  attrs: Record<string, string>;
  children: Span[];
}

export interface DeployEvent {
  t: number;
  service: string;
  version: string;
  author: string;
  /** A config or flag flip, as opposed to a code deploy. */
  kind?: 'deploy' | 'config';
}

export interface IncidentData {
  metrics: Record<string, MetricSeries[]>;
  logs: Record<string, LogLine[]>;
  traces: Record<string, Span>;
  deploys: DeployEvent[];
}

export interface Incident {
  seed: number;
  mode: Mode;
  topology: Topology;
  truth: Hypothesis;
  /** The true symptoms including red herrings (used by tests and the postmortem, never by the AI). */
  fx: Fx;
  herrings: string[];
  /** Alerts that fire but have nothing to do with the incident. */
  noise: string[];
  data: IncidentData;
}
