import { LIMITS } from './limits';
import type { ConverterDef, Edge } from './types';

interface PairOpts {
  cost?: number;
  chain?: boolean;
  note?: (from: string, to: string) => string | undefined;
}

/** Every from → to pair, skipping identity conversions. */
function pairs(from: string[], to: string[], opts: PairOpts = {}): Edge[] {
  const edges: Edge[] = [];
  for (const a of from) {
    for (const b of to) {
      if (a === b) continue;
      edges.push({ from: a, to: b, cost: opts.cost ?? 1, chain: opts.chain ?? true, note: opts.note?.(a, b) });
    }
  }
  return edges;
}

export const RASTER_IN = ['jpg', 'png', 'webp', 'avif', 'gif', 'bmp', 'ico', 'tiff', 'heic'];
export const RASTER_OUT = ['jpg', 'png', 'webp', 'avif', 'gif', 'bmp', 'tiff', 'ico'];
const ALPHA = new Set(['png', 'webp', 'avif', 'gif', 'ico', 'tiff', 'heic', 'svg']);

export const AUDIO = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'aiff', 'wma'];
export const VIDEO = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'wmv', 'flv', 'mpeg', '3gp'];

const WRITER = ['doc', 'docx', 'odt', 'rtf'];
const IMPRESS = ['ppt', 'pptx', 'odp'];
const CALC = ['xls', 'xlsx', 'ods'];

function imageNote(from: string, to: string): string | undefined {
  const notes: string[] = [];
  if (from === 'gif') notes.push('Only the first frame of an animated GIF is kept.');
  if ((to === 'jpg' || to === 'bmp') && ALPHA.has(from)) notes.push('Transparent areas become white.');
  if (to === 'gif') notes.push('Colours are reduced to a palette of 256.');
  if (to === 'ico') notes.push('Sizes from 16 to 256 px are included, up to the image size.');
  return notes.join(' ') || undefined;
}

function mediaEdges(cost: number, browser: boolean): Edge[] {
  const note = (from: string, to: string) => {
    if (to === 'webm' && browser) return 'Uses VP8 video in the browser. Server conversion makes smaller VP9 files.';
    if (to === 'gif') return 'Sound is dropped. Long clips make large GIFs.';
    if (VIDEO.includes(from) && AUDIO.includes(to)) return 'Only the sound is kept.';
    if (to === '3gp') return 'Made for older phones: small frame sizes work best.';
    return undefined;
  };
  return [
    ...pairs(AUDIO, AUDIO, { cost, chain: false, note }),
    ...pairs(VIDEO, VIDEO, { cost, chain: false, note }),
    ...pairs(VIDEO, AUDIO, { cost, chain: false, note }),
    ...pairs(VIDEO, ['gif'], { cost, chain: false, note }),
    ...pairs(['gif'], ['mp4', 'webm', 'mov', 'mkv'], { cost: cost - 0.5, chain: false }),
  ];
}

