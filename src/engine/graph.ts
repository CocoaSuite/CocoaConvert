import { CONVERTERS } from './registry';
import type { ConverterDef, Edge, Route, RouteStep } from './types';

export const MAX_HOPS = 3;

export interface Availability {
  /** Server converter ids the connected server reports as installed. Empty when there is no server. */
  server: ReadonlySet<string>;
  /** Client converter ids this browser cannot run (missing APIs). */
  clientMissing?: ReadonlySet<string>;
}

export const NO_SERVER: Availability = { server: new Set() };

interface Hop {
  converter: ConverterDef;
  edge: Edge;
}

function usable(c: ConverterDef, size: number, avail: Availability): boolean {
  if (size > c.maxBytes) return false;
  if (c.env === 'server') return avail.server.has(c.id);
  return !avail.clientMissing?.has(c.id);
}

function outgoing(converters: ConverterDef[]): Map<string, Hop[]> {
  const map = new Map<string, Hop[]>();
  for (const converter of converters) {
    for (const edge of converter.edges) {
      const list = map.get(edge.from) ?? [];
      list.push({ converter, edge });
      map.set(edge.from, list);
    }
  }
  return map;
}

function toRoute(path: Hop[]): Route {
  const steps: RouteStep[] = path.map((h) => ({
    converter: h.converter,
    from: h.edge.from,
    to: h.edge.to,
    note: h.edge.note,
  }));
  const envs = new Set(steps.map((s) => s.converter.env));
  const notes = [...new Set(steps.map((s) => s.note).filter((n): n is string => !!n))];
  return {
    steps,
    // Each extra step costs a little, so direct conversions win ties.
    cost: path.reduce((sum, h) => sum + h.edge.cost, 0) + (path.length - 1) * 0.25,
    env: envs.size > 1 ? 'mixed' : steps[0].converter.env,
    notes,
  };
}

/**
 * Finds the cheapest conversion route to every reachable format.
 * Routes never revisit a format, never exceed MAX_HOPS, and edges marked
 * chain: false are only used as single-step routes.
 */
export function allRoutes(from: string, size: number, avail: Availability, converters = CONVERTERS): Map<string, Route> {
  const out = outgoing(converters.filter((c) => usable(c, size, avail)));
  const best = new Map<string, Route>();

  const visit = (format: string, path: Hop[], seen: Set<string>) => {
    if (path.length >= MAX_HOPS) return;
    for (const hop of out.get(format) ?? []) {
      const to = hop.edge.to;
      if (seen.has(to)) continue;
      const nextPath = [...path, hop];
      if (nextPath.length > 1 && nextPath.some((h) => !h.edge.chain)) continue;
      const route = toRoute(nextPath);
      const current = best.get(to);
      if (!current || route.cost < current.cost) best.set(to, route);
      seen.add(to);
      visit(to, nextPath, seen);
      seen.delete(to);
    }
  };

  visit(from, [], new Set([from]));
  return best;
}

export function findRoute(from: string, to: string, size: number, avail: Availability): Route | null {
  return allRoutes(from, size, avail).get(to) ?? null;
}

/** True when any step of the route uploads the file. */
export function routeUsesServer(route: Route): boolean {
  return route.steps.some((s) => s.converter.env === 'server');
}
