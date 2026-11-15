import { outputName } from '../../engine/filenames';
import type { ConvertFn } from '../../engine/types';
import { decodeImage, encodeImage } from './browser';

export const convertImage: ConvertFn = async (input, { to, options }) => {
  const pixels = await decodeImage(input.data, input.from);
  const data = await encodeImage(pixels, to, options);
  return [{ name: outputName(input.name, to), data, format: to }];
};
