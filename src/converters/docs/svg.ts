import { outputName } from '../../engine/filenames';
import { LIMITS } from '../../engine/limits';
import { opt } from '../../engine/options';
import { ConversionError, type ConvertFn } from '../../engine/types';

const UNITS: Record<string, number> = { px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, '': 1 };

function length(value: string | null): number | null {
  if (!value) return null;
  const m = /^\s*([\d.]+)\s*(px|pt|pc|in|cm|mm)?\s*$/i.exec(value);
  if (!m) return null;
  const n = parseFloat(m[1]) * UNITS[(m[2] ?? '').toLowerCase()];
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Intrinsic size from width/height, falling back to the viewBox, then 512 px. */
export function svgSize(svg: Element): { width: number; height: number } {
  let width = length(svg.getAttribute('width'));
  let height = length(svg.getAttribute('height'));
  const vb = svg
    .getAttribute('viewBox')
    ?.split(/[\s,]+/)
    .map(Number);
  const vw = vb && vb.length === 4 && vb[2] > 0 ? vb[2] : null;
  const vh = vb && vb.length === 4 && vb[3] > 0 ? vb[3] : null;
  if (!width && !height) {
    width = vw ?? 512;
    height = vh ?? 512;
  } else if (!width) width = vw && vh ? (height! * vw) / vh : height!;
  else if (!height) height = vw && vh ? (width * vh) / vw : width;
  return { width: width!, height: height! };
}

/** Rasterises in an <img>, where SVG scripts never run and external resources are not fetched. */
export const convertSvg: ConvertFn = async (input, { options }) => {
  const text = new TextDecoder('utf-8').decode(input.data);
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
    throw new ConversionError('This SVG could not be read. Check that it is a complete SVG file.', 'corrupt');
  }
  const scale = opt(options, 'svgScale', 2);
  const size = svgSize(svg);
  let w = Math.max(1, Math.round(size.width * scale));
  let h = Math.max(1, Math.round(size.height * scale));
  const shrink = Math.min(1, Math.sqrt(LIMITS.maxImagePixels / (w * h)), 16384 / Math.max(w, h));
  w = Math.max(1, Math.floor(w * shrink));
  h = Math.max(1, Math.floor(h * shrink));
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
  if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!svg.getAttribute('preserveAspectRatio')) svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const blob = new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image(w, h);
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new ConversionError('This SVG could not be drawn. It may use features browsers do not support.', 'corrupt');
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) throw new ConversionError('This browser cannot draw images here.', 'environment');
    ctx.drawImage(img, 0, 0, w, h);
    const png = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    if (!png) throw new ConversionError('The picture is too large to draw in this browser.', 'too-large');
    return [{ name: outputName(input.name, 'png'), data: new Uint8Array(await png.arrayBuffer()), format: 'png' }];
  } finally {
    URL.revokeObjectURL(url);
  }
};
