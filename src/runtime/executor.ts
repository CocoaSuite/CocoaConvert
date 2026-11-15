import { MAIN_CONVERTERS } from '../converters/loaders';
import { ConversionError, type ConvertOptions, type OutputFile, type Route } from '../engine/types';
import type { WorkerPool } from './pool';
import { convertOnServer } from './server';

export interface StepProgress {
  step: number;
  steps: number;
  /** Real fraction of the current step, or null when the step cannot measure it. */
  fraction: number | null;
  where: 'device' | 'server';
  phase?: 'upload' | 'convert' | 'download';
}

export interface RunRequest {
  file: Blob;
  name: string;
  from: string;
  route: Route;
  options: ConvertOptions;
  pool: WorkerPool;
  onProgress: (p: StepProgress) => void;
  signal: AbortSignal;
}

/**
 * Runs each step of a route in order. Intermediate results stay in memory.
 * When a step makes several files (pages, sheets), the next step runs on each.
 */
export async function runRoute(req: RunRequest): Promise<OutputFile[]> {
  const { route, signal } = req;
  let current: OutputFile[] = [
    { name: req.name, data: new Uint8Array(await req.file.arrayBuffer()), format: req.from },
  ];
  for (let i = 0; i < route.steps.length; i++) {
    const step = route.steps[i];
    const next: OutputFile[] = [];
    for (const item of current) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const input = { data: item.data, name: item.name, from: step.from };
      const base = { step: i + 1, steps: route.steps.length };
      const c = step.converter;
      let outputs: OutputFile[];
      if (c.env === 'server') {
        outputs = await convertOnServer(c.id, input, step.to, req.options, (p) =>
          req.onProgress({ ...base, fraction: p.fraction, where: 'server', phase: p.phase }), signal);
      } else if (c.thread === 'main') {
        const load = MAIN_CONVERTERS[c.id];
        if (!load) throw new ConversionError('This conversion is not available.', 'unsupported');
        const convert = await load();
        outputs = await convert(input, {
          to: step.to,
          options: req.options,
          signal,
          onProgress: (fraction) => req.onProgress({ ...base, fraction, where: 'device' }),
        });
      } else {
        req.onProgress({ ...base, fraction: null, where: 'device' });
        outputs = await req.pool.run(c.id, input, step.to, req.options, signal);
      }
      next.push(...outputs);
    }
    current = next;
  }
  if (!current.length) throw new ConversionError('The conversion produced no files.', 'empty');
  return current;
}
