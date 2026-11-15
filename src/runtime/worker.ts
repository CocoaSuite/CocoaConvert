/// <reference lib="webworker" />
import { WORKER_CONVERTERS } from '../converters/loaders';
import { ConversionError, type ConvertOptions, type OutputFile } from '../engine/types';

export interface JobMessage {
  id: number;
  converter: string;
  data: Uint8Array;
  name: string;
  from: string;
  to: string;
  options: ConvertOptions;
}

export type ResultMessage =
  | { id: number; ok: true; outputs: OutputFile[] }
  | { id: number; ok: false; message: string; code: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (e: MessageEvent<JobMessage>) => {
  const job = e.data;
  try {
    const load = WORKER_CONVERTERS[job.converter];
    if (!load) throw new ConversionError('This conversion is not available.', 'unsupported');
    const convert = await load();
    const outputs = await convert({ data: job.data, name: job.name, from: job.from }, { to: job.to, options: job.options });
    const transfer = outputs.map((o) => o.data.buffer).filter((b, i, all) => all.indexOf(b) === i) as ArrayBuffer[];
    scope.postMessage({ id: job.id, ok: true, outputs } satisfies ResultMessage, transfer);
  } catch (err) {
    const known = err instanceof ConversionError;
    const message = known
      ? err.message
      : err instanceof RangeError
        ? 'There is not enough memory in this browser for this file.'
        : 'The conversion did not finish. The file may be damaged.';
    if (!known) console.error(err);
    scope.postMessage({ id: job.id, ok: false, message, code: known ? err.code : 'failed' } satisfies ResultMessage);
  }
};
