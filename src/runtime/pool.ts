import { ConversionError, type ConvertOptions, type OutputFile } from '../engine/types';
import type { JobMessage, ResultMessage } from './worker';

interface Slot {
  worker: Worker;
  busy: boolean;
}

interface Pending {
  resolve: (outputs: OutputFile[]) => void;
  reject: (err: unknown) => void;
  slot: Slot;
}

export function defaultPoolSize(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(4, cores - 1));
}

/** Reusable workers, so libraries load once and the page never blocks. */
export class WorkerPool {
  private slots: Slot[] = [];
  private waiting: Array<() => void> = [];
  private pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(readonly size = defaultPoolSize()) {}

  private spawn(): Slot {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'convert' });
    const slot: Slot = { worker, busy: false };
    worker.onmessage = (e: MessageEvent<ResultMessage>) => {
      const msg = e.data;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      this.release(slot);
      if (msg.ok) p.resolve(msg.outputs);
      else p.reject(new ConversionError(msg.message, msg.code));
    };
    worker.onerror = (e) => {
      e.preventDefault();
      this.fail(slot, new ConversionError('The conversion stopped unexpectedly. The file may be too large for this browser.', 'resources'));
    };
    return slot;
  }

  private fail(slot: Slot, err: unknown) {
    for (const [id, p] of this.pending) {
      if (p.slot === slot) {
        this.pending.delete(id);
        p.reject(err);
      }
    }
    this.replace(slot);
  }

  private replace(slot: Slot) {
    slot.worker.terminate();
    const i = this.slots.indexOf(slot);
    if (i >= 0) this.slots.splice(i, 1);
    this.waiting.shift()?.();
  }

  private release(slot: Slot) {
    slot.busy = false;
    this.waiting.shift()?.();
  }

  private async acquire(): Promise<Slot> {
    for (;;) {
      const idle = this.slots.find((s) => !s.busy);
      if (idle) {
        idle.busy = true;
        return idle;
      }
      if (this.slots.length < this.size) {
        const slot = this.spawn();
        slot.busy = true;
        this.slots.push(slot);
        return slot;
      }
      await new Promise<void>((r) => this.waiting.push(r));
    }
  }

  async run(
    converter: string,
    input: { data: Uint8Array; name: string; from: string },
    to: string,
    options: ConvertOptions,
    signal?: AbortSignal,
  ): Promise<OutputFile[]> {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const slot = await this.acquire();
    const id = this.nextId++;
    return new Promise<OutputFile[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, slot });
      // Cancelling ends the worker mid-job; a fresh one replaces it.
      signal?.addEventListener(
        'abort',
        () => {
          if (this.pending.has(id)) this.fail(slot, new DOMException('Cancelled', 'AbortError'));
        },
        { once: true },
      );
      const msg: JobMessage = { id, converter, data: input.data, name: input.name, from: input.from, to, options };
      slot.worker.postMessage(msg, [input.data.buffer as ArrayBuffer]);
    });
  }
}
