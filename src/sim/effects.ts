import { pick, shuffle, type Rng } from '../lib/rng';
import { FAULTS } from './faults';
import type { Channel, Fx, Hypothesis, Mode, Topology } from './types';

export function emptyFx(t: Topology): Fx {
  const services: Fx['services'] = {};
  for (const s of t.services) services[s.id] = { metrics: new Set(), logs: new Set(), traces: new Set() };
  return { services, deploys: new Set() };
}

export function addFx(fx: Fx, service: string, channel: Channel, ...features: string[]): boolean {
  const set = fx.services[service][channel];
  let changed = false;
  for (const f of features) {
    if (!set.has(f)) {
      set.add(f);
      changed = true;
    }
  }
  return changed;
}

/** Slow or failing services make their callers slow or failing, all the way up. */
function propagate(t: Topology, fx: Fx): void {
  const queue = t.services.map((s) => s.id);
  while (queue.length) {
    const id = queue.shift()!;
    const m = fx.services[id].metrics;
    for (const caller of t.callers[id]) {
      let changed = false;
      if (m.has('lat_up')) {
        changed = addFx(fx, caller, 'metrics', 'lat_up') || changed;
        addFx(fx, caller, 'logs', 'log_upstream_timeout');
        addFx(fx, caller, 'traces', 'tr_dep_slow');
      }
      if (m.has('err_up')) {
        changed = addFx(fx, caller, 'metrics', 'err_up') || changed;
        addFx(fx, caller, 'logs', 'log_upstream_error');
        addFx(fx, caller, 'traces', 'tr_dep_err');
      }
      if (changed) queue.push(caller);
    }
  }
}

/** The textbook symptoms of a hypothesis. Shared by the simulator and the AI, so the AI knows nothing a player can't learn. */
export function faultEffects(t: Topology, h: Hypothesis): Fx {
  const fx = emptyFx(t);
  FAULTS[h.fault].effects(t, h.service, fx);
  propagate(t, fx);
  return fx;
}

type HerringKind = 'cpu' | 'log_timeout' | 'deploy' | 'log_retry' | 'lat_blip';

const HERRINGS: Record<Mode, { count: number; kinds: HerringKind[] }> = {
  easy: { count: 1, kinds: ['cpu', 'log_timeout'] },
  normal: { count: 2, kinds: ['cpu', 'log_timeout', 'deploy', 'log_retry'] },
  hard: { count: 3, kinds: ['cpu', 'log_timeout', 'deploy', 'log_retry', 'lat_blip'] },
};

/** Unrelated noise that real incidents always have. Returns human-readable notes for the postmortem. */
export function addHerrings(t: Topology, fx: Fx, truth: Hypothesis, mode: Mode, rng: Rng): string[] {
  const notes: string[] = [];
  const { count, kinds } = HERRINGS[mode];
  const quiet = (kindsAllowed: string[]) =>
    t.services.filter((s) => s.id !== truth.service && kindsAllowed.includes(s.kind) && fx.services[s.id].metrics.size === 0);
  const appsWithDeps = t.services.filter((s) => s.id !== truth.service && s.kind === 'app' && s.deps.length > 0);

  for (const kind of shuffle(rng, kinds).slice(0, count)) {
    switch (kind) {
      case 'cpu': {
        const c = quiet(['app', 'db', 'worker']);
        if (!c.length) break;
        const s = pick(rng, c);
        addFx(fx, s.id, 'metrics', 'cpu_up');
        notes.push(`Unrelated CPU spike on ${s.id} (a scheduled batch job).`);
        break;
      }
      case 'log_timeout': {
        if (!appsWithDeps.length) break;
        const s = pick(rng, appsWithDeps);
        addFx(fx, s.id, 'logs', 'log_upstream_timeout');
        notes.push(`A few harmless timeout warnings in ${s.id} logs (they happen every day).`);
        break;
      }
      case 'log_retry': {
        if (!appsWithDeps.length) break;
        const s = pick(rng, appsWithDeps);
        addFx(fx, s.id, 'logs', 'log_retry');
        notes.push(`Routine client retries logged by ${s.id}: retries alone do not mean a retry storm.`);
        break;
      }
      case 'deploy': {
        const c = t.services.filter((s) => s.id !== truth.service && (s.kind === 'app' || s.kind === 'worker'));
        if (!c.length) break;
        const s = pick(rng, c);
        fx.deploys.add(s.id);
        notes.push(`Coincidental deploy of ${s.id} right before the alert: it changed nothing relevant.`);
        break;
      }
      case 'lat_blip': {
        const c = quiet(['app']);
        if (!c.length) break;
        const s = pick(rng, c);
        addFx(fx, s.id, 'metrics', 'lat_up');
        notes.push(`${s.id} had its own unrelated latency blip (noisy neighbour on its node).`);
        break;
      }
    }
  }
  // When no candidate exists a herring is skipped; that just makes this incident a bit easier.
  return notes;
}
