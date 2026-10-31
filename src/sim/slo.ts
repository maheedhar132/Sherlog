import type { Incident } from './types';

/** Error SLO: 99.9% of requests succeed, so the error budget is 0.1%. */
export const ERROR_BUDGET_PCT = 0.1;
/** The budget is a 10 minute outage's worth: the incident clock burns it. */
export const ERROR_BUDGET_SECONDS = 600;
/** Latency SLO: p99 stays within 1.5x of the service's normal p99. */
export const LATENCY_SLO_FACTOR = 1.5;

export interface Page {
  service: string;
  /** One line a pager would show. */
  text: string;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const nums = (v: (number | null)[]) => v.filter((x): x is number => x !== null);

/** What each paging service is actually breaching, in SLO terms. */
export function pages(inc: Incident, services: Iterable<string>): Page[] {
  const out: Page[] = [];
  for (const id of services) {
    const series = inc.data.metrics[id];
    const lat = series.find((s) => s.name.startsWith('latency'))?.values ?? [];
    const err = series.find((s) => s.name.startsWith('error'))?.values ?? [];
    if (nums(lat).length < lat.length) {
      out.push({ service: id, text: `${id}: no data` });
      continue;
    }
    const base = mean(nums(lat).slice(0, 18));
    const now = mean(nums(lat).slice(-8));
    const errNow = mean(nums(err).slice(-8));
    const parts: string[] = [];
    if (now > base * LATENCY_SLO_FACTOR) parts.push(`p99 ${Math.round(now)} ms (SLO ${Math.round(base * LATENCY_SLO_FACTOR)} ms)`);
    if (errNow > 1) parts.push(`${errNow.toFixed(1)}% errors, budget burning ${Math.round(errNow / ERROR_BUDGET_PCT)}x`);
    out.push({ service: id, text: `${id}: ${parts.join(' · ') || 'degraded'}` });
  }
  return out;
}

/** Requests per second each service handles, for a rough count of how many customers an incident fails. */
const REQUESTS_PER_SECOND = 150;

/** Failed requests per second across the services that are paging (a stylised figure to show what the clock costs). */
export function failedPerSecond(inc: Incident, paging: Iterable<string>): number {
  let rate = 0;
  for (const id of paging) {
    const err = inc.data.metrics[id]?.find((s) => s.name.startsWith('error'))?.values ?? [];
    rate += (mean(nums(err).slice(-8)) / 100) * REQUESTS_PER_SECOND;
  }
  return rate;
}
