import { chance, pick, randInt, shuffle, type Rng } from '../lib/rng';
import type { Service, ServiceKind, Topology } from './types';

const APPS = ['checkout', 'orders', 'catalog', 'search', 'users', 'auth', 'cart', 'pricing', 'inventory', 'reviews', 'billing', 'shipping'];
const DBS = ['postgres-main', 'postgres-users', 'postgres-orders'];
const CACHES = ['redis-cache', 'redis-sessions'];
const EXTERNALS = ['payments-provider', 'geo-provider', 'email-provider', 'sms-provider'];
const WORKERS = ['email-worker', 'invoice-worker', 'search-indexer'];

export function buildTopology(services: Service[]): Topology {
  const byId: Record<string, Service> = {};
  const callers: Record<string, string[]> = {};
  for (const s of services) {
    byId[s.id] = s;
    callers[s.id] = [];
  }
  for (const s of services) for (const d of s.deps) callers[d].push(s.id);
  return { services, byId, callers };
}

/** Random but always well-formed service graph: every fault type has at least one valid target. */
export function generateTopology(rng: Rng): Topology {
  const services: Service[] = [];
  const add = (id: string, kind: ServiceKind): Service => {
    const s: Service = { id, kind, deps: [] };
    services.push(s);
    return s;
  };
  const link = (from: Service, to: Service, front = false) => {
    if (from.deps.includes(to.id)) return;
    if (front) from.deps.unshift(to.id);
    else from.deps.push(to.id);
  };

  const gateway = add('edge-gateway', 'gateway');
  const apps = shuffle(rng, APPS)
    .slice(0, randInt(rng, 3, 5))
    .map((n) => add(n, 'app'));
  const dbs = shuffle(rng, DBS)
    .slice(0, randInt(rng, 1, 2))
    .map((n) => add(n, 'db'));
  const cache = add(pick(rng, CACHES), 'cache');
  const external = add(pick(rng, EXTERNALS), 'external');

  const nTier1 = Math.min(apps.length - 1, randInt(rng, 2, 3));
  const tier1 = apps.slice(0, nTier1);
  const tier2 = apps.slice(nTier1);
  for (const a of tier1) link(gateway, a);
  for (const a of tier2) link(pick(rng, tier1), a);

  const isDb = (id: string) => dbs.some((d) => d.id === id);
  for (const db of dbs) link(pick(rng, apps), db);
  for (const a of apps) if (!a.deps.some(isDb) && chance(rng, 0.5)) link(a, pick(rng, dbs));

  // Cache-aside: only services that also talk to a database use the cache.
  const withDb = apps.filter((a) => a.deps.some(isDb));
  for (const a of shuffle(rng, withDb).slice(0, randInt(rng, 1, Math.min(2, withDb.length)))) link(a, cache, true);

  link(pick(rng, apps), external);

  if (chance(rng, 0.6)) {
    const queue = add('events-queue', 'queue');
    link(pick(rng, apps), queue);
    const worker = add(pick(rng, WORKERS), 'worker');
    link(worker, queue);
    link(worker, pick(rng, dbs));
  }

  return buildTopology(services);
}

/** Longest distance from a root (a service nobody calls); used for map layout. */
export function depths(t: Topology): Record<string, number> {
  const depth: Record<string, number> = {};
  const visit = (id: string, d: number) => {
    if ((depth[id] ?? -1) >= d) return;
    depth[id] = d;
    for (const dep of t.byId[id].deps) visit(dep, d + 1);
  };
  for (const s of t.services) if (t.callers[s.id].length === 0) visit(s.id, 0);
  return depth;
}
