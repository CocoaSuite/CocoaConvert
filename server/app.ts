import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, open, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { once } from 'node:events';
import { detect, SNIFF_BYTES } from '../src/engine/detect';
import { safeName } from '../src/engine/filenames';
import { findFormat, getFormat } from '../src/engine/formats';
import { CONVERTERS } from '../src/engine/registry';
import type { ConvertOptions } from '../src/engine/types';
import type { ServerConfig } from './config';
import { archive } from './converters/archive';
import { ffmpeg } from './converters/ffmpeg';
import { libreoffice } from './converters/libreoffice';
import { pandoc } from './converters/pandoc';
import { JobError, type ServerConverter } from './converters/types';
import type { Tools } from './process';

const ALL: ServerConverter[] = [libreoffice, pandoc, ffmpeg, archive];

/** Caps simultaneous jobs; extra requests wait in a short queue, beyond it they are turned away. */
class Gate {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(
    private limit: number,
    private queueLimit: number,
  ) {}
  async enter(): Promise<boolean> {
    if (this.active < this.limit) {
      this.active++;
      return true;
    }
    if (this.queue.length >= this.queueLimit) return false;
    await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    return true;
  }
  leave() {
    this.active--;
    this.queue.shift()?.();
  }
}

async function sniffFile(path: string, name: string) {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const head = Buffer.alloc(Math.min(size, SNIFF_BYTES));
    await fh.read(head, 0, head.length, 0);
    const tail = Buffer.alloc(Math.min(size, SNIFF_BYTES));
    await fh.read(tail, 0, tail.length, Math.max(0, size - tail.length));
    return detect({ name, head, tail });
  } finally {
    await fh.close();
  }
}

/** Some formats share a container; these sniff results still match the claimed source. */
function sameSource(claimed: string, sniffed: string | null): boolean {
  if (sniffed === claimed) return true;
  const fam: Record<string, string[]> = {
    m4a: ['mp4'],
    mp4: ['m4a', 'mov', '3gp'],
    mov: ['mp4'],
    targz: ['gz'],
    tarbz2: ['bz2'],
    tarxz: ['xz'],
    wma: ['wmv'],
    wmv: ['wma'],
    ogg: ['opus'],
    xls: ['doc', 'ppt'],
  };
  return !!sniffed && (fam[claimed] ?? []).includes(sniffed);
}

