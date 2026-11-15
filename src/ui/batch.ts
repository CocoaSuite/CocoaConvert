import { FALLBACK_TARGET, SUGGESTED_TARGET } from '../engine/defaults';
import { detectBlob } from '../engine/detect';
import { uniqueName } from '../engine/filenames';
import { CATEGORY_ORDER, findFormat, getFormat } from '../engine/formats';
import { allRoutes, routeUsesServer, type Availability } from '../engine/graph';
import { LIMITS, formatBytes } from '../engine/limits';
import { defaultOptions, optionsFor } from '../engine/options';
import { ConversionError, type ConvertOptions, type OptionDef, type Route } from '../engine/types';
import { runRoute, type StepProgress } from '../runtime/executor';
import { defaultPoolSize, WorkerPool } from '../runtime/pool';

export type Status = 'detecting' | 'unsupported' | 'ready' | 'queued' | 'converting' | 'done' | 'failed' | 'cancelled';

export interface Target {
  format: string;
  route: Route;
  server: boolean;
}

export interface Output {
  name: string;
  blob: Blob;
  size: number;
  format: string;
}

export interface Item {
  id: number;
  file: File;
  name: string;
  size: number;
  status: Status;
  from: string | null;
  mismatch?: string;
  targets: Target[];
  target: string | null;
  progress: StepProgress | null;
  outputs: Output[];
  error?: string;
}

export interface BatchState {
  items: Item[];
  availability: Availability;
  serverAllowed: boolean;
  options: ConvertOptions;
}

const CONSENT_KEY = 'cc-server-consent';
const LAST_TARGET_KEY = 'cc-last-target';

const storage = {
  get(store: Storage | undefined, key: string): string | null {
    try {
      return store?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(store: Storage | undefined, key: string, value: string | null) {
    try {
      if (value === null) store?.removeItem(key);
      else store?.setItem(key, value);
    } catch {
      /* private mode */
    }
  },
};

function sortTargets(targets: Target[]): Target[] {
  return targets.sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(getFormat(a.format).category);
    const cb = CATEGORY_ORDER.indexOf(getFormat(b.format).category);
    return ca - cb || getFormat(a.format).label.localeCompare(getFormat(b.format).label);
  });
}

export class Batch {
  state: BatchState;
  private listeners = new Set<() => void>();
  private pool = new WorkerPool();
  private controllers = new Map<number, AbortController>();
  private running = new Map<string, number>();
  private nextId = 1;
  private frame = 0;
  readonly concurrency = defaultPoolSize() + 1;
  onNotice: (message: string, kind?: 'info' | 'error') => void = () => {};

