import { describe, expect, it } from 'vitest';
import { explainFfmpegFailure, ffmpegArgs, ProgressParser } from '../../src/converters/media/args';
import { AUDIO, VIDEO } from '../../src/engine/registry';

describe('FFmpeg arguments', () => {
  it('builds arguments for every target', () => {
    for (const to of [...AUDIO, ...VIDEO, 'gif']) {
      const args = ffmpegArgs('mp4', to, 'in.mp4', `out.${to}`, {});
      expect(args[args.length - 1]).toBe(`out.${to}`);
      expect(args).toContain('-nostdin');
    }
  });

  it('applies quality and resolution', () => {
    const args = ffmpegArgs('mov', 'mp4', 'in', 'out', { videoQuality: 'small', resolution: '720' }).join(' ');
    expect(args).toContain('-crf 28');
    expect(args).toContain('min(720');
  });

  it('drops video for audio targets', () => {
    expect(ffmpegArgs('mp4', 'mp3', 'in', 'out', { audioBitrate: '320' })).toEqual(expect.arrayContaining(['-vn', '320k']));
  });

  it('reports real progress from the log', () => {
    const seen: Array<number | null> = [];
    const p = new ProgressParser((f) => seen.push(f));
    p.line('  Duration: 00:00:10.00, start: 0.000000, bitrate: 1 kb/s');
    p.line('frame=1 fps=0 time=00:00:05.00 bitrate=1');
    expect(seen).toEqual([0.5]);
  });

  it('explains failures without codes', () => {
    expect(explainFfmpegFailure('Output file #0 does not contain any stream', 'mp4', 'mp3')).toBe('This file has no sound to convert.');
    expect(explainFfmpegFailure('moov atom not found', 'mp4', 'webm')).toMatch(/damaged/);
  });
});
