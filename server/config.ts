import { tmpdir } from 'node:os';
import { join } from 'node:path';

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

export interface ServerConfig {
  host: string;
  port: number;
  /** Built front end to serve. Empty to run the API only. */
  staticDir: string;
  /** Root for per-job folders. Each job gets its own folder, deleted when the response ends. */
  workRoot: string;
  maxUploadBytes: number;
  /** Simultaneous conversions; more requests wait in a short queue. */
  concurrency: number;
  queueLimit: number;
  /** Requests per minute per address for /api/convert. */
  rateLimit: number;
  timeouts: { office: number; media: number; archive: number };
  /** Converter ids to turn off even if their tools are installed (comma-separated). */
  disabled: string[];
}

export function loadConfig(env = process.env): ServerConfig {
  return {
    host: env.HOST ?? '0.0.0.0',
    port: num('PORT', 8080),
    staticDir: env.STATIC_DIR ?? join(process.cwd(), 'dist'),
    workRoot: env.WORK_DIR ?? join(tmpdir(), 'cocoaconvert-jobs'),
    maxUploadBytes: num('MAX_UPLOAD_MB', 500) * 1024 * 1024,
    concurrency: num('CONCURRENCY', 2),
    queueLimit: num('QUEUE_LIMIT', 16),
    rateLimit: num('RATE_LIMIT', 60),
    timeouts: {
      office: num('OFFICE_TIMEOUT_S', 120) * 1000,
      media: num('MEDIA_TIMEOUT_S', 1800) * 1000,
      archive: num('ARCHIVE_TIMEOUT_S', 300) * 1000,
    },
    disabled: (env.DISABLE_CONVERTERS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}