  constructor(availability: Availability) {
    this.state = {
      items: [],
      availability,
      serverAllowed: storage.get(globalThis.sessionStorage, CONSENT_KEY) === '1',
      options: {},
    };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Coalesces bursts of updates (progress, batch adds) into one render per frame. */
  private emit() {
    if (this.frame) return;
    const flush = () => {
      this.frame = 0;
      this.listeners.forEach((l) => l());
    };
    this.frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(flush) : (setTimeout(flush, 16) as unknown as number);
  }

  private set(partial: Partial<BatchState>) {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  private patch(id: number, partial: Partial<Item>) {
    this.set({ items: this.state.items.map((i) => (i.id === id ? { ...i, ...partial } : i)) });
  }

  get(id: number): Item | undefined {
    return this.state.items.find((i) => i.id === id);
  }

  setAvailability(availability: Availability) {
    this.set({ availability });
    for (const item of this.state.items) if (item.from) this.retarget(item.id);
  }

  allowServer(allowed: boolean) {
    storage.set(globalThis.sessionStorage, CONSENT_KEY, allowed ? '1' : null);
    this.set({ serverAllowed: allowed });
  }

  setOption(key: string, value: string | number) {
    this.set({ options: { ...this.state.options, [key]: value } });
  }

  /** Options shown for the current targets, with their effective values. */
  visibleOptions(): Array<{ def: OptionDef; value: string | number }> {
    const seen = new Map<string, OptionDef>();
    for (const item of this.state.items) {
      if (!item.from || !item.target || item.status === 'done') continue;
      for (const def of optionsFor(item.from, getFormat(item.from).category, item.target)) seen.set(def.key, def);
    }
    const defs = [...seen.values()];
    const defaults = defaultOptions(defs);
    return defs.map((def) => ({ def, value: this.state.options[def.key] ?? defaults[def.key] }));
  }

  add(files: Iterable<File>) {
    const added: Item[] = [];
    for (const file of files) {
      const item: Item = {
        id: this.nextId++,
        file,
        name: file.name || 'file',
        size: file.size,
        status: 'detecting',
        from: null,
        targets: [],
        target: null,
        progress: null,
        outputs: [],
      };
      added.push(item);
    }
    if (!added.length) return;
    this.set({ items: [...this.state.items, ...added] });
    for (const item of added) void this.detect(item);
  }

  private async detect(item: Item) {
    if (item.size === 0) {
      this.patch(item.id, { status: 'unsupported', error: 'This file is empty.' });
      return;
    }
    if (item.size > LIMITS.maxFileBytes) {
      this.patch(item.id, { status: 'unsupported', error: `This file is larger than ${formatBytes(LIMITS.maxFileBytes)}, the most CocoaConvert accepts.` });
      return;
    }
    try {
      const d = await detectBlob(item.file);
      if (!d.format) {
        this.patch(item.id, { status: 'unsupported', error: 'This file type is not supported yet.' });
        return;
      }
      this.patch(item.id, { from: d.format, mismatch: d.extensionMismatch });
      this.retarget(item.id, true);
    } catch {
      this.patch(item.id, { status: 'unsupported', error: 'This file could not be read. It may have moved or been deleted.' });
    }
  }

  private retarget(id: number, initial = false) {
    const item = this.get(id);
    if (!item?.from) return;
    const routes = allRoutes(item.from, item.size, this.state.availability);
    const targets = sortTargets([...routes].map(([format, route]) => ({ format, route, server: routeUsesServer(route) })));
    if (!targets.length) {
      const tooBig = allRoutes(item.from, 0, this.state.availability).size > 0;
      this.patch(id, {
        targets,
        target: null,
        status: 'unsupported',
        error: tooBig
          ? `This file is too large to convert here (${formatBytes(item.size)}).`
          : `${getFormat(item.from).label} files cannot be converted yet${this.state.availability.server.size ? '' : ' in the browser'}.`,
      });
      return;
    }
    const has = (f: string | null | undefined) => !!f && targets.some((t) => t.format === f);
    const last = storage.get(globalThis.localStorage, LAST_TARGET_KEY);
    let target = item.target;
    if (!has(target)) {
      const suggested = SUGGESTED_TARGET[item.from];
      const fallback = FALLBACK_TARGET[item.from];
      const firstDevice = targets.find((t) => !t.server)?.format;
      target = [last && last !== item.from ? last : null, suggested, fallback, firstDevice, targets[0].format].find(has) ?? null;
      // A remembered choice from another category (say MP3 for a PDF) is not a good default.
      if (target === last && last && findFormat(last)?.category !== getFormat(item.from).category && has(suggested)) target = suggested;
    }
    const status = initial || item.status === 'detecting' || item.status === 'unsupported' ? 'ready' : item.status;
    this.patch(id, { targets, target, status, error: status === 'ready' ? undefined : item.error });
  }

  setTarget(id: number, format: string) {
    const item = this.get(id);
    if (!item || item.status === 'converting' || item.status === 'queued') return;
    this.patch(id, { target: format, status: 'ready', outputs: [], error: undefined, progress: null });
  }

  /** Applies a target to every file that can reach it; returns how many changed. */
  setAllTargets(format: string): number {
    let n = 0;
    storage.set(globalThis.localStorage, LAST_TARGET_KEY, format);
    this.set({
      items: this.state.items.map((i) => {
        if (i.status === 'converting' || i.status === 'queued' || !i.targets.some((t) => t.format === format)) return i;
        n++;
        return i.target === format && i.status === 'done'
          ? i
          : { ...i, target: format, status: 'ready', outputs: [], error: undefined, progress: null };
      }),
    });
    return n;
  }

  /** Targets reachable by at least one waiting file, with how many files each covers. */
  bulkTargets(): Array<{ target: Target; count: number }> {
    const map = new Map<string, { target: Target; count: number }>();
    for (const item of this.state.items) {
      if (!item.from || item.status === 'unsupported') continue;
      for (const t of item.targets) {
        const e = map.get(t.format);
        if (e) {
          e.count++;
          e.target = { ...e.target, server: e.target.server && t.server };
        } else map.set(t.format, { target: t, count: 1 });
      }
    }
    const list = [...map.values()];
    const sorted = sortTargets(list.map((l) => l.target));
    return sorted.map((t) => list.find((l) => l.target.format === t.format)!);
  }

  needsServer(item: Item): boolean {
    return !!item.targets.find((t) => t.format === item.target)?.server;
  }

  /** Files that would start if Convert were pressed now. */
  pending(): Item[] {
    return this.state.items.filter(
      (i) => (i.status === 'ready' || i.status === 'cancelled') && i.target && (!this.needsServer(i) || this.state.serverAllowed),
    );
  }

  blockedByConsent(): Item[] {
    return this.state.items.filter(
      (i) => (i.status === 'ready' || i.status === 'cancelled') && i.target && this.needsServer(i) && !this.state.serverAllowed,
    );
  }

  convertAll() {
    const ids = new Set(this.pending().map((i) => i.id));
    if (!ids.size) return;
    this.set({
      items: this.state.items.map((i) => (ids.has(i.id) ? { ...i, status: 'queued', error: undefined, progress: null, outputs: [] } : i)),
    });
    this.pump();
  }

  retry(id: number) {
    const item = this.get(id);
    if (!item || !item.target) return;
    if (this.needsServer(item) && !this.state.serverAllowed) {
      this.patch(id, { status: 'ready', error: undefined });
      return;
    }
    this.patch(id, { status: 'queued', error: undefined, progress: null, outputs: [] });
    this.pump();
  }

  cancel(id: number) {
    const item = this.get(id);
    if (!item) return;
    if (item.status === 'queued') this.patch(id, { status: 'cancelled', progress: null });
    this.controllers.get(id)?.abort();
  }

  cancelAll() {
    for (const item of this.state.items) if (item.status === 'queued' || item.status === 'converting') this.cancel(item.id);
  }

  remove(id: number) {
    this.controllers.get(id)?.abort();
    this.set({ items: this.state.items.filter((i) => i.id !== id) });
  }

  clear() {
    this.cancelAll();
    this.set({ items: [] });
  }

  /** Heaviest engines (FFmpeg, LibreOffice) limit how many of their jobs run at once. */
  private limited(route: Route): string[] {
    return route.steps.map((s) => s.converter).filter((c) => c.concurrency).map((c) => c.id);
  }

  private canStart(route: Route): boolean {
    return this.limited(route).every((id) => {
      const c = route.steps.find((s) => s.converter.id === id)!.converter;
      return (this.running.get(id) ?? 0) < (c.concurrency ?? Infinity);
    });
  }

  private pump() {
    let active = this.state.items.filter((i) => i.status === 'converting').length;
    for (const item of this.state.items) {
      if (active >= this.concurrency) break;
      if (item.status !== 'queued') continue;
      const route = item.targets.find((t) => t.format === item.target)?.route;
      if (!route) {
        this.patch(item.id, { status: 'failed', error: 'This conversion is no longer available.' });
        continue;
      }
      if (!this.canStart(route)) continue;
      active++;
      void this.start(item, route);
    }
  }

  private async start(item: Item, route: Route) {
    const ctl = new AbortController();
    this.controllers.set(item.id, ctl);
    const limited = this.limited(route);
    limited.forEach((id) => this.running.set(id, (this.running.get(id) ?? 0) + 1));
    this.patch(item.id, { status: 'converting', progress: null, error: undefined });
    try {
      const options = this.state.options;
      const outputs = await runRoute({
        file: item.file,
        name: item.name,
        from: item.from!,
        route,
        options: { ...defaultOptions(optionsFor(item.from!, getFormat(item.from!).category, item.target!)), ...options },
        pool: this.pool,
        signal: ctl.signal,
        onProgress: (progress) => {
          if (this.get(item.id)?.status === 'converting') this.patch(item.id, { progress });
        },
      });
      const taken = new Set<string>();
      this.patch(item.id, {
        status: 'done',
        progress: null,
        outputs: outputs.map((o) => ({
          name: uniqueName(o.name, taken),
          blob: new Blob([o.data as BlobPart], { type: findFormat(o.format)?.mime ?? 'application/octet-stream' }),
          size: o.data.length,
          format: o.format,
        })),
      });
    } catch (e) {
      if (!this.get(item.id)) return;
      if ((e as Error)?.name === 'AbortError') {
        this.patch(item.id, { status: 'cancelled', progress: null });
      } else {
        const message =
          e instanceof ConversionError
            ? e.message
            : (e as Error)?.name === 'QuotaExceededError' || e instanceof RangeError
              ? 'There is not enough memory in this browser for this file.'
              : 'The conversion did not finish. The file may be damaged.';
        if (!(e instanceof ConversionError)) console.error(e);
        this.patch(item.id, { status: 'failed', progress: null, error: message });
      }
    } finally {
      this.controllers.delete(item.id);
      limited.forEach((id) => this.running.set(id, (this.running.get(id) ?? 1) - 1));
      this.pump();
    }
  }

  summary() {
    const items = this.state.items;
    const count = (s: Status) => items.filter((i) => i.status === s).length;
    return {
      total: items.length,
      bytes: items.reduce((s, i) => s + i.size, 0),
      done: count('done'),
      failed: count('failed'),
      converting: count('converting'),
      queued: count('queued'),
      outputs: items.flatMap((i) => i.outputs),
      usesServer: items.some((i) => (i.status === 'converting' || i.status === 'queued') && this.needsServer(i)),
    };
  }
}
