import { AUDIO, VIDEO } from './registry';
import type { Category, ConvertOptions, OptionDef } from './types';

export const OPTIONS: OptionDef[] = [
  {
    key: 'quality',
    label: 'Quality',
    min: 10,
    max: 100,
    step: 1,
    unit: '%',
    default: 85,
    targets: ['jpg', 'webp', 'avif'],
    sources: ['image', 'document'],
  },
  {
    key: 'videoQuality',
    label: 'Video quality',
    choices: [
      { value: 'high', label: 'High' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'small', label: 'Smaller file' },
    ],
    default: 'balanced',
    targets: VIDEO,
  },
  {
    key: 'resolution',
    label: 'Resolution',
    choices: [
      { value: 'original', label: 'Same as source' },
      { value: '2160', label: '2160p (4K)' },
      { value: '1080', label: '1080p' },
      { value: '720', label: '720p' },
      { value: '480', label: '480p' },
      { value: '360', label: '360p' },
    ],
    default: 'original',
    targets: VIDEO,
    sources: ['video', 'image'],
  },
  {
    key: 'gifWidth',
    label: 'Width',
    choices: [
      { value: '320', label: '320 px' },
      { value: '480', label: '480 px' },
      { value: '640', label: '640 px' },
      { value: 'original', label: 'Same as source' },
    ],
    default: '480',
    targets: ['gif'],
    sources: ['video'],
  },
  {
    key: 'gifFps',
    label: 'Frame rate',
    choices: [
      { value: '10', label: '10 fps' },
      { value: '15', label: '15 fps' },
      { value: '24', label: '24 fps' },
    ],
    default: '15',
    targets: ['gif'],
    sources: ['video'],
  },
  {
    key: 'audioBitrate',
    label: 'Audio bitrate',
    choices: [
      { value: '96', label: '96 kbps' },
      { value: '128', label: '128 kbps' },
      { value: '192', label: '192 kbps' },
      { value: '256', label: '256 kbps' },
      { value: '320', label: '320 kbps' },
    ],
    default: '192',
    targets: AUDIO.filter((a) => !['wav', 'flac', 'aiff', 'ogg'].includes(a)),
  },
  {
    key: 'dpi',
    label: 'Page resolution',
    choices: [
      { value: '72', label: '72 dpi' },
      { value: '150', label: '150 dpi' },
      { value: '300', label: '300 dpi' },
    ],
    default: '150',
    targets: ['png', 'jpg'],
    sources: ['document'],
  },
  {
    key: 'svgScale',
    label: 'Scale',
    choices: [
      { value: '1', label: '1×' },
      { value: '2', label: '2×' },
      { value: '4', label: '4×' },
    ],
    default: '2',
    targets: ['png', 'jpg', 'webp', 'avif', 'gif', 'bmp', 'tiff', 'ico', 'pdf'],
    sources: ['image'],
  },
];

/** Options relevant to converting a source of this format and category to the target. */
export function optionsFor(sourceFormat: string, sourceCategory: Category, target: string): OptionDef[] {
  return OPTIONS.filter((o) => {
    if (!o.targets.includes(target)) return false;
    if (o.sources && !o.sources.includes(sourceCategory)) return false;
    if (o.key === 'svgScale') return sourceFormat === 'svg';
    if (o.key === 'dpi') return sourceFormat === 'pdf';
    if (o.key === 'quality' && sourceCategory === 'document') return sourceFormat === 'pdf';
    if (o.key === 'resolution' && sourceCategory === 'image') return sourceFormat === 'gif';
    return true;
  });
}

export function defaultOptions(defs: OptionDef[]): ConvertOptions {
  return Object.fromEntries(defs.map((d) => [d.key, d.default]));
}

export function opt<T extends string | number>(options: ConvertOptions, key: string, fallback: T): T {
  const v = options[key];
  if (v === undefined || v === null || v === '') return fallback;
  return (typeof fallback === 'number' ? Number(v) : String(v)) as T;
}
