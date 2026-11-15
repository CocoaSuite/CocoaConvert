import { safeEntryPath } from '../../engine/filenames';
import { LIMITS } from '../../engine/limits';
import { ConversionError } from '../../engine/types';

export interface Entry {
  path: string;
  data: Uint8Array;
  mtime?: number;
}

const BLOCK = 512;
const dec = new TextDecoder('utf-8');
const enc = new TextEncoder();

const str = (b: Uint8Array, start: number, len: number) => {
  const slice = b.subarray(start, start + len);
  const end = slice.indexOf(0);
  return dec.decode(end === -1 ? slice : slice.subarray(0, end));
};

const octal = (b: Uint8Array, start: number, len: number) => {
  // GNU base-256 for sizes over 8 GB.
  if (b[start] & 0x80) {
    let v = 0;
    for (let i = start + 1; i < start + len; i++) v = v * 256 + b[i];
    return v;
  }
  const s = str(b, start, len).trim();
  return s ? parseInt(s, 8) : 0;
};

function parsePax(data: Uint8Array): Record<string, string> {
  // Record lengths count bytes, so parse bytes and decode each record separately.
  const out: Record<string, string> = {};
  let i = 0;
  while (i < data.length) {
    const sp = data.indexOf(0x20, i);
    if (sp === -1) break;
    const len = parseInt(dec.decode(data.subarray(i, sp)), 10);
    if (!len || i + len > data.length) break;
    const record = dec.decode(data.subarray(sp + 1, i + len - 1));
    const eq = record.indexOf('=');
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    i += len;
  }
  return out;
}

/** Reads regular files from a TAR. Links, devices and unsafe paths are skipped. */
export function readTar(data: Uint8Array, limits: { maxArchiveEntries: number; maxExtractedBytes: number } = LIMITS): Entry[] {
  const entries: Entry[] = [];
  let offset = 0;
  let longName: string | null = null;
  let pax: Record<string, string> = {};
  let total = 0;

  while (offset + BLOCK <= data.length) {
    const h = data.subarray(offset, offset + BLOCK);
    if (h.every((v) => v === 0)) break;
    const checksum = octal(h, 148, 8);
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (sum !== checksum) throw new ConversionError('This TAR archive is damaged.', 'corrupt');

    const size = octal(h, 124, 12);
    const type = String.fromCharCode(h[156] || 48);
    const bodyStart = offset + BLOCK;
    if (bodyStart + size > data.length) throw new ConversionError('This TAR archive is cut short.', 'corrupt');
    const body = data.subarray(bodyStart, bodyStart + size);
    offset = bodyStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'L') {
      longName = str(body, 0, body.length);
      continue;
    }
    if (type === 'x') {
      pax = parsePax(body);
      continue;
    }
    if (type === 'g') continue;

    const prefix = str(h, 345, 155);
    const name = pax.path ?? longName ?? (prefix ? `${prefix}/${str(h, 0, 100)}` : str(h, 0, 100));
    longName = null;
    pax = {};

    if (type !== '0' && type !== '7') continue; // directories, links, devices
    const path = safeEntryPath(name);
    if (!path) continue;
    total += size;
    if (entries.length + 1 > limits.maxArchiveEntries) {
      throw new ConversionError(`This archive holds more than ${limits.maxArchiveEntries} files.`, 'too-large');
    }
    if (total > limits.maxExtractedBytes) {
      throw new ConversionError('This archive expands to more data than can be handled safely.', 'too-large');
    }
    entries.push({ path, data: body.slice(), mtime: octal(h, 136, 12) });
  }
  return entries;
}

function writeOctal(h: Uint8Array, start: number, len: number, value: number) {
  const s = value.toString(8).padStart(len - 1, '0');
  h.set(enc.encode(s.slice(-(len - 1))), start);
  h[start + len - 1] = 0;
}

function header(name: string, size: number, mtime: number, type = '0'): Uint8Array {
  const h = new Uint8Array(BLOCK);
  h.set(enc.encode(name).subarray(0, 100), 0);
  writeOctal(h, 100, 8, 0o644);
  writeOctal(h, 108, 8, 0);
  writeOctal(h, 116, 8, 0);
  writeOctal(h, 124, 12, size);
  writeOctal(h, 136, 12, mtime);
  h.fill(32, 148, 156);
  h[156] = type.charCodeAt(0);
  h.set(enc.encode('ustar\x0000'), 257);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += h[i];
  writeOctal(h, 148, 7, sum);
  h[155] = 32;
  return h;
}

/** Writes a POSIX TAR. Long or non-ASCII paths use a PAX header. */
export function writeTar(entries: Entry[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const now = Math.floor(Date.now() / 1000);
  const pad = (n: number) => new Uint8Array((BLOCK - (n % BLOCK)) % BLOCK);
  for (const e of entries) {
    const mtime = e.mtime ?? now;
    const nameBytes = enc.encode(e.path);
    if (nameBytes.length > 100 || /[^\x20-\x7e]/.test(e.path)) {
      const rec = (len: number) => `${len} path=${e.path}\n`;
      let len = enc.encode(rec(0)).length;
      while (enc.encode(rec(len)).length !== len) len = enc.encode(rec(len)).length;
      const body = enc.encode(rec(len));
      parts.push(header('PaxHeader', body.length, mtime, 'x'), body, pad(body.length));
    }
    const short = e.path.length > 100 ? e.path.slice(-100) : e.path;
    parts.push(header(short.replace(/[^\x20-\x7e]/g, '_'), e.data.length, mtime), e.data, pad(e.data.length));
  }
  parts.push(new Uint8Array(BLOCK * 2));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
