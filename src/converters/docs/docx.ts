import mammoth from 'mammoth';
import { baseName, outputName } from '../../engine/filenames';
import { ConversionError, type ConvertFn } from '../../engine/types';
import { htmlDocument } from '../data/tabular';

export const convertDocx: ConvertFn = async (input, { to }) => {
  const arrayBuffer = input.data.buffer.slice(input.data.byteOffset, input.data.byteOffset + input.data.byteLength) as ArrayBuffer;
  const enc = new TextEncoder();
  try {
    if (to === 'html') {
      const result = await mammoth.convertToHtml({ arrayBuffer, buffer: input.data });
      const html = htmlDocument(baseName(input.name), result.value);
      return [{ name: outputName(input.name, 'html'), data: enc.encode(html), format: 'html' }];
    }
    if (to === 'txt') {
      const result = await mammoth.extractRawText({ arrayBuffer, buffer: input.data });
      const text = result.value.replace(/\n{3,}/g, '\n\n').trim() + '\n';
      return [{ name: outputName(input.name, 'txt'), data: enc.encode(text), format: 'txt' }];
    }
  } catch {
    throw new ConversionError('This Word document could not be read. It may be damaged or password protected.', 'corrupt');
  }
  throw new ConversionError(`Cannot convert DOCX to ${to} here.`, 'unsupported');
};
