import { formatFromName } from './formats';

/** Bytes read from each end of a file for sniffing. */
export const SNIFF_BYTES = 64 * 1024;

export interface Detection {
  /** Detected format id, or null when the content is not recognised. */
  format: string | null;
  /** Set when the extension claims a different format than the content. */
  extensionMismatch?: string;
}

export interface SniffInput {
  name: string;
  head: Uint8Array;
  /** Last bytes of the file (may equal head for small files). */
  tail: Uint8Array;
}

const ascii = (b: Uint8Array, start: number, len: number) => {
  let s = '';
  for (let i = start; i < start + len && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

const startsWith = (b: Uint8Array, sig: number[], offset = 0) =>
  sig.every((v, i) => b[offset + i] === v);

const contains = (b: Uint8Array, text: string, utf16 = false): boolean => {
  const needle: number[] = [];
  for (const ch of text) {
    needle.push(ch.charCodeAt(0));
    if (utf16) needle.push(0);
  }
  outer: for (let i = 0; i + needle.length <= b.length; i++) {
    for (let j = 0; j < needle.length; j++) if (b[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};

const RAW_EXTS = ['dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'orf', 'rw2', 'raf', 'pef', 'srw'];

function sniffZip(head: Uint8Array, tail: Uint8Array, extId?: string): string {
  // ODF and EPUB store an uncompressed "mimetype" entry first.
  if (ascii(head, 30, 8) === 'mimetype') {
    const mt = ascii(head, 38, 60);
    if (mt.startsWith('application/epub+zip')) return 'epub';
    if (mt.startsWith('application/vnd.oasis.opendocument.text')) return 'odt';
    if (mt.startsWith('application/vnd.oasis.opendocument.spreadsheet')) return 'ods';
    if (mt.startsWith('application/vnd.oasis.opendocument.presentation')) return 'odp';
  }
  // Office Open XML: look for part names in local headers or the central directory.
  for (const b of [head, tail]) {
    if (contains(b, 'word/document') || contains(b, 'word/_rels')) return 'docx';
    if (contains(b, 'xl/workbook') || contains(b, 'xl/_rels')) return 'xlsx';
    if (contains(b, 'ppt/presentation') || contains(b, 'ppt/_rels')) return 'pptx';
  }
  // Large OOXML packages can push part names out of both windows; the extension decides.
  if (extId && ['docx', 'xlsx', 'pptx', 'epub', 'odt', 'ods', 'odp'].includes(extId)) {
    if (contains(head, '[Content_Types].xml') || contains(tail, '[Content_Types].xml') || contains(head, 'mimetype')) {
      return extId;
    }
  }
  return 'zip';
}

function sniffCfb(head: Uint8Array, tail: Uint8Array, extId?: string): string | null {
  for (const b of [head, tail]) {
    if (contains(b, 'WordDocument', true)) return 'doc';
    if (contains(b, 'Workbook', true) || contains(b, 'Book', true)) return 'xls';
    if (contains(b, 'PowerPoint Document', true)) return 'ppt';
  }
  if (extId === 'doc' || extId === 'xls' || extId === 'ppt') return extId;
  return null;
}

function sniffFtyp(b: Uint8Array, extId?: string): string | null {
  if (ascii(b, 4, 4) !== 'ftyp') return null;
  const size = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
  const brands = [ascii(b, 8, 4)];
  for (let i = 16; i + 4 <= Math.min(size, 64); i += 4) brands.push(ascii(b, i, 4));
  const major = brands[0];
  if (['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'].includes(major)) {
    return brands.includes('avif') ? 'avif' : 'heic';
  }
  if (major === 'avif' || major === 'avis') return 'avif';
  if (major === 'crx ') return null; // Canon CR3 raw
  if (major === 'qt  ') return 'mov';
  if (major === 'M4A ' || major === 'M4B ') return 'm4a';
  if (major.startsWith('3g')) return '3gp';
  if (extId === 'm4a' || extId === 'mov' || extId === '3gp') return extId;
  return 'mp4';
}

function sniffText(head: Uint8Array, extId?: string): string | null {
  // Reject binary content: NUL bytes never appear in the text formats we support.
  const sample = head.subarray(0, Math.min(head.length, 8192));
  for (let i = 0; i < sample.length; i++) if (sample[i] === 0) return null;
  let text: string;
  try {
    // A truncated multi-byte sequence at the end of the window is allowed.
    text = new TextDecoder('utf-8', { fatal: true }).decode(trimPartialUtf8(sample));
  } catch {
    text = new TextDecoder('latin1').decode(sample);
    if (/[\x01-\x08\x0e-\x1f]/.test(text)) return null;
  }
  const t = text.replace(/^﻿/, '').trimStart();
  const low = t.slice(0, 2048).toLowerCase();

  if (t.startsWith('{\\rtf')) return 'rtf';
  if (/<svg[\s>]/.test(low) && (low.startsWith('<svg') || low.startsWith('<?xml') || low.startsWith('<!--') || low.startsWith('<!doctype svg'))) {
    return 'svg';
  }
  if (low.startsWith('<!doctype html') || /^<html[\s>]/.test(low)) return 'html';

  const looksJson = t.startsWith('{') || t.startsWith('[');
  const looksXml = t.startsWith('<');

  switch (extId) {
    case 'json':
      return looksJson ? 'json' : 'txt';
    case 'xml':
      return looksXml ? 'xml' : 'txt';
    case 'html':
      return looksXml ? 'html' : 'txt';
    case 'svg':
      return 'txt';
    case 'rtf':
      return 'txt';
    case 'csv':
    case 'tsv':
    case 'yaml':
    case 'md':
    case 'sql':
    case 'txt':
      return extId;
  }
  // No helpful extension: guess from content.
  if (looksJson) return 'json';
  if (low.startsWith('<?xml')) return 'xml';
  if (/^<(html|head|body|p|div|h1)[\s>]/.test(low)) return 'html';
  return 'txt';
}

function trimPartialUtf8(b: Uint8Array): Uint8Array {
  let end = b.length;
  for (let i = 1; i <= 3 && end - i >= 0; i++) {
    const c = b[end - i];
    if ((c & 0xc0) === 0x80) continue; // continuation byte
    if (c >= 0xc0) {
      const need = c >= 0xf0 ? 4 : c >= 0xe0 ? 3 : 2;
      if (i < need) end -= i;
    }
    break;
  }
  return b.subarray(0, end);
}

function sniffBinary(head: Uint8Array, tail: Uint8Array, extId?: string): string | null {
  const b = head;
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpg';
  if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return 'gif';
  if (ascii(b, 0, 2) === 'BM' && b.length > 26) return 'bmp';
  if (startsWith(b, [0x00, 0x00, 0x01, 0x00]) && b[4] > 0 && b[5] === 0) return 'ico';
  if (ascii(b, 0, 4) === 'II*\0' || ascii(b, 0, 4) === 'MM\0*') {
    // DNG, CR2, NEF and ARW share the TIFF container; trust a raw extension.
    return extId && RAW_EXTS.includes(extId) ? null : 'tiff';
  }
  if (ascii(b, 0, 4) === 'RIFF') {
    const kind = ascii(b, 8, 4);
    if (kind === 'WEBP') return 'webp';
    if (kind === 'WAVE') return 'wav';
    if (kind === 'AVI ') return 'avi';
    return null;
  }
  if (ascii(b, 0, 4) === 'FORM' && (ascii(b, 8, 4) === 'AIFF' || ascii(b, 8, 4) === 'AIFC')) return 'aiff';
  if (ascii(b, 0, 5) === '%PDF-') return 'pdf';
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06])) {
    return sniffZip(head, tail, extId);
  }
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return sniffCfb(head, tail, extId);
  if (startsWith(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return '7z';
  if (startsWith(b, [0x1f, 0x8b])) return extId === 'targz' ? 'targz' : 'gz';
  if (ascii(b, 0, 3) === 'BZh' && b[3] >= 0x31 && b[3] <= 0x39) return extId === 'tarbz2' ? 'tarbz2' : 'bz2';
  if (startsWith(b, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return extId === 'tarxz' ? 'tarxz' : 'xz';
  if (ascii(b, 257, 5) === 'ustar') return 'tar';
  const ftyp = sniffFtyp(b, extId);
  if (ftyp) return ftyp;
  if (startsWith(b, [0x1a, 0x45, 0xdf, 0xa3])) {
    return contains(b.subarray(0, 64), 'webm') ? 'webm' : 'mkv';
  }
  if (ascii(b, 0, 4) === 'OggS') {
    return contains(b.subarray(0, 512), 'OpusHead') ? 'opus' : 'ogg';
  }
  if (ascii(b, 0, 4) === 'fLaC') return 'flac';
  if (ascii(b, 0, 3) === 'FLV') return 'flv';
  if (startsWith(b, [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11])) {
    // ASF: Windows Media. Look for the video stream GUID (BC19EFC0-5B4D-11CF-A8FD-00805F5C442B).
    const videoGuid = [0xc0, 0xef, 0x19, 0xbc, 0x4d, 0x5b, 0xcf, 0x11, 0xa8, 0xfd, 0x00, 0x80, 0x5f, 0x5c, 0x44, 0x2b];
    for (let i = 0; i + 16 <= b.length; i++) if (startsWith(b, videoGuid, i)) return 'wmv';
    return 'wma';
  }
  if (startsWith(b, [0x00, 0x00, 0x01, 0xba]) || startsWith(b, [0x00, 0x00, 0x01, 0xb3])) return 'mpeg';
  if (b[0] === 0x47 && b.length > 376 && b[188] === 0x47 && b[376] === 0x47) return 'mpeg';
  if (ascii(b, 0, 3) === 'ID3') {
    return extId === 'aac' ? 'aac' : 'mp3';
  }
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) {
    const layer = (b[1] >> 1) & 0x03;
    if (layer === 0) return 'aac'; // ADTS
    if (layer === 1) return 'mp3';
  }
  return null;
}

export function detect({ name, head, tail }: SniffInput): Detection {
  const byExt = formatFromName(name);
  const extId = byExt?.id;
  let format = sniffBinary(head, tail, extId);
  if (!format && head.length > 0) format = sniffText(head, extId);
  if (!format) return { format: null };
  // TAR inside GZ named .tgz etc. keeps the more specific extension.
  if (extId && byExt && format !== extId) {
    const sameFamily =
      (format === 'tar' && ['targz', 'tarbz2', 'tarxz'].includes(extId)) ||
      (format === 'mp4' && extId === 'm4a');
    if (!sameFamily) return { format, extensionMismatch: extId };
  }
  return { format };
}

/** Reads the two sniff windows from a browser File or Blob. */
export async function detectBlob(file: Blob & { name: string }): Promise<Detection> {
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
  const tail =
    file.size <= SNIFF_BYTES ? head : new Uint8Array(await file.slice(file.size - SNIFF_BYTES).arrayBuffer());
  return detect({ name: file.name, head, tail });
}
