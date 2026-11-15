import { opt } from '../../engine/options';
import { AUDIO, VIDEO } from '../../engine/registry';
import type { ConvertOptions } from '../../engine/types';

/** Constant rate factors per quality preset. */
const CRF = {
  x264: { high: 20, balanced: 23, small: 28 },
  vp9: { high: 30, balanced: 34, small: 40 },
  /** VP8 with a bitrate ceiling, for the browser engine (its VP9 encoder crashes). */
  vp8: { high: 8, balanced: 12, small: 24 },
  vp8max: { high: '8M', balanced: '4M', small: '1M' },
  /** mpeg4, wmv2, flv1, mpeg2: qscale (lower is better). */
  q: { high: 3, balanced: 5, small: 9 },
} as const;

type Preset = keyof typeof CRF.x264;

function videoFilter(options: ConvertOptions): string {
  const res = opt<string>(options, 'resolution', 'original');
  // Even dimensions are required by most video encoders.
  if (res === 'original') return 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  return `scale=-2:'trunc(min(${Number(res)}\\,ih)/2)*2'`;
}

function audioArgs(to: string, options: ConvertOptions): string[] {
  const kbps = `${opt(options, 'audioBitrate', 192)}k`;
  switch (to) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', kbps];
    case 'wav':
      return ['-c:a', 'pcm_s16le'];
    case 'flac':
      return ['-c:a', 'flac'];
    case 'aiff':
      return ['-c:a', 'pcm_s16be'];
    case 'aac':
      return ['-c:a', 'aac', '-b:a', kbps, '-f', 'adts'];
    case 'm4a':
      return ['-c:a', 'aac', '-b:a', kbps, '-f', 'ipod', '-movflags', '+faststart'];
    case 'ogg':
      // Vorbis quality mode works at every sample rate; fixed bitrates fail on low-rate mono sources.
      return ['-c:a', 'libvorbis', '-q:a', '5', '-f', 'ogg'];
    case 'opus':
      // Opus works at 48 kHz only.
      return ['-c:a', 'libopus', '-b:a', kbps, '-ar', '48000', '-f', 'opus'];
    case 'wma':
      return ['-c:a', 'wmav2', '-b:a', kbps, '-f', 'asf'];
    default:
      throw new Error(`No audio settings for ${to}`);
  }
}

function videoArgs(to: string, options: ConvertOptions, engine: Engine): string[] {
  const preset = opt<string>(options, 'videoQuality', 'balanced') as Preset;
  const vf = ['-vf', videoFilter(options)];
  const x264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(CRF.x264[preset]), '-pix_fmt', 'yuv420p'];
  const q = String(CRF.q[preset]);
  switch (to) {
    case 'mp4':
    case 'mov':
      return [...vf, ...x264, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'];
    case 'mkv':
      return [...vf, ...x264, '-c:a', 'aac', '-b:a', '160k'];
    case '3gp':
      return [...vf, ...x264, '-profile:v', 'baseline', '-c:a', 'aac', '-b:a', '96k', '-ac', '1', '-ar', '22050', '-f', '3gp'];
    case 'webm':
      if (engine === 'browser') {
        return [
          ...vf,
          '-c:v', 'libvpx', '-crf', String(CRF.vp8[preset]), '-b:v', CRF.vp8max[preset],
          '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p',
          '-c:a', 'libopus', '-b:a', '128k',
        ];
      }
      return [
        ...vf,
        '-c:v', 'libvpx-vp9', '-crf', String(CRF.vp9[preset]), '-b:v', '0',
        '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-pix_fmt', 'yuv420p',
        '-c:a', 'libopus', '-b:a', '128k',
      ];
    case 'avi':
      return [...vf, '-c:v', 'mpeg4', '-q:v', q, '-c:a', 'libmp3lame', '-b:a', '192k'];
    case 'wmv':
      return [...vf, '-c:v', 'wmv2', '-q:v', q, '-c:a', 'wmav2', '-b:a', '192k', '-f', 'asf'];
    case 'flv':
      return [...vf, '-c:v', 'flv', '-q:v', q, '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100'];
    case 'mpeg':
      return [...vf, '-c:v', 'mpeg2video', '-q:v', q, '-c:a', 'mp2', '-b:a', '192k', '-ar', '48000', '-f', 'mpeg'];
    default:
      throw new Error(`No video settings for ${to}`);
  }
}

function gifArgs(options: ConvertOptions): string[] {
  const fps = opt<string>(options, 'gifFps', '15');
  const width = opt<string>(options, 'gifWidth', '480');
  const scale = width === 'original' ? '' : `scale='min(${Number(width)}\\,iw)':-1:flags=lanczos,`;
  return [
    '-filter_complex',
    `[0:v]fps=${Number(fps)},${scale}split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
    '-loop', '0', '-f', 'gif',
  ];
}

/** Native FFmpeg on the server, or the single-threaded WebAssembly build in the browser. */
export type Engine = 'native' | 'browser';

/** Arguments for one FFmpeg run, from input file to output file. */
export function ffmpegArgs(
  from: string,
  to: string,
  input: string,
  output: string,
  options: ConvertOptions,
  engine: Engine = 'native',
): string[] {
  const base = ['-hide_banner', '-nostdin', '-y', '-i', input, '-map_metadata', '0'];
  if (AUDIO.includes(to)) {
    return [...base, '-map', '0:a:0', '-vn', '-sn', '-dn', ...audioArgs(to, options), output];
  }
  if (to === 'gif') {
    return [...base, '-an', '-sn', '-dn', ...gifArgs(options), output];
  }
  if (VIDEO.includes(to)) {
    // GIF sources have no sound; "?" keeps the audio map optional for silent videos.
    return [...base, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn', ...videoArgs(to, options, engine), output];
  }
  throw new Error(`Unsupported media conversion ${from} → ${to}`);
}

/** Seconds from an FFmpeg "HH:MM:SS.xx" timestamp. */
export function parseTimestamp(s: string): number | null {
  const m = /(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(s);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** Tracks real progress from FFmpeg log lines: total duration first, then "time=" updates. */
export class ProgressParser {
  private duration: number | null = null;
  constructor(private report: (fraction: number | null) => void) {}
  line(text: string): void {
    if (this.duration === null) {
      const d = /Duration:\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/.exec(text);
      if (d) this.duration = parseTimestamp(d[1]);
    }
    const t = /time=\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/.exec(text);
    if (t) {
      const now = parseTimestamp(t[1]);
      if (now !== null && this.duration && this.duration > 0) this.report(Math.min(0.99, now / this.duration));
      else this.report(null);
    }
  }
}

/** The user-facing reason from an FFmpeg log, without codes or paths. */
export function explainFfmpegFailure(log: string, from: string, to: string): string {
  if (/does not contain any stream|matches no streams|Output file #0 does not contain/i.test(log)) {
    return AUDIO.includes(to) ? 'This file has no sound to convert.' : 'This file has no video to convert.';
  }
  if (/Invalid data found when processing input|moov atom not found|EBML header parsing failed/i.test(log)) {
    return `This ${from.toUpperCase()} file could not be read. It may be damaged or incomplete.`;
  }
  if (/Cannot allocate memory|Out of memory|OOM/i.test(log)) {
    return 'There is not enough memory for this file here. Try a lower resolution or a smaller file.';
  }
  if (/codec not currently supported in container|Could not find tag for codec/i.test(log)) {
    return `This audio or video cannot be stored in ${to.toUpperCase()}. Try another format.`;
  }
  return `The ${from.toUpperCase()} to ${to.toUpperCase()} conversion did not finish. The file may be damaged.`;
}
