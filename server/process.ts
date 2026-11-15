import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { delimiter, join } from 'node:path';

const require = createRequire(import.meta.url);

export interface Tools {
  soffice?: string;
  pandoc?: string;
  ffmpeg?: string;
  tar?: string;
  xz?: string;
  bzip2?: string;
  '7za'?: string;
  /** Command prefix that runs a tool without network access, when the OS allows it. */
  isolate: string[];
}

function which(names: string[]): string | undefined {
  const dirs = (process.env.PATH ?? '').split(delimiter);
  for (const name of names) {
    for (const dir of dirs) {
      const p = join(dir, name);
      const r = spawnSync(p, ['--version'], { stdio: 'ignore', timeout: 20_000 });
      if (!r.error) return p;
    }
  }
  return undefined;
}

export async function detectTools(): Promise<Tools> {
  let sevenZip: string | undefined;
  try {
    sevenZip = (require('7zip-bin') as { path7za: string }).path7za;
    await chmod(sevenZip, 0o755);
    if (spawnSync(sevenZip, ['i'], { stdio: 'ignore' }).error) sevenZip = undefined;
  } catch {
    sevenZip = undefined;
  }
  // "unshare -rn" gives the child an empty network namespace without root, where the kernel allows it.
  const isolate =
    process.platform === 'linux' && spawnSync('unshare', ['-rn', 'true'], { stdio: 'ignore' }).status === 0
      ? ['unshare', '-rn']
      : [];
  return {
    soffice: which(['soffice', 'libreoffice']),
    pandoc: which(['pandoc']),
    ffmpeg: which(['ffmpeg']),
    tar: which(['tar']),
    xz: which(['xz']),
    bzip2: which(['bzip2']),
    '7za': sevenZip,
    isolate,
  };
}

export class ToolError extends Error {
  constructor(
    message: string,
    readonly log: string,
    readonly timedOut = false,
  ) {
    super(message);
  }
}

export interface RunOptions {
  cwd: string;
  timeoutMs: number;
  isolate: string[];
  /** Write stdout to this file instead of collecting it. */
  stdoutFile?: string;
  /** Kill the process once stdout passes this many bytes. */
  maxStdoutBytes?: number;
  signal?: AbortSignal;
}

/**
 * Runs a tool with an argument list (never a shell), a private HOME and TMPDIR,
 * no inherited secrets, and a hard timeout.
 */
export function run(cmd: string, args: string[], opts: RunOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const [bin, ...pre] = opts.isolate.length ? [...opts.isolate, cmd] : [cmd];
    const child = spawn(bin, [...pre, ...args], {
      cwd: opts.cwd,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: opts.cwd,
        TMPDIR: opts.cwd,
        LANG: 'C.UTF-8',
        LC_ALL: 'C.UTF-8',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let log = '';
    let killedFor: 'timeout' | 'size' | 'abort' | null = null;
    const kill = (why: typeof killedFor) => {
      killedFor = why;
      try {
        // Negative pid: the whole process group, so helpers (LibreOffice's soffice.bin) go too.
        if (child.pid) process.kill(process.platform === 'win32' ? child.pid : -child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(() => kill('timeout'), opts.timeoutMs);
    opts.signal?.addEventListener('abort', () => kill('abort'), { once: true });
    const keep = (chunk: Buffer) => {
      log += chunk.toString('utf8');
      if (log.length > 64_000) log = log.slice(-32_000);
    };
    child.stderr.on('data', keep);
    let flushed: Promise<void> = Promise.resolve();
    if (opts.stdoutFile) {
      const out = createWriteStream(opts.stdoutFile);
      flushed = new Promise((r) => out.on('close', () => r()));
      let written = 0;
      child.stdout.on('data', (chunk: Buffer) => {
        written += chunk.length;
        if (opts.maxStdoutBytes && written > opts.maxStdoutBytes) kill('size');
      });
      child.stdout.pipe(out);
    } else child.stdout.on('data', keep);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new ToolError(`Could not start ${cmd}`, String(e)));
    });
    child.on('close', async (code) => {
      clearTimeout(timer);
      await flushed;
      if (killedFor === 'timeout') return reject(new ToolError('timeout', log, true));
      if (killedFor === 'size') return reject(new ToolError('too-large', log));
      if (killedFor === 'abort') return reject(new ToolError('aborted', log));
      if (code !== 0) return reject(new ToolError(`exit ${code}`, log));
      resolve(log);
    });
  });
}