export const CONVERTERS: ConverterDef[] = [
  // ——— On this device ———
  {
    id: 'image',
    label: 'Image codecs',
    env: 'client',
    thread: 'worker',
    // PNG is lossless and keeps transparency, so it wins as the in-between step.
    edges: pairs(RASTER_IN, RASTER_OUT, { note: imageNote }).map((e) => (e.to === 'png' ? { ...e, cost: 0.9 } : e)),
    maxBytes: LIMITS.imageBytes,
    reportsProgress: false,
  },
  {
    id: 'svg-raster',
    label: 'SVG renderer',
    env: 'client',
    thread: 'main',
    edges: [{ from: 'svg', to: 'png', cost: 1, chain: true, note: 'Rendered at the chosen scale. Linked images and web fonts are not loaded.' }],
    maxBytes: LIMITS.textBytes,
    reportsProgress: false,
  },
  {
    id: 'image-pdf',
    label: 'Image to PDF',
    env: 'client',
    thread: 'worker',
    edges: pairs(['jpg', 'png'], ['pdf'], { note: () => 'One page, sized to the image.' }),
    maxBytes: LIMITS.imageBytes,
    reportsProgress: false,
  },
  {
    id: 'pdf-render',
    label: 'PDF renderer',
    env: 'client',
    thread: 'main',
    edges: pairs(['pdf'], ['png', 'jpg'], { cost: 1.5, chain: false, note: () => 'Each page becomes its own image.' }),
    maxBytes: LIMITS.officeBytes,
    reportsProgress: true,
  },
  {
    id: 'pdf-text',
    label: 'PDF text',
    env: 'client',
    thread: 'main',
    edges: pairs(['pdf'], ['txt'], {
      cost: 1.5,
      chain: false,
      note: () => 'Only the text is kept. Scanned pages without a text layer come out empty.',
    }),
    maxBytes: LIMITS.officeBytes,
    reportsProgress: true,
  },
  {
    id: 'docx',
    label: 'Word reader',
    env: 'client',
    thread: 'worker',
    edges: pairs(['docx'], ['html', 'txt'], {
      note: (_f, t) =>
        t === 'html' ? 'Headings, lists, tables and pictures carry over. Page layout and fonts do not.' : undefined,
    }),
    maxBytes: LIMITS.officeBytes,
    reportsProgress: false,
  },
  {
    id: 'markdown',
    label: 'Markdown',
    env: 'client',
    thread: 'worker',
    edges: [
      { from: 'md', to: 'html', cost: 1, chain: true },
      { from: 'txt', to: 'html', cost: 1, chain: true },
    ],
    maxBytes: LIMITS.textBytes,
    reportsProgress: false,
  },
  {
    id: 'html-text',
    label: 'HTML reader',
    env: 'client',
    thread: 'main',
    edges: [
      { from: 'html', to: 'md', cost: 1, chain: true, note: 'Scripts, styles and forms are dropped.' },
      { from: 'html', to: 'txt', cost: 1, chain: true },
      { from: 'md', to: 'txt', cost: 1.2, chain: true },
    ],
    maxBytes: LIMITS.textBytes,
    reportsProgress: false,
  },
  {
    id: 'data',
    label: 'Structured data',
    env: 'client',
    thread: 'worker',
    edges: [
      ...pairs(['json'], ['csv', 'tsv'], { note: () => 'Nested values are flattened into dotted column names.' }),
      ...pairs(['json'], ['xml', 'yaml', 'sql']),
      ...pairs(['csv', 'tsv'], ['json', 'csv', 'tsv', 'sql', 'md', 'html']),
      ...pairs(['xml'], ['json'], { note: () => 'Attributes become keys starting with @.' }),
      ...pairs(['yaml'], ['json']),
    ],
    maxBytes: LIMITS.textBytes,
    reportsProgress: false,
  },
  {
    id: 'sheet',
    label: 'Spreadsheets',
    env: 'client',
    thread: 'worker',
    edges: [
      ...pairs(['xlsx', 'xls', 'ods', 'csv', 'tsv'], ['xlsx', 'xls', 'ods'], {
        cost: 1.2,
        note: (from) =>
          ['csv', 'tsv'].includes(from) ? undefined : 'Values and formulas carry over. Fonts, colours and charts do not.',
      }),
      ...pairs(['xlsx', 'xls', 'ods'], ['csv', 'tsv', 'json', 'html'], {
        cost: 1.2,
        note: (_f, t) => (t === 'csv' || t === 'tsv' ? 'Each sheet becomes its own file.' : undefined),
      }),
    ],
    maxBytes: LIMITS.officeBytes,
    reportsProgress: false,
  },
  {
    id: 'archive',
    label: 'Archives',
    env: 'client',
    thread: 'worker',
    edges: [
      ...pairs(['zip', 'tar', 'targz'], ['zip', 'tar', 'targz', 'files']),
      { from: 'gz', to: 'files', cost: 1, chain: true },
    ],
    maxBytes: LIMITS.archiveBytes,
    reportsProgress: false,
  },
  {
    id: 'ffmpeg-wasm',
    label: 'FFmpeg (in the browser)',
    env: 'client',
    thread: 'main',
    edges: mediaEdges(4, true),
    maxBytes: LIMITS.browserMediaBytes,
    reportsProgress: true,
    concurrency: 1,
  },

  // ——— On the server (optional, needs consent) ———
  {
    id: 'libreoffice',
    label: 'LibreOffice',
    env: 'server',
    requires: ['soffice'],
    edges: [
      ...pairs(WRITER, ['pdf', 'docx', 'doc', 'odt', 'rtf', 'txt', 'html'], { cost: 5 }),
      ...pairs(['txt', 'html'], ['pdf', 'docx', 'odt'], { cost: 5 }),
      ...pairs(IMPRESS, ['pdf', 'pptx', 'ppt', 'odp'], { cost: 5 }),
      ...pairs([...CALC, 'csv'], ['pdf'], { cost: 5 }),
      ...pairs(CALC, CALC, { cost: 6 }),
      ...pairs(['pdf'], ['docx', 'odt'], {
        cost: 5,
        chain: false,
        note: () => 'Text and pictures are rebuilt in positioned boxes. Complex layouts may need tidying.',
      }),
    ],
    maxBytes: LIMITS.officeBytes,
    reportsProgress: false,
    concurrency: 2,
  },
  {
    id: 'pandoc',
    label: 'Pandoc',
    env: 'server',
    requires: ['pandoc'],
    edges: pairs(['md', 'html', 'docx', 'odt', 'epub', 'rtf'], ['epub', 'docx', 'odt', 'html', 'md', 'txt', 'rtf'], {
      cost: 5,
      note: (from, to) =>
        ['docx', 'odt', 'rtf'].includes(from) && ['docx', 'odt', 'rtf'].includes(to)
          ? 'Structure carries over. Page layout may change.'
          : undefined,
    }).map((e) =>
      // LibreOffice keeps office layouts better, so prefer it where both can do the job.
      ['docx', 'odt', 'rtf'].includes(e.from) && ['docx', 'odt', 'rtf', 'txt', 'html'].includes(e.to)
        ? { ...e, cost: 8 }
        : e,
    ),
    maxBytes: LIMITS.officeBytes,
    reportsProgress: false,
    concurrency: 2,
  },
  {
    id: 'ffmpeg',
    label: 'FFmpeg',
    env: 'server',
    requires: ['ffmpeg'],
    edges: mediaEdges(6, false),
    maxBytes: LIMITS.serverMediaBytes,
    reportsProgress: false,
    concurrency: 2,
  },
  {
    id: 'archive-native',
    label: 'Archive tools',
    env: 'server',
    requires: ['7za', 'tar', 'xz', 'bzip2'],
    edges: [
      { from: '7z', to: 'tar', cost: 4.9, chain: true },
      { from: '7z', to: 'zip', cost: 5, chain: true },
      ...pairs(['zip', 'tar', 'targz'], ['7z'], { cost: 5 }),
      ...pairs(['bz2', 'xz'], ['files'], { cost: 5 }),
      ...pairs(['tarbz2', 'tarxz'], ['tar'], { cost: 5 }),
      ...pairs(['tar'], ['tarbz2', 'tarxz'], { cost: 5 }),
    ],
    maxBytes: LIMITS.archiveBytes,
    reportsProgress: false,
    concurrency: 2,
  },
];

const byId = new Map(CONVERTERS.map((c) => [c.id, c]));

export function getConverter(id: string): ConverterDef {
  const c = byId.get(id);
  if (!c) throw new Error(`Unknown converter: ${id}`);
  return c;
}
