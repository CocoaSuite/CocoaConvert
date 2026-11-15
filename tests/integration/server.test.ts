import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../server/app';
import { loadConfig, type ServerConfig } from '../../server/config';
import { detectTools, type Tools } from '../../server/process';
import { CONVERTERS } from '../../src/engine/registry';
import { AUDIO, VIDEO } from '../../src/engine/registry';
import { fixture, sniff } from '../helpers/fixtures';

const FIXTURE: Record<string, string> = {
  targz: 'sample.tar.gz',
  tarbz2: 'sample.tar.bz2',
  tarxz: 'sample.tar.xz',
  gz: 'sample.txt.gz',
  bz2: 'sample.txt.bz2',
  xz: 'sample.txt.xz',
  gif: 'animated.gif',
};
const fixtureFor = (f: string) => FIXTURE[f] ?? `sample.${f}`;
const EXT: Record<string, string> = { targz: 'tar.gz', tarbz2: 'tar.bz2', tarxz: 'tar.xz', gz: 'txt.gz', bz2: 'txt.bz2', xz: 'txt.xz' };

let app: FastifyInstance;
let tools: Tools;
let config: ServerConfig;
const check = mkdtempSync(join(tmpdir(), 'cc-check-'));

async function convert(converter: string, from: string, to: string, body: Uint8Array, options = {}) {
  return app.inject({
    method: 'POST',
    url: `/api/convert?converter=${converter}&from=${from}&to=${to}&options=${encodeURIComponent(JSON.stringify(options))}`,
    headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(`My file.${EXT[from] ?? from}`) },
    payload: Buffer.from(body),
  });
}

