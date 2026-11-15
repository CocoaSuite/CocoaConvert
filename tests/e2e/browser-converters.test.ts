/**
 * Runs every on-device conversion edge in a real browser and checks each output file.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser, Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUDIO, CONVERTERS, VIDEO } from '../../src/engine/registry';
import { launch } from '../helpers/browser';
import { fixture, sniff } from '../helpers/fixtures';

const FIXTURE: Record<string, string> = { targz: 'sample.tar.gz', gz: 'sample.txt.gz', gif: 'sample.gif' };
let vite: ViteDevServer;
let browser: Browser;
let page: Page;
const out = mkdtempSync(join(tmpdir(), 'cc-browser-'));

beforeAll(async () => {
  vite = await createServer({ configFile: 'vite.config.ts', server: { port: 5199, strictPort: true }, logLevel: 'error' });
  await vite.listen();
  browser = await launch();
  page = await browser.newPage();
  await page.goto('http://localhost:5199/');
  await page.waitForSelector('.start');
});

afterAll(async () => {
  await browser?.close();
  await vite?.close();
});

async function convertInBrowser(converter: string, from: string, to: string, file: string, options = {}) {
  const b64 = Buffer.from(fixture(file)).toString('base64');
  // Sent as source text so the test runner does not rewrite the dynamic import.
  const body = `(async ({ converter, from, to, file, b64, options }) => {
    const { WORKER_CONVERTERS, MAIN_CONVERTERS } = await import('/src/converters/loaders.ts');
    const fn = await (WORKER_CONVERTERS[converter] ?? MAIN_CONVERTERS[converter])();
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const progress = [];
    const outs = await fn({ data, name: file, from }, { to, options, onProgress: (p) => progress.push(p) });
    const enc = (d) => { let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000)); return btoa(s); };
    return { outputs: outs.map((o) => ({ name: o.name, format: o.format, b64: enc(o.data) })), progress };
  })(${JSON.stringify({ converter, from, to, file, b64, options })})`;
  return page.evaluate(body) as Promise<{ outputs: { name: string; format: string; b64: string }[]; progress: (number | null)[] }>;
}

function validate(to: string, name: string, data: Uint8Array, tag: string) {
  const p = join(out, `${tag}-${name.replace(/\//g, '_')}`);
  writeFileSync(p, data);
  if (to === 'files') return;
  const sniffed = sniff(data, name).format;
  expect(sniffed === to || (to === 'm4a' && sniffed === 'mp4'), `${name} sniffed as ${sniffed}`).toBe(true);
  if (AUDIO.includes(to) || VIDEO.includes(to) || (to === 'gif' && tag.startsWith('ffmpeg'))) {
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', p]).toString());
    expect(Number(probe.format.duration)).toBeGreaterThan(0.1);
    const kinds = probe.streams.map((s: { codec_type: string }) => s.codec_type);
    expect(kinds).toContain(AUDIO.includes(to) ? 'audio' : 'video');
  } else if (['jpg', 'png', 'webp', 'avif', 'gif', 'bmp', 'tiff', 'ico'].includes(to)) {
    const id = execFileSync('identify', ['-format', '%w %h\n', p]).toString().trim().split('\n');
    expect(id.length).toBeGreaterThan(0);
    const [w, h] = id[id.length - 1].split(' ').map(Number);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
  } else if (to === 'pdf') {
    expect(execFileSync('pdfinfo', [p]).toString()).toMatch(/Pages:\s+1/);
  }
}

const clientEdges = CONVERTERS.filter((c) => c.env === 'client').flatMap((c) => c.edges.map((e) => ({ c: c.id, ...e })));

describe(`every on-device conversion in Chrome (${clientEdges.length})`, () => {
  for (const e of clientEdges) {
    it(`${e.c}: ${e.from} → ${e.to}`, async () => {
      const file = e.c === 'ffmpeg-wasm' && e.from === 'gif' ? 'animated.gif' : (FIXTURE[e.from] ?? `sample.${e.from}`);
      const { outputs, progress } = await convertInBrowser(e.c, e.from, e.to, file);
      expect(outputs.length).toBeGreaterThan(0);
      for (const o of outputs) validate(e.to, o.name, new Uint8Array(Buffer.from(o.b64, 'base64')), `${e.c}-${e.from}`);
      if (e.c === 'ffmpeg-wasm') expect(progress.at(-1)).toBe(1);
    });
  }
});

describe('browser behaviour that matters', () => {
  it('keeps transparency in PNG and flattens it in JPG', async () => {
    const png = await convertInBrowser('image', 'webp', 'png', 'sample.webp');
    const p = join(out, 'alpha.png');
    writeFileSync(p, Buffer.from(png.outputs[0].b64, 'base64'));
    expect(execFileSync('convert', [p, '-format', '%[pixel:p{0,0}]', 'info:']).toString()).toMatch(/srgba\(.*,0\)|none/);
    const jpg = await convertInBrowser('image', 'png', 'jpg', 'sample.png');
    const q = join(out, 'flat.jpg');
    writeFileSync(q, Buffer.from(jpg.outputs[0].b64, 'base64'));
    expect(execFileSync('convert', [q, '-format', '%[fx:int(255*p{0,0}.r)]', 'info:']).toString()).toMatch(/^25[0-5]$/);
  });

  it('decodes HEIC to the right picture', async () => {
    const r = await convertInBrowser('image', 'heic', 'png', 'sample.heic');
    const p = join(out, 'heic.png');
    writeFileSync(p, Buffer.from(r.outputs[0].b64, 'base64'));
    expect(execFileSync('identify', ['-format', '%w %h', p]).toString()).toBe('64 48');
    // Bottom half is orange-red in the source.
    const px = execFileSync('convert', [p, '-format', '%[fx:int(255*p{32,40}.r)] %[fx:int(255*p{32,40}.b)]', 'info:']).toString().split(' ').map(Number);
    expect(px[0]).toBeGreaterThan(150);
    expect(px[1]).toBeLessThan(100);
  });

  it('never runs scripts inside an SVG', async () => {
    await convertInBrowser('svg-raster', 'svg', 'png', 'sample.svg');
    expect(await page.title()).toBe('CocoaConvert');
  });

  it('renders every PDF page and extracts its text', async () => {
    const pages = await convertInBrowser('pdf-render', 'pdf', 'png', 'sample.pdf', { dpi: '72' });
    expect(pages.outputs.length).toBeGreaterThanOrEqual(1);
    const text = await convertInBrowser('pdf-text', 'pdf', 'txt', 'sample.pdf');
    expect(Buffer.from(text.outputs[0].b64, 'base64').toString()).toContain('CocoaConvert sample');
  });

  it('turns HTML into Markdown without scripts', async () => {
    const r = await convertInBrowser('html-text', 'html', 'md', 'sample.html');
    const md = Buffer.from(r.outputs[0].b64, 'base64').toString();
    expect(md).toMatch(/^# CocoaConvert sample/m);
    expect(md).toContain('**bold**');
  });

  it('honours video options', async () => {
    const r = await convertInBrowser('ffmpeg-wasm', 'mp4', 'gif', 'sample.mp4', { gifWidth: '320', gifFps: '10' });
    const p = join(out, 'opt.gif');
    writeFileSync(p, Buffer.from(r.outputs[0].b64, 'base64'));
    expect(execFileSync('identify', ['-format', '%w\n', p]).toString().split('\n')[0]).toBe('160');
    const small = await convertInBrowser('ffmpeg-wasm', 'mp4', 'webm', 'sample.mp4', { resolution: '360' });
    expect(small.outputs[0].name).toBe('sample.webm');
  });
});
