import type { Category, FormatDef } from './types';

const f = (
  id: string,
  label: string,
  category: Category,
  mime: string,
  exts: string[] = [id],
  extra: Partial<FormatDef> = {},
): FormatDef => ({ id, label, category, mime, exts, ext: exts[0], ...extra });

export const FORMATS: FormatDef[] = [
  // Images
  f('jpg', 'JPG', 'image', 'image/jpeg', ['jpg', 'jpeg', 'jpe', 'jfif']),
  f('png', 'PNG', 'image', 'image/png'),
  f('webp', 'WebP', 'image', 'image/webp'),
  f('avif', 'AVIF', 'image', 'image/avif'),
  f('gif', 'GIF', 'image', 'image/gif'),
  f('bmp', 'BMP', 'image', 'image/bmp', ['bmp', 'dib']),
  f('tiff', 'TIFF', 'image', 'image/tiff', ['tiff', 'tif']),
  f('svg', 'SVG', 'image', 'image/svg+xml', ['svg'], { text: true }),
  f('ico', 'ICO', 'image', 'image/x-icon', ['ico']),
  f('heic', 'HEIC', 'image', 'image/heic', ['heic', 'heif', 'hif']),

  // Documents
  f('pdf', 'PDF', 'document', 'application/pdf'),
  f('doc', 'DOC', 'document', 'application/msword'),
  f('docx', 'DOCX', 'document', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  f('odt', 'ODT', 'document', 'application/vnd.oasis.opendocument.text'),
  f('rtf', 'RTF', 'document', 'application/rtf', ['rtf'], { text: true }),
  f('txt', 'TXT', 'document', 'text/plain', ['txt', 'text', 'log'], { text: true }),
  f('html', 'HTML', 'document', 'text/html', ['html', 'htm', 'xhtml'], { text: true }),
  f('md', 'Markdown', 'document', 'text/markdown', ['md', 'markdown', 'mdown', 'mkd'], { text: true }),

  // E-books
  f('epub', 'EPUB', 'ebook', 'application/epub+zip'),

  // Presentations
  f('pptx', 'PPTX', 'presentation', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
  f('ppt', 'PPT', 'presentation', 'application/vnd.ms-powerpoint'),
  f('odp', 'ODP', 'presentation', 'application/vnd.oasis.opendocument.presentation'),

  // Spreadsheets
  f('xlsx', 'XLSX', 'spreadsheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  f('xls', 'XLS', 'spreadsheet', 'application/vnd.ms-excel'),
  f('ods', 'ODS', 'spreadsheet', 'application/vnd.oasis.opendocument.spreadsheet'),

  // Data
  f('csv', 'CSV', 'data', 'text/csv', ['csv'], { text: true }),
  f('tsv', 'TSV', 'data', 'text/tab-separated-values', ['tsv', 'tab'], { text: true }),
  f('json', 'JSON', 'data', 'application/json', ['json'], { text: true }),
  f('xml', 'XML', 'data', 'application/xml', ['xml'], { text: true }),
  f('yaml', 'YAML', 'data', 'application/yaml', ['yaml', 'yml'], { text: true }),
  f('sql', 'SQL', 'data', 'application/sql', ['sql'], { text: true }),

  // Audio
  f('mp3', 'MP3', 'audio', 'audio/mpeg'),
  f('wav', 'WAV', 'audio', 'audio/wav', ['wav', 'wave']),
  f('flac', 'FLAC', 'audio', 'audio/flac'),
  f('aac', 'AAC', 'audio', 'audio/aac'),
  f('m4a', 'M4A', 'audio', 'audio/mp4'),
  f('ogg', 'OGG', 'audio', 'audio/ogg', ['ogg', 'oga']),
  f('opus', 'Opus', 'audio', 'audio/opus'),
  f('aiff', 'AIFF', 'audio', 'audio/aiff', ['aiff', 'aif', 'aifc']),
  f('wma', 'WMA', 'audio', 'audio/x-ms-wma'),

  // Video
  f('mp4', 'MP4', 'video', 'video/mp4', ['mp4', 'm4v']),
  f('mov', 'MOV', 'video', 'video/quicktime', ['mov', 'qt']),
  f('mkv', 'MKV', 'video', 'video/x-matroska'),
  f('avi', 'AVI', 'video', 'video/x-msvideo'),
  f('webm', 'WebM', 'video', 'video/webm'),
  f('wmv', 'WMV', 'video', 'video/x-ms-wmv'),
  f('flv', 'FLV', 'video', 'video/x-flv'),
  f('mpeg', 'MPEG', 'video', 'video/mpeg', ['mpeg', 'mpg', 'mpe', 'ts', 'm2ts', 'vob']),
  f('3gp', '3GP', 'video', 'video/3gpp', ['3gp', '3g2']),

  // Archives
  f('zip', 'ZIP', 'archive', 'application/zip'),
  f('7z', '7Z', 'archive', 'application/x-7z-compressed'),
  f('tar', 'TAR', 'archive', 'application/x-tar'),
  f('targz', 'TAR.GZ', 'archive', 'application/gzip', ['tar.gz', 'tgz']),
  f('tarbz2', 'TAR.BZ2', 'archive', 'application/x-bzip2', ['tar.bz2', 'tbz2', 'tbz']),
  f('tarxz', 'TAR.XZ', 'archive', 'application/x-xz', ['tar.xz', 'txz']),
  f('gz', 'GZ', 'archive', 'application/gzip'),
  f('bz2', 'BZ2', 'archive', 'application/x-bzip2'),
  f('xz', 'XZ', 'archive', 'application/x-xz'),
  f('files', 'Extracted files', 'archive', 'application/octet-stream', [''], { pseudo: true }),
];

const byId = new Map(FORMATS.map((x) => [x.id, x]));

export function getFormat(id: string): FormatDef {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown format: ${id}`);
  return def;
}

export function findFormat(id: string): FormatDef | undefined {
  return byId.get(id);
}

/** Longest matching extension wins, so "x.tar.gz" is TAR.GZ rather than GZ. */
export function formatFromName(name: string): FormatDef | undefined {
  const lower = name.toLowerCase();
  let best: FormatDef | undefined;
  let bestLen = 0;
  for (const def of FORMATS) {
    if (def.pseudo) continue;
    for (const ext of def.exts) {
      if (ext && lower.endsWith('.' + ext) && ext.length > bestLen) {
        best = def;
        bestLen = ext.length;
      }
    }
  }
  return best;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  image: 'Images',
  document: 'Documents',
  spreadsheet: 'Spreadsheets',
  presentation: 'Presentations',
  ebook: 'E-books',
  audio: 'Audio',
  video: 'Video',
  archive: 'Archives',
  data: 'Data',
};

export const CATEGORY_ORDER: Category[] = [
  'image',
  'document',
  'spreadsheet',
  'presentation',
  'ebook',
  'audio',
  'video',
  'archive',
  'data',
];