beforeAll(async () => {
  tools = await detectTools();
  config = { ...loadConfig({}), workRoot: mkdtempSync(join(tmpdir(), 'cc-work-')), staticDir: '', concurrency: 4, rateLimit: 100_000 };
  app = await buildApp(config, tools);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

describe('server API', () => {
  it('reports installed converters', async () => {
    const res = await app.inject('/api/capabilities');
    expect(res.json().converters.sort()).toEqual(['archive-native', 'ffmpeg', 'libreoffice', 'pandoc']);
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('runs tools without network access where the OS allows it', () => {
    expect(tools.isolate).toEqual(['unshare', '-rn']);
  });

  it('refuses conversions it does not offer', async () => {
    expect((await convert('libreoffice', 'png', 'pdf', fixture('sample.png'))).statusCode).toBe(400);
    expect((await convert('nope', 'docx', 'pdf', fixture('sample.docx'))).statusCode).toBe(400);
  });

  it('checks the content, not the claimed format', async () => {
    const res = await convert('libreoffice', 'docx', 'pdf', fixture('sample.png'));
    expect(res.statusCode).toBe(415);
    expect(res.json().error).toBe('This file does not look like DOCX (it looks like PNG).');
  });

  it('turns away files over the size limit', async () => {
    const small = await buildApp({ ...config, maxUploadBytes: 1000, workRoot: mkdtempSync(join(tmpdir(), 'cc-small-')) }, tools);
    const res = await small.inject({
      method: 'POST',
      url: '/api/convert?converter=libreoffice&from=docx&to=pdf',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from(fixture('sample.docx')),
    });
    expect(res.statusCode).toBe(413);
    // Streamed uploads carry no length up front; the limit still applies while reading.
    const { Readable } = await import('node:stream');
    const streamed = await small.inject({
      method: 'POST',
      url: '/api/convert?converter=libreoffice&from=docx&to=pdf',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Readable.from([Buffer.from(fixture('sample.docx'))]),
    });
    expect(streamed.statusCode).toBe(413);
    expect(streamed.json().error).toBe('This file is larger than the server accepts.');
    await small.close();
  });

  it('never lets a document embed files from the server', async () => {
    const evil = new TextEncoder().encode('# Hi\n\n![secret](/etc/hostname)\n\n![up](../../etc/passwd)\n');
    const res = await convert('pandoc', 'md', 'docx', evil);
    expect(res.statusCode).toBe(200);
    const p = join(check, 'evil.docx');
    writeFileSync(p, res.rawPayload);
    const listing = execFileSync('unzip', ['-l', p]).toString();
    expect(listing).not.toMatch(/media\//);
    expect(execFileSync('pandoc', ['-t', 'plain', p]).toString()).toContain('secret');
  });

  it('explains damaged files without technical detail', async () => {
    const broken = fixture('sample.mp4').slice(0, 3000);
    const res = await convert('ffmpeg', 'mp4', 'webm', broken);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/could not be read|did not finish/);
    expect(res.json().error).not.toMatch(/\/tmp|exit|code/);
  });

  it('rejects an archive that would expand too far', async () => {
    const zeros = join(check, 'zeros.bin');
    execFileSync('dd', ['if=/dev/zero', `of=${zeros}`, 'bs=1M', 'count=200'], { stdio: 'ignore' });
    execFileSync('xz', ['-k', '-9', zeros]);
    const res = await convert('archive-native', 'xz', 'files', new Uint8Array(require('node:fs').readFileSync(`${zeros}.xz`)));
    expect(res.statusCode).toBe(413);
  });
});

const serverEdges = CONVERTERS.filter((c) => c.env === 'server').flatMap((c) => c.edges.map((e) => ({ c: c.id, ...e })));

describe.concurrent(`every server conversion (${serverEdges.length})`, () => {
  for (const e of serverEdges) {
    it(`${e.c}: ${e.from} → ${e.to}`, async () => {
      const res = await convert(e.c, e.from, e.to, fixture(fixtureFor(e.from)));
      expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
      const out = new Uint8Array(res.rawPayload);
      const name = decodeURIComponent(String(res.headers['x-output-name']));
      expect(out.length).toBeGreaterThan(0);
      if (e.to === 'files') {
        expect(name).toBe('My file.txt');
        expect(Buffer.from(out).equals(Buffer.from(fixture('sample.txt')))).toBe(true);
        return;
      }
      expect(name).toBe(`My file.${EXT[e.to] ?? (e.to === 'mpeg' ? 'mpeg' : e.to)}`);
      const sniffed = sniff(out, name).format;
      expect(sniffed === e.to || (e.to === 'm4a' && sniffed === 'mp4')).toBe(true);
      const p = join(check, `${e.c}-${e.from}-${e.to}-${name}`);
      writeFileSync(p, out);
      if (AUDIO.includes(e.to) || VIDEO.includes(e.to) || (e.to === 'gif' && e.c === 'ffmpeg')) {
        const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', p]).toString());
        expect(Number(probe.format.duration)).toBeGreaterThan(0.5);
        if (e.to === 'mp4' || e.to === 'webm') expect(probe.streams.find((s: { codec_type: string }) => s.codec_type === 'video').nb_frames ?? '1').not.toBe('0');
        const kinds = probe.streams.map((s: { codec_type: string }) => s.codec_type);
        if (AUDIO.includes(e.to)) expect(kinds).toEqual(['audio']);
        else expect(kinds).toContain('video');
      }
      if (e.to === 'pdf') expect(execFileSync('pdfinfo', [p]).toString()).toMatch(/Pages:\s+[1-9]/);
      if (['docx', 'odt', 'epub', 'html', 'md', 'txt', 'rtf'].includes(e.to) && e.from !== 'pdf') {
        const t = execFileSync('pandoc', ['-f', { docx: 'docx', odt: 'odt', epub: 'epub', html: 'html', md: 'gfm', txt: 'markdown', rtf: 'rtf' }[e.to]!, '-t', 'plain', p]).toString();
        expect(t).toMatch(/CocoaConvert sample|Alpha|Plain text/);
      }
      if (e.to === 'zip' || e.to === '7z' || e.to === 'tar') {
        const list = execFileSync(require('7zip-bin').path7za, ['l', p]).toString();
        expect(list).toContain('notes.txt');
        expect(list).toContain('picture.png');
      }
    });
  }
});

describe('clean-up', () => {
  it('leaves no job folders behind', async () => {
    await new Promise((r) => setTimeout(r, 500));
    expect(readdirSync(config.workRoot)).toEqual([]);
  });
});