/** Deletes job folders left behind by a crash or restart. */
export async function sweep(root: string, olderThanMs = 15 * 60 * 1000) {
  if (!existsSync(root)) return;
  const now = Date.now();
  for (const name of await readdir(root)) {
    const p = join(root, name);
    try {
      if (now - (await stat(p)).mtimeMs > olderThanMs) await rm(p, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
  }
}

export async function buildApp(config: ServerConfig, tools: Tools): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers["x-file-name"]'] },
    bodyLimit: config.maxUploadBytes,
    trustProxy: process.env.TRUST_PROXY === '1',
  });
  await mkdir(config.workRoot, { recursive: true, mode: 0o700 });
  await sweep(config.workRoot, 0);
  const timer = setInterval(() => void sweep(config.workRoot), 5 * 60 * 1000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));

  const enabled = new Map(
    ALL.filter((c) => c.available(tools) && !config.disabled.includes(c.id)).map((c) => [c.id, c]),
  );
  const gate = new Gate(config.concurrency, config.queueLimit);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    reply.header(
      'content-security-policy',
      [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "worker-src 'self' blob:",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' blob: data:",
        "media-src 'self' blob:",
        "font-src 'self'",
        "connect-src 'self' blob: data:",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'none'",
      ].join('; '),
    );
  });

  // Uploads are streamed straight to the job folder, never buffered whole.
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));

  app.get('/api/capabilities', async () => ({
    converters: [...enabled.keys()],
    maxUploadBytes: config.maxUploadBytes,
  }));

  await app.register(async (api) => {
    await api.register(fastifyRateLimit, { max: config.rateLimit, timeWindow: '1 minute' });

    api.post('/api/convert', async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      const converter = enabled.get(q.converter ?? '');
      const def = CONVERTERS.find((c) => c.id === q.converter);
      const from = q.from ?? '';
      const to = q.to ?? '';
      if (!converter || !def || !def.edges.some((e) => e.from === from && e.to === to)) {
        return reply.code(400).send({ error: 'This conversion is not available on the server.' });
      }
      let options: ConvertOptions = {};
      try {
        const parsed = JSON.parse(q.options ?? '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed)) {
            if (/^[a-zA-Z]{1,32}$/.test(k) && (typeof v === 'number' || (typeof v === 'string' && /^[\w.-]{0,32}$/.test(v)))) {
              options[k] = v as string | number;
            }
          }
        }
      } catch {
        options = {};
      }
      let name = 'file';
      try {
        name = safeName(decodeURIComponent(String(req.headers['x-file-name'] ?? 'file')).slice(0, 255));
      } catch {
        /* keep default */
      }

      const limit = Math.min(config.maxUploadBytes, def.maxBytes);
      if (Number(req.headers['content-length']) > limit) {
        return reply.code(413).send({ error: 'This file is larger than the server accepts.' });
      }
      if (!(await gate.enter())) {
        return reply.code(503).send({ error: 'The server is busy. Try again in a minute.' });
      }
      const dir = await mkdtemp(join(config.workRoot, 'job-'));
      const ctl = new AbortController();
      const onAbort = () => ctl.abort();
      req.raw.on('close', () => {
        if (!reply.sent) onAbort();
      });
      let released = false;
      const cleanup = async () => {
        if (!released) {
          released = true;
          gate.leave();
        }
        await rm(dir, { recursive: true, force: true });
      };

      try {
        // A fixed file name inside a private folder: user-supplied names never reach the file system.
        const input = join(dir, `input.${getFormat(from).ext}`);
        // Count while writing. Past the limit, keep reading (and discarding) so the 413 reaches the client.
        let size = 0;
        let tooBig = false;
        const file = createWriteStream(input, { mode: 0o600 });
        for await (const chunk of req.body as Readable) {
          size += (chunk as Buffer).length;
          if (size > limit) tooBig = true;
          if (!tooBig && !file.write(chunk)) await once(file, 'drain');
        }
        file.end();
        await once(file, 'close');
        if (tooBig) throw new JobError('This file is larger than the server accepts.', 413);
        if (!size) throw new JobError('The file is empty.', 400);

        const sniffed = await sniffFile(input, `input.${getFormat(from).ext}`);
        if (!sameSource(from, sniffed.format)) {
          const what = sniffed.format ? findFormat(sniffed.format)?.label : null;
          throw new JobError(
            `This file does not look like ${getFormat(from).label}${what ? ` (it looks like ${what})` : ''}.`,
            415,
          );
        }

        const result = await converter.run({ dir, input, from, to, options, name, tools, config, signal: ctl.signal });
        const { size: outSize } = await stat(result.path);
        const stream = createReadStream(result.path);
        stream.on('close', () => void cleanup());
        return reply
          .header('content-type', findFormat(result.format)?.mime ?? 'application/octet-stream')
          .header('content-length', outSize)
          .header('content-disposition', `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(result.name)}`)
          .header('x-output-name', encodeURIComponent(result.name))
          .header('x-output-format', result.format)
          .header('cache-control', 'no-store')
          .send(stream);
      } catch (e) {
        await cleanup();
        if (e instanceof JobError) return reply.code(e.status).send({ error: e.message });
        if ((e as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE' || (e as Error).message?.includes('larger')) {
          return reply.code(413).send({ error: 'This file is larger than the server accepts.' });
        }
        req.log.error({ err: (e as Error).message }, 'conversion failed');
        return reply.code(500).send({ error: 'The conversion did not finish on the server.' });
      }
    });
  });

  if (config.staticDir && existsSync(join(config.staticDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: config.staticDir,
      maxAge: 0,
      setHeaders(res, path) {
        // Hashed build assets never change; the page itself is always revalidated.
        if (/[\\/]assets[\\/]/.test(path)) res.header('cache-control', 'public, max-age=31536000, immutable');
        else res.header('cache-control', 'no-cache');
      },
    });
  }
  return app;
}
