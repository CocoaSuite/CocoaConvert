import { formatFromName } from '../../engine/formats';

/** Formats that are already compressed: storing them again is faster and no larger. */
const STORED = new Set([
  'jpg', 'png', 'webp', 'avif', 'gif', 'heic', 'mp3', 'aac', 'm4a', 'ogg', 'opus', 'flac', 'wma',
  'mp4', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', '3gp', 'zip', '7z', 'gz', 'targz', 'bz2', 'xz',
  'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub', 'pdf',
]);

export function zipLevel(path: string): 0 | 6 {
  const def = formatFromName(path);
  return def && STORED.has(def.id) ? 0 : 6;
}
