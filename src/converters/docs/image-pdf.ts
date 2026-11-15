import { PDFDocument } from 'pdf-lib';
import { baseName, outputName } from '../../engine/filenames';
import { ConversionError, type ConvertFn } from '../../engine/types';

/** One page per image, sized so the image prints at 96 dpi. */
export const convertImageToPdf: ConvertFn = async (input) => {
  const doc = await PDFDocument.create();
  doc.setTitle(baseName(input.name));
  doc.setProducer('CocoaConvert');
  doc.setCreator('CocoaConvert');
  let image;
  try {
    image = input.from === 'jpg' ? await doc.embedJpg(input.data) : await doc.embedPng(input.data);
  } catch {
    throw new ConversionError('This image could not be placed in a PDF. It may be damaged.', 'corrupt');
  }
  const w = image.width * 0.75;
  const h = image.height * 0.75;
  const page = doc.addPage([w, h]);
  page.drawImage(image, { x: 0, y: 0, width: w, height: h });
  const data = await doc.save();
  return [{ name: outputName(input.name, 'pdf'), data, format: 'pdf' }];
};
