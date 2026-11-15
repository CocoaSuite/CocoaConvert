import { outputName } from '../../engine/filenames';
import { LIMITS } from '../../engine/limits';
import { opt } from '../../engine/options';
import { ConversionError, type ConvertFn, type ConvertInput, type OutputFile } from '../../engine/types';

const MAX_PAGES = 500;

async function openPdf(input: ConvertInput) {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerSrc } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  try {
    // pdf.js keeps the buffer, so hand it a copy and keep the original reusable for retries.
    const task = pdfjs.getDocument({ data: input.data.slice(), enableXfa: false });
    const doc = await task.promise;
    return Object.assign(doc, { close: () => task.destroy() });
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'PasswordException') throw new ConversionError('This PDF is password protected. Remove the password and try again.', 'protected');
    throw new ConversionError('This PDF could not be read. It may be damaged.', 'corrupt');
  }
}

export const convertPdfToImages: ConvertFn = async (input, { to, options, onProgress, signal }) => {
  const doc = await openPdf(input);
  try {
    const pages = doc.numPages;
    if (pages > MAX_PAGES) throw new ConversionError(`This PDF has ${pages} pages. Up to ${MAX_PAGES} can be turned into images at once.`, 'too-large');
    const scale = opt(options, 'dpi', 150) / 72;
    const quality = opt(options, 'quality', 85) / 100;
    const outputs: OutputFile[] = [];
    for (let n = 1; n <= pages; n++) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const page = await doc.getPage(n);
      let viewport = page.getViewport({ scale });
      const px = viewport.width * viewport.height;
      if (px > LIMITS.maxImagePixels / 4) viewport = page.getViewport({ scale: scale * Math.sqrt(LIMITS.maxImagePixels / 4 / px) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d')!;
      // PDF pages are drawn on white paper; JPG has no transparency either.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const blob = await new Promise<Blob | null>((r) =>
        canvas.toBlob(r, to === 'jpg' ? 'image/jpeg' : 'image/png', to === 'jpg' ? quality : undefined),
      );
      page.cleanup();
      canvas.width = canvas.height = 0;
      if (!blob) throw new ConversionError('A page was too large to draw in this browser. Try a lower page resolution.', 'too-large');
      const suffix = pages > 1 ? `-page-${String(n).padStart(String(pages).length, '0')}` : '';
      outputs.push({ name: outputName(input.name, to, suffix), data: new Uint8Array(await blob.arrayBuffer()), format: to });
      onProgress?.(n / pages);
    }
    return outputs;
  } finally {
    await doc.close();
  }
};

export const convertPdfToText: ConvertFn = async (input, { onProgress, signal }) => {
  const doc = await openPdf(input);
  try {
    const parts: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str;
        if (item.hasEOL) text += '\n';
        else if (item.str && !item.str.endsWith(' ')) text += ' ';
      }
      parts.push(text.replace(/[ \t]+\n/g, '\n').trim());
      page.cleanup();
      onProgress?.(n / doc.numPages);
    }
    const out = parts.join('\n\n\f\n\n') + '\n';
    return [{ name: outputName(input.name, 'txt'), data: new TextEncoder().encode(out), format: 'txt' }];
  } finally {
    await doc.close();
  }
};
