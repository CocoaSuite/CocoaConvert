/**
 * Pure-JS image codecs that run anywhere (worker, main thread or Node).
 * Browser-only codecs (canvas, WebAssembly) live in ./browser.ts.
 */
import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import * as UTIF from 'utif2';
import { LIMITS } from '../../engine/limits';
import { ConversionError } from '../../engine/types';

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, not premultiplied. */
  data: Uint8ClampedArray;
}

export function checkSize(width: number, height: number): void {
  if (!width || !height) throw new ConversionError('This image has no pixels.', 'corrupt');
  if (width * height > LIMITS.maxImagePixels) {
    const mp = Math.round(LIMITS.maxImagePixels / 1e6);
    throw new ConversionError(`This image is larger than ${mp} megapixels, the most that can be converted safely.`, 'too-large');
  }
}

export function hasAlpha(p: Pixels): boolean {
  for (let i = 3; i < p.data.length; i += 4) if (p.data[i] !== 255) return true;
  return false;
}

/** Composites onto a solid background, for formats without transparency. */
export function flatten(p: Pixels, bg: [number, number, number] = [255, 255, 255]): Pixels {
  const out = new Uint8ClampedArray(p.data.length);
  for (let i = 0; i < p.data.length; i += 4) {
    const a = p.data[i + 3] / 255;
    out[i] = p.data[i] * a + bg[0] * (1 - a);
    out[i + 1] = p.data[i + 1] * a + bg[1] * (1 - a);
    out[i + 2] = p.data[i + 2] * a + bg[2] * (1 - a);
    out[i + 3] = 255;
  }
  return { width: p.width, height: p.height, data: out };
}

/** 24-bit BMP, bottom-up rows. Transparency is flattened onto white. */
export function encodeBmp(src: Pixels): Uint8Array {
  const p = flatten(src);
  const rowSize = Math.ceil((p.width * 3) / 4) * 4;
  const imageSize = rowSize * p.height;
  const out = new Uint8Array(54 + imageSize);
  const v = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  v.setUint32(2, out.length, true);
  v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, p.width, true);
  v.setInt32(22, p.height, true);
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, imageSize, true);
  v.setInt32(38, 2835, true); // 72 dpi
  v.setInt32(42, 2835, true);
  for (let y = 0; y < p.height; y++) {
    const row = 54 + (p.height - 1 - y) * rowSize;
    for (let x = 0; x < p.width; x++) {
      const s = (y * p.width + x) * 4;
      const d = row + x * 3;
      out[d] = p.data[s + 2];
      out[d + 1] = p.data[s + 1];
      out[d + 2] = p.data[s];
    }
  }
  return out;
}

export interface IcoImage {
  size: number;
  png: Uint8Array;
}

/** ICO with PNG-compressed entries (supported since Windows Vista and by every browser). */
export function encodeIco(images: IcoImage[]): Uint8Array {
  const header = 6 + images.length * 16;
  const total = header + images.reduce((s, i) => s + i.png.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint16(2, 1, true);
  v.setUint16(4, images.length, true);
  let offset = header;
  images.forEach((img, n) => {
    const e = 6 + n * 16;
    out[e] = img.size >= 256 ? 0 : img.size;
    out[e + 1] = img.size >= 256 ? 0 : img.size;
    v.setUint16(e + 4, 1, true);
    v.setUint16(e + 6, 32, true);
    v.setUint32(e + 8, img.png.length, true);
    v.setUint32(e + 12, offset, true);
    out.set(img.png, offset);
    offset += img.png.length;
  });
  return out;
}

export interface IcoEntry {
  width: number;
  height: number;
  data: Uint8Array;
  isPng: boolean;
}

/** Returns the largest image in an ICO file. */
export function largestIcoEntry(data: Uint8Array): IcoEntry {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = v.getUint16(4, true);
  if (!count || 6 + count * 16 > data.length) throw new ConversionError('This icon file is damaged.', 'corrupt');
  let best: IcoEntry | null = null;
  for (let n = 0; n < count; n++) {
    const e = 6 + n * 16;
    const width = data[e] || 256;
    const height = data[e + 1] || 256;
    const size = v.getUint32(e + 8, true);
    const offset = v.getUint32(e + 12, true);
    if (offset + size > data.length) continue;
    const bytes = data.subarray(offset, offset + size);
    const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
    if (!best || width * height > best.width * best.height) best = { width, height, data: bytes, isPng };
  }
  if (!best) throw new ConversionError('This icon file is damaged.', 'corrupt');
  return best;
}

/** Decodes a BMP-style (DIB) ICO entry: 32-bit BGRA or 24-bit with an AND mask. */
export function decodeIcoDib(entry: IcoEntry): Pixels {
  const d = entry.data;
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const headerSize = v.getUint32(0, true);
  const width = v.getInt32(4, true);
  const height = Math.abs(v.getInt32(8, true)) / 2;
  const bpp = v.getUint16(14, true);
  if (bpp !== 32 && bpp !== 24) throw new ConversionError('This icon uses a colour depth that is not supported.', 'unsupported');
  checkSize(width, height);
  const out = new Uint8ClampedArray(width * height * 4);
  const rowSize = Math.ceil((width * bpp) / 32) * 4;
  const maskRow = Math.ceil(width / 32) * 4;
  const maskStart = headerSize + rowSize * height;
  for (let y = 0; y < height; y++) {
    const src = headerSize + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      const s = src + x * (bpp / 8);
      const o = (y * width + x) * 4;
      out[o] = d[s + 2];
      out[o + 1] = d[s + 1];
      out[o + 2] = d[s];
      if (bpp === 32) out[o + 3] = d[s + 3];
      else {
        const m = maskStart + (height - 1 - y) * maskRow + (x >> 3);
        out[o + 3] = m < d.length && (d[m] >> (7 - (x & 7))) & 1 ? 0 : 255;
      }
    }
  }
  return { width, height, data: out };
}

export function decodeTiff(data: Uint8Array): Pixels {
  let ifds: UTIF.IFD[];
  try {
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    ifds = UTIF.decode(buf);
    const page = ifds.find((i) => i.width && i.height) ?? ifds[0];
    if (!page) throw new Error('no pages');
    const w = Number(page.width ?? (page as Record<string, unknown>).t256);
    const h = Number(page.height ?? (page as Record<string, unknown>).t257);
    checkSize(w, h);
    UTIF.decodeImage(buf, page);
    const rgba = UTIF.toRGBA8(page);
    return { width: page.width, height: page.height, data: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength) };
  } catch (e) {
    if (e instanceof ConversionError) throw e;
    throw new ConversionError('This TIFF could not be read. It may be damaged or use an unusual compression.', 'corrupt');
  }
}

export function encodeTiff(p: Pixels): Uint8Array {
  return new Uint8Array(UTIF.encodeImage(new Uint8Array(p.data.buffer, p.data.byteOffset, p.data.byteLength), p.width, p.height));
}

export function encodeGif(p: Pixels): Uint8Array {
  const alpha = hasAlpha(p);
  const palette = quantize(p.data, 256, alpha ? { format: 'rgba4444', oneBitAlpha: true } : { format: 'rgb565' });
  const index = applyPalette(p.data, palette, alpha ? 'rgba4444' : 'rgb565');
  const gif = GIFEncoder();
  const transparentIndex = alpha ? palette.findIndex((c) => c[3] === 0) : -1;
  gif.writeFrame(index, p.width, p.height, {
    palette,
    transparent: transparentIndex >= 0,
    transparentIndex: Math.max(0, transparentIndex),
  });
  gif.finish();
  return gif.bytes();
}
