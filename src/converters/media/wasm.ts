import { FFmpeg } from '@ffmpeg/ffmpeg';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import { outputName } from '../../engine/filenames';
import { getFormat } from '../../engine/formats';
import { ConversionError, type ConvertFn, type ConvertInput, type ConvertContext, type OutputFile } from '../../engine/types';
import { explainFfmpegFailure, ffmpegArgs, ProgressParser } from './args';

/**
 * FFmpeg's WebAssembly heap only grows, so after many jobs it can run out and abort.
 * A fresh engine every RECYCLE_AFTER jobs, and after any crash, keeps long batches reliable.
 */
const RECYCLE_AFTER = 16;

let engine: Promise<FFmpeg> | null = null;
let jobs = 0;

function load(): Promise<FFmpeg> {
  if (!engine) {
    jobs = 0;
    engine = (async () => {
      const ff = new FFmpeg();
      await ff.load({ coreURL, wasmURL });
      return ff;
    })().catch(() => {
      engine = null;
      throw new ConversionError('The audio and video engine could not start in this browser.', 'environment');
    });
  }
  return engine;
}

async function discard() {
  const current = engine;
  engine = null;
  if (current) {
    try {
      (await current).terminate();
    } catch {
      /* already gone */
    }
  }
}

class Crash extends Error {}

async function attempt(input: ConvertInput, data: Uint8Array, ctx: ConvertContext): Promise<OutputFile[]> {
  const { to, options, onProgress, signal } = ctx;
  if (jobs >= RECYCLE_AFTER) await discard();
  const ff = await load();
  jobs++;
  const inPath = `in.${getFormat(input.from).ext}`;
  const outPath = `out.${getFormat(to).ext}`;
  const log: string[] = [];
  const parser = new ProgressParser((p) => onProgress?.(p));
  const onLog = ({ message }: { message: string }) => {
    if (log.length > 400) log.shift();
    log.push(message);
    parser.line(message);
  };
  let aborted = false;
  const abort = () => {
    aborted = true;
    // Terminating is the only way to stop a running FFmpeg; the next job loads a fresh one.
    void discard();
  };
  signal?.addEventListener('abort', abort, { once: true });
  ff.on('log', onLog);
  onProgress?.(null);
  try {
    // A copy goes to the engine, so a retry still has the original bytes.
    await ff.writeFile(inPath, data.slice());
    let code: number;
    try {
      code = await ff.exec(ffmpegArgs(input.from, to, inPath, outPath, options, 'browser'));
    } catch (e) {
      throw new Crash(String(e));
    }
    if (code !== 0) {
      // Exit code 1 with a reason in the log is a real conversion error; anything else is a crash.
      if (/Aborted|RuntimeError|out of bounds|OOM/i.test(log.slice(-5).join('\n')) && !/Invalid data|does not contain/i.test(log.join('\n'))) {
        throw new Crash(log.slice(-3).join(' '));
      }
      throw new ConversionError(explainFfmpegFailure(log.join('\n'), input.from, to), 'failed');
    }
    const out = (await ff.readFile(outPath)) as Uint8Array;
    if (!out.length) throw new ConversionError(explainFfmpegFailure(log.join('\n'), input.from, to), 'failed');
    onProgress?.(1);
    return [{ name: outputName(input.name, to), data: out, format: to }];
  } catch (e) {
    if (aborted) throw new DOMException('Cancelled', 'AbortError');
    throw e;
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!aborted && engine) {
      ff.off('log', onLog);
      await ff.deleteFile(inPath).catch(() => undefined);
      await ff.deleteFile(outPath).catch(() => undefined);
    }
  }
}

export const convertMediaWasm: ConvertFn = async (input, ctx) => {
  try {
    return await attempt(input, input.data, ctx);
  } catch (e) {
    if (!(e instanceof Crash)) throw e;
    // The engine is in an unknown state: start over once on a fresh one.
    await discard();
    try {
      return await attempt(input, input.data, ctx);
    } catch (again) {
      if (!(again instanceof Crash)) throw again;
      await discard();
      throw new ConversionError(
        'There is not enough memory in this browser for this file. Try a smaller file or allow server conversion.',
        'resources',
      );
    }
  }
};
