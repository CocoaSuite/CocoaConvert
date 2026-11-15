/** Image decoding and encoding with browser APIs, loaded only inside the worker or page. */
import { opt } from '../../engine/options';
import { ConversionError, type ConvertOptions } from '../../engine/types';
import {
  checkSize,
  decodeIcoDib,
  decodeTiff,
  encodeBmp,
  encodeGif,
  encodeIco,
  encodeTiff,
  flatten,
  largestIcoEntry,
  type Pixels,
} from './codecs';

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  bmp: 'image/bmp',
};

function canvas(w: number, h: number): OffscreenCanvas {
  return new OffscreenCanvas(w, h);
}

function context(c: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new ConversionError('This browser cannot process images here. Try a current version of Chrome, Edge, Firefox or Safari.', 'environment');
  return ctx;
}

function bitmapToPixels(bmp: ImageBitmap): Pixels {
  checkSize(bmp.width, bmp.height);
  const c = canvas(bmp.width, bmp.height);
  const ctx = context(c);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const img = ctx.getImageData(0, 0, c.width, c.height);
  return { width: img.width, height: img.height, data: img.data };
}

async function decodeNative(data: Uint8Array, mime: string): Promise<Pixels> {
  const blob = new Blob([data as BlobPart], { type: mime });
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'default', premultiplyAlpha: 'none' });
  return bitmapToPixels(bmp);
}

async function decodeHeic(data: Uint8Array): Promise<Pixels> {
  const { default: factory } = await import('libheif-js/libheif-wasm/libheif-bundle.mjs');
  const lib = factory();
  if (lib.ready) await lib.ready;
  const decoder = new lib.HeifDecoder();
  const images = decoder.decode(data);
  if (!images?.length) throw new ConversionError('This HEIC file could not be read. It may be damaged.', 'corrupt');
  const image = images.find((i: { is_primary?: () => boolean }) => i.is_primary?.()) ?? images[0];
  const width = image.get_width();
  const height = image.get_height();
  checkSize(width, height);
  const out = new Uint8ClampedArray(width * height * 4);
  await new Promise<void>((resolve, reject) => {
    image.display({ data: out, width, height }, (result: unknown) =>
      result ? resolve() : reject(new ConversionError('This HEIC file could not be decoded.', 'corrupt')),
    );
  });
  for (const i of images) i.free?.();
  return { width, height, data: out };
}

export async function decodeImage(data: Uint8Array, format: string): Promise<Pixels> {
  try {
    switch (format) {
      case 'tiff':
        return decodeTiff(data);
      case 'heic':
        return await decodeHeic(data);
      case 'ico': {
        const entry = largestIcoEntry(data);
        return entry.isPng ? await decodeNative(entry.data, 'image/png') : decodeIcoDib(entry);
      }
      case 'avif':
        try {
          return await decodeNative(data, 'image/avif');
        } catch {
          const { default: decode } = await import('@jsquash/avif/decode');
          const img = await decode(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
          if (!img) throw new Error('avif');
          return { width: img.width, height: img.height, data: img.data };
        }
      default:
        return await decodeNative(data, MIME[format] ?? 'application/octet-stream');
    }
  } catch (e) {
    if (e instanceof ConversionError) throw e;
    throw new ConversionError(`This ${format.toUpperCase()} image could not be read. It may be damaged.`, 'corrupt');
  }
}

function toCanvas(p: Pixels): OffscreenCanvas {
  const c = canvas(p.width, p.height);
  context(c).putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
  return c;
}

async function canvasEncode(c: OffscreenCanvas, mime: string, quality?: number): Promise<Uint8Array | null> {
  const blob = await c.convertToBlob({ type: mime, quality });
  // Browsers fall back to PNG for types they cannot encode.
  if (blob.type !== mime) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

function resized(p: Pixels, size: number): OffscreenCanvas {
  const scale = Math.min(size / p.width, size / p.height);
  const w = Math.max(1, Math.round(p.width * scale));
  const h = Math.max(1, Math.round(p.height * scale));
  const c = canvas(size, size);
  const ctx = context(c);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(toCanvas(p), Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);
  return c;
}

export async function encodeImage(p: Pixels, format: string, options: ConvertOptions): Promise<Uint8Array> {
  const quality = opt(options, 'quality', 85) / 100;
  switch (format) {
    case 'png':
      return (await canvasEncode(toCanvas(p), 'image/png'))!;
    case 'jpg':
      return (await canvasEncode(toCanvas(flatten(p)), 'image/jpeg', quality))!;
    case 'webp': {
      const native = await canvasEncode(toCanvas(p), 'image/webp', quality);
      if (native) return native;
      const { default: encode } = await import('@jsquash/webp/encode');
      return new Uint8Array(await encode(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), { quality: quality * 100 }));
    }
    case 'avif': {
      const { default: encode } = await import('@jsquash/avif/encode');
      // AVIF looks good at lower numbers than JPG; map the shared quality scale onto it.
      const q = Math.round(Math.min(100, Math.max(1, quality * 100 * 0.8)));
      return new Uint8Array(await encode(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), { quality: q, speed: 8 }));
    }
    case 'gif':
      return encodeGif(p);
    case 'bmp':
      return encodeBmp(p);
    case 'tiff':
      return encodeTiff(p);
    case 'ico': {
      const max = Math.max(p.width, p.height);
      const sizes = [16, 24, 32, 48, 64, 128, 256].filter((s) => s <= Math.max(16, max));
      const images = [];
      for (const size of sizes) {
        images.push({ size, png: (await canvasEncode(resized(p, size), 'image/png'))! });
      }
      return encodeIco(images);
    }
    default:
      throw new ConversionError(`Cannot write ${format.toUpperCase()} images.`, 'unsupported');
  }
}
