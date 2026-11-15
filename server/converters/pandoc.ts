import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { baseName, outputName } from '../../src/engine/filenames';
import { getFormat } from '../../src/engine/formats';
import { run, ToolError } from '../process';
import { JobError, type Job, type ServerConverter } from './types';

const READER: Record<string, string> = { md: 'gfm', html: 'html', docx: 'docx', odt: 'odt', epub: 'epub', rtf: 'rtf' };
const WRITER: Record<string, string> = { epub: 'epub3', docx: 'docx', odt: 'odt', html: 'html5', md: 'gfm', txt: 'plain', rtf: 'rtf' };
const STANDALONE = new Set(['html', 'rtf', 'epub']);

type Node = { t?: string; c?: unknown } | unknown[] | string | number | boolean | null;

/**
 * Images may only come from the document itself (extracted into the job folder) or data: URIs.
 * Anything else, such as "![](/etc/passwd)", is replaced by its description.
 */
export function confineImages(node: Node, root: string): Node {
  if (Array.isArray(node)) return node.map((n) => confineImages(n as Node, root));
  if (node && typeof node === 'object') {
    const obj = node as { t?: string; c?: unknown };
    if (obj.t === 'Image' && Array.isArray(obj.c)) {
      const [attr, alt, target] = obj.c as [unknown, Node[], [string, string]];
      const src = target?.[0] ?? '';
      const path = isAbsolute(src) ? src : resolve(root, src);
      const inside = !relative(root, path).startsWith('..') && !isAbsolute(relative(root, path));
      const ok = src.startsWith('data:') || (!/^[a-z][a-z0-9+.-]*:/i.test(src) && inside && existsSync(path));
      if (!ok) return { t: 'Span', c: [attr, confineImages(alt, root)] };
    }
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, confineImages(v as Node, root)]));
  }
  return node;
}

async function pandocRun(job: Job, args: string[]) {
  try {
    await run(job.tools.pandoc!, args, { cwd: job.dir, timeoutMs: job.config.timeouts.office, isolate: job.tools.isolate, signal: job.signal });
  } catch (e) {
    if (e instanceof ToolError && e.timedOut) throw new JobError('This document took too long to convert.', 422);
    throw new JobError(`This ${getFormat(job.from).label} file could not be converted. It may be damaged.`, 422);
  }
}

export const pandoc: ServerConverter = {
  id: 'pandoc',
  available: (t) => !!t.pandoc,
  async run(job) {
    const reader = READER[job.from];
    const writer = WRITER[job.to];
    if (!reader || !writer) throw new JobError('This conversion is not available on the server.', 400);
    const ast = join(job.dir, 'ast.json');
    const out = join(job.dir, `out.${getFormat(job.to).ext}`);
    const title = baseName(job.name);

    // 1. Read in the sandbox: the document cannot reach other files or the network.
    await pandocRun(job, ['--sandbox', '-f', reader, '-t', 'json', '--extract-media=media', '-o', ast, job.input]);

    // 2. Keep images inside the job folder and give untitled documents a title.
    const doc = JSON.parse(await readFile(ast, 'utf8')) as { meta: Record<string, unknown>; blocks: Node };
    doc.blocks = confineImages(doc.blocks, job.dir);
    if (!doc.meta.title && job.to === 'epub') doc.meta.title = { t: 'MetaString', c: title };
    await writeFile(ast, JSON.stringify(doc));

    // 3. Write the target format from the cleaned document.
    await pandocRun(job, [
      '-f', 'json',
      '-t', writer,
      ...(STANDALONE.has(job.to) ? ['--standalone'] : []),
      ...(job.to === 'html' ? ['--embed-resources', '--metadata', `pagetitle=${title}`] : []),
      '-o', out,
      ast,
    ]);
    return { path: out, name: outputName(job.name, job.to), format: job.to };
  },
};
