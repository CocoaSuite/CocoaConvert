import type { ConvertFn } from '../engine/types';

/** Converters that run inside the worker pool. Each library loads on first use. */
export const WORKER_CONVERTERS: Record<string, () => Promise<ConvertFn>> = {
  image: () => import('./image').then((m) => m.convertImage),
  'image-pdf': () => import('./docs/image-pdf').then((m) => m.convertImageToPdf),
  docx: () => import('./docs/docx').then((m) => m.convertDocx),
  markdown: () => import('./docs/markup').then((m) => m.convertToHtml),
  data: () => import('./data').then((m) => m.convertData),
  sheet: () => import('./data/sheet').then((m) => m.convertSheet),
  archive: () => import('./archive').then((m) => m.convertArchive),
};

/** Converters that need the page (DOM, canvas elements, or their own worker). */
export const MAIN_CONVERTERS: Record<string, () => Promise<ConvertFn>> = {
  'svg-raster': () => import('./docs/svg').then((m) => m.convertSvg),
  'pdf-render': () => import('./docs/pdf').then((m) => m.convertPdfToImages),
  'pdf-text': () => import('./docs/pdf').then((m) => m.convertPdfToText),
  'html-text': () => import('./docs/markup').then((m) => m.convertFromHtml),
  'ffmpeg-wasm': () => import('./media/wasm').then((m) => m.convertMediaWasm),
};
