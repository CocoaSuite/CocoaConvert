import { Gunzip, Unzip, UnzipInflate, gzipSync, zipSync, type Zippable } from 'fflate';
import { baseName, outputName, safeEntryPath, uniqueName } from '../../engine/filenames';
import { formatFromName } from '../../engine/formats';
import { LIMITS } from '../../engine/limits';
import { ConversionError, type ConvertFn } from '../../engine/types';
import { zipLevel } from './levels';
import { readTar, writeTar, type Entry } from './tar';

type Limits = { [K in keyof typeof LIMITS]: number };

class Budget {
  total = 0;
  count = 0;
  constructor(private compressed: number, private limits: Limits) {}
  addEntry() {
    if (++this.count > this.limits.maxArchiveEntries) {
      throw new ConversionError(`This archive holds more than ${this.limits.maxArchiveEntries} files.`, 'too-large');
    }
  }
  addBytes(n: number) {
    this.total += n;
    const ratioBlown =
      this.total > this.limits.ratioCheckFloor && this.total > this.compressed * this.limits.maxCompressionRatio;
    if (this.total > this.limits.maxExtractedBytes || ratioBlown) {
      throw new ConversionError('This archive expands to more data than can be handled safely.', 'too-large');
    }
  }
}

const concat = (chunks: Uint8Array[]) => {
  const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
};

/** Streams through the ZIP so declared sizes cannot hide an archive bomb. */
export function readZip(data: Uint8Array, limits: Limits = LIMITS): Entry[] {
  const budget = new Budget(data.length, limits);
  const entries: Entry[] = [];
  let failure: unknown = null;
  const unzip = new Unzip((file) => {
    if (failure) return;
    if (file.name.endsWith('/')) return;
    if (file.compression !== 0 && file.compression !== 8) {
      failure = new ConversionError('This ZIP uses a compression method that is not supported.', 'unsupported');
      return;
    }
    const path = safeEntryPath(file.name);
    if (!path) return;
    try {
      budget.addEntry();
    } catch (e) {
      failure = e;
      return;
    }
    const chunks: Uint8Array[] = [];
    file.ondata = (err, chunk, final) => {
      if (failure) return;
      if (err) {
        failure = new ConversionError('This ZIP is damaged or password protected.', 'corrupt');
        return;
      }
      try {
        budget.addBytes(chunk.length);
      } catch (e) {
        failure = e;
        file.terminate();
        return;
      }
      chunks.push(chunk);
      if (final) entries.push({ path, data: concat(chunks) });
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    unzip.push(data, true);
  } catch {
    if (!failure) failure = new ConversionError('This ZIP is damaged or password protected.', 'corrupt');
  }
  if (failure) throw failure;
  return entries;
}

export function gunzipLimited(data: Uint8Array, limits: Limits = LIMITS): Uint8Array {
  const budget = new Budget(data.length, limits);
  const chunks: Uint8Array[] = [];
  let failure: unknown = null;
  const g = new Gunzip((chunk) => {
    if (failure) return;
    try {
      budget.addBytes(chunk.length);
      chunks.push(chunk);
    } catch (e) {
      failure = e;
    }
  });
  try {
    // Feed in slices so a bomb is stopped before it fills memory.
    const step = 1 << 20;
    for (let i = 0; i < data.length && !failure; i += step) g.push(data.subarray(i, i + step), i + step >= data.length);
  } catch {
    throw new ConversionError('This GZ file is damaged.', 'corrupt');
  }
  if (failure) throw failure;
  return concat(chunks);
}

function readEntries(from: string, data: Uint8Array, limits: Limits): Entry[] {
  switch (from) {
    case 'zip':
      return readZip(data, limits);
    case 'tar':
      return readTar(data, limits);
    case 'targz':
      return readTar(gunzipLimited(data, limits), limits);
    default:
      throw new ConversionError(`Cannot open ${from} archives here.`, 'unsupported');
  }
}

export function writeZip(entries: Entry[]): Uint8Array {
  const tree: Zippable = {};
  const taken = new Set<string>();
  for (const e of entries) {
    const path = uniqueName(e.path, taken);
    tree[path] = [e.data, { level: zipLevel(path), mtime: e.mtime ? new Date(e.mtime * 1000) : undefined }];
  }
  return zipSync(tree);
}

export function makeArchiveConverter(limits: Limits = LIMITS): ConvertFn {
  return async (input, { to }) => {
    if (input.from === 'gz') {
      const data = gunzipLimited(input.data, limits);
      const inner = baseName(input.name) || 'file';
      return [{ name: inner, data, format: formatFromName(inner)?.id ?? 'files' }];
    }
    const entries = readEntries(input.from, input.data, limits);
    if (to === 'files') {
      if (!entries.length) throw new ConversionError('This archive is empty.', 'empty');
      return entries.map((e) => ({ name: e.path, data: e.data, format: formatFromName(e.path)?.id ?? 'files' }));
    }
    let data: Uint8Array;
    if (to === 'zip') data = writeZip(entries);
    else if (to === 'tar') data = writeTar(entries);
    else if (to === 'targz') data = gzipSync(writeTar(entries), { level: 6 });
    else throw new ConversionError(`Cannot write ${to} archives here.`, 'unsupported');
    return [{ name: outputName(input.name, to), data, format: to }];
  };
}

export const convertArchive = makeArchiveConverter();
