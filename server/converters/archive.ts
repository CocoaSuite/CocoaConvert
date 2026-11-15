import { lstat, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { baseName, outputName, safeName } from '../../src/engine/filenames';
import { formatFromName } from '../../src/engine/formats';
import { LIMITS } from '../../src/engine/limits';
import { run, ToolError, type Tools } from '../process';
import { JobError, type Job, type ServerConverter } from './types';

const TOO_BIG = 'This archive expands to more data than can be handled safely.';

function budget(compressed: number) {
  return Math.min(LIMITS.maxExtractedBytes, Math.max(LIMITS.ratioCheckFloor, compressed * LIMITS.maxCompressionRatio));
}

async function exec(job: Job, cmd: string, args: string[], cwd = job.dir, extra: { stdoutFile?: string; maxStdoutBytes?: number } = {}) {
  try {
    return await run(cmd, args, { cwd, timeoutMs: job.config.timeouts.archive, isolate: job.tools.isolate, signal: job.signal, ...extra });
  } catch (e) {
    if (e instanceof ToolError && e.message === 'too-large') throw new JobError(TOO_BIG, 413);
    if (e instanceof ToolError && e.timedOut) throw new JobError('This archive took too long to process.', 422);
    throw new JobError('This archive could not be read. It may be damaged or password protected.', 422);
  }
}

/** Checks entry count and total size from the archive's own listing before extracting. */
async function checkListing(job: Job, compressed: number) {
  let count = 0;
  let total = 0;
  if (job.from === '7z' || job.from === 'zip') {
    // -p- answers any password prompt with nothing, so encrypted archives fail instead of hanging.
    const log = await exec(job, job.tools['7za']!, ['l', '-slt', '-ba', '-p-', job.input]);
    for (const m of log.matchAll(/^Size = (\d+)$/gm)) {
      total += Number(m[1]);
      count++;
    }
  } else {
    const log = await exec(job, job.tools.tar!, [job.from === 'targz' ? '-tzvf' : '-tvf', job.input]);
    for (const line of log.split('\n')) {
      const m = /^\S+\s+\S+\s+(\d+)\s/.exec(line);
      if (m) {
        total += Number(m[1]);
        count++;
      }
    }
  }
  if (count > LIMITS.maxArchiveEntries) throw new JobError(`This archive holds more than ${LIMITS.maxArchiveEntries} files.`, 413);
  if (total > budget(compressed)) throw new JobError(TOO_BIG, 413);
}

/** Removes links and anything outside the folder; returns the size of what is left. */
async function sanitiseTree(root: string): Promise<number> {
  let total = 0;
  const walk = async (dir: string) => {
    for (const name of await readdir(dir)) {
      const p = join(dir, name);
      if (relative(root, p).startsWith('..')) continue;
      const s = await lstat(p);
      if (s.isSymbolicLink() || (!s.isFile() && !s.isDirectory())) await rm(p, { force: true });
      else if (s.isDirectory()) await walk(p);
      else total += s.size;
    }
  };
  await walk(root);
  return total;
}

async function extract(job: Job, into: string) {
  await mkdir(into);
  const compressed = (await stat(job.input)).size;
  await checkListing(job, compressed);
  if (job.from === '7z' || job.from === 'zip') {
    await exec(job, job.tools['7za']!, ['x', '-y', '-bd', '-p-', `-o${into}`, job.input]);
  } else {
    await exec(job, job.tools.tar!, [
      job.from === 'targz' ? '-xzf' : '-xf', job.input, '-C', into,
      '--no-same-owner', '--no-same-permissions', '--no-overwrite-dir',
    ]);
  }
  if ((await sanitiseTree(into)) > budget(compressed)) throw new JobError(TOO_BIG, 413);
}

async function decompress(job: Job, tool: string, out: string) {
  const limit = budget((await stat(job.input)).size);
  await exec(job, tool, ['-dc', job.input], job.dir, { stdoutFile: out, maxStdoutBytes: limit });
}

export const archive: ServerConverter = {
  id: 'archive-native',
  available: (t: Tools) => !!(t['7za'] && t.tar && t.xz && t.bzip2),
  async run(job) {
    const { from, to } = job;
    const out = join(job.dir, 'out');

    if (to === '7z' || ((to === 'zip' || to === 'tar') && from === '7z')) {
      const tree = join(job.dir, 'tree');
      await extract(job, tree);
      if (to === 'tar') await exec(job, job.tools.tar!, ['-cf', out, '-C', tree, '.']);
      else await exec(job, job.tools['7za']!, ['a', `-t${to}`, '-bd', '-mx=5', out, '.'], tree);
      // 7za adds the extension when the name has none.
      const made = (await readdir(job.dir)).find((n) => n.startsWith('out'))!;
      return { path: join(job.dir, made), name: outputName(job.name, to), format: to };
    }

    if ((from === 'bz2' || from === 'xz') && to === 'files') {
      await decompress(job, from === 'bz2' ? job.tools.bzip2! : job.tools.xz!, out);
      const inner = safeName(baseName(job.name), 'file');
      return { path: out, name: inner, format: formatFromName(inner)?.id ?? 'files' };
    }

    if ((from === 'tarbz2' || from === 'tarxz') && to === 'tar') {
      await decompress(job, from === 'tarbz2' ? job.tools.bzip2! : job.tools.xz!, out);
      return { path: out, name: outputName(job.name, 'tar'), format: 'tar' };
    }

    if (from === 'tar' && (to === 'tarbz2' || to === 'tarxz')) {
      const args = to === 'tarxz' ? ['-c', '-6', '-T0', job.input] : ['-c', '-9', job.input];
      await exec(job, to === 'tarxz' ? job.tools.xz! : job.tools.bzip2!, args, job.dir, { stdoutFile: out });
      return { path: out, name: outputName(job.name, to), format: to };
    }

    throw new JobError('This conversion is not available on the server.', 400);
  },
};
