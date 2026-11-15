const MB = 1024 * 1024;
const GB = 1024 * MB;

export const LIMITS = {
  /** Largest file the app accepts at all. */
  maxFileBytes: 4 * GB,
  /** Images are decoded to raw pixels; this caps memory use per image. */
  maxImagePixels: 120_000_000,
  imageBytes: 512 * MB,
  textBytes: 256 * MB,
  officeBytes: 512 * MB,
  /** FFmpeg in the browser keeps the whole output in memory. */
  browserMediaBytes: 1 * GB,
  serverMediaBytes: 4 * GB,
  archiveBytes: 2 * GB,
  /** Extraction guards against archive bombs. */
  maxArchiveEntries: 20_000,
  maxExtractedBytes: 4 * GB,
  /** Total expanded size may not exceed this multiple of the compressed size (when large). */
  maxCompressionRatio: 200,
  ratioCheckFloor: 64 * MB,
} as const;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')} ${units[i]}`;
}
