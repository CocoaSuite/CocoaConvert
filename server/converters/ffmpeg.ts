import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { explainFfmpegFailure, ffmpegArgs } from '../../src/converters/media/args';
import { outputName } from '../../src/engine/filenames';
import { getFormat } from '../../src/engine/formats';
import { run, ToolError } from '../process';
import { JobError, type ServerConverter } from './types';

export const ffmpeg: ServerConverter = {
  id: 'ffmpeg',
  available: (t) => !!t.ffmpeg,
  async run(job) {
    const out = join(job.dir, `out.${getFormat(job.to).ext}`);
    const args = ['-loglevel', 'info', ...ffmpegArgs(job.from, job.to, job.input, out, job.options)];
    try {
      await run(job.tools.ffmpeg!, args, {
        cwd: job.dir,
        timeoutMs: job.config.timeouts.media,
        isolate: job.tools.isolate,
        signal: job.signal,
      });
    } catch (e) {
      if (e instanceof ToolError && e.timedOut) throw new JobError('This file took too long to convert.', 422);
      throw new JobError(explainFfmpegFailure(e instanceof ToolError ? e.log : '', job.from, job.to), 422);
    }
    if (!(await stat(out)).size) throw new JobError(explainFfmpegFailure('', job.from, job.to), 422);
    return { path: out, name: outputName(job.name, job.to), format: job.to };
  },
};
