import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import * as XLSX from 'xlsx';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { convertArchive, makeArchiveConverter, readZip } from '../../src/converters/archive';
import { readTar, writeTar } from '../../src/converters/archive/tar';
import { convertData } from '../../src/converters/data';
import { convertSheet } from '../../src/converters/data/sheet';
import { convertDocx } from '../../src/converters/docs/docx';
import { convertImageToPdf } from '../../src/converters/docs/image-pdf';
import { convertToHtml } from '../../src/converters/docs/markup';
import { decodeTiff, encodeBmp, encodeGif, encodeIco, encodeTiff, largestIcoEntry, type Pixels } from '../../src/converters/image/codecs';
import { LIMITS } from '../../src/engine/limits';
import { ConversionError } from '../../src/engine/types';
import { fixture, sniff } from '../helpers/fixtures';

const text = (d: Uint8Array) => new TextDecoder().decode(d);
const run = (fn: typeof convertData, file: string, from: string, to: string, options = {}) =>
  fn({ data: fixture(file), name: file, from }, { to, options });
const tmp = mkdtempSync(join(tmpdir(), 'cc-test-'));
/** Writes bytes and asks ImageMagick to read them back: proof the file is valid. */
const identify = (data: Uint8Array, ext: string) => {
  const p = join(tmp, `check.${ext}`);
  writeFileSync(p, data);
  return execFileSync('identify', ['-format', '%m %w %h\n', p]).toString().trim().split('\n')[0];
};

describe('structured data', () => {
  it('CSV → JSON keeps types, quotes and Unicode', async () => {
    const [out] = await run(convertData, 'sample.csv', 'csv', 'json');
    expect(out.name).toBe('sample.json');
    const data = JSON.parse(text(out.data));
    expect(data[0]).toEqual({ name: 'Alpha', size: 1, active: true, note: 'Comma, inside' });
    expect(data[1].note).toBe('Line "quoted"');
    expect(data[2]).toMatchObject({ name: 'Gamma', size: null, note: 'Ünïcode' });
  });

  it('JSON → CSV flattens nested values and round-trips', async () => {
    const [csv] = await run(convertData, 'sample.json', 'json', 'csv');
    const lines = text(csv.data).trim().split('\r\n');
    expect(lines[0]).toBe('name,size,tags,owner.id,owner.email');
    expect(lines[1]).toBe('Alpha,1,"[""a"",""b""]",7,a@example.com');
    const [back] = await convertData({ data: csv.data, name: 'x.csv', from: 'csv' }, { to: 'json', options: {} });
    expect(JSON.parse(text(back.data))[1]).toMatchObject({ name: 'Beta', size: 2.5, 'owner.id': 8 });
  });

  it('XML → JSON keeps attributes', async () => {
    const [out] = await run(convertData, 'sample.xml', 'xml', 'json');
    const data = JSON.parse(text(out.data));
    expect(data.catalog.book[0]).toEqual({ '@id': 'b1', title: 'Alpha', price: 10.5 });
  });

  it('YAML → JSON, JSON → YAML and JSON → XML', async () => {
    const [json] = await run(convertData, 'sample.yaml', 'yaml', 'json');
    expect(JSON.parse(text(json.data))).toEqual({ name: 'CocoaConvert', version: 1, formats: ['png', 'jpg'], nested: { enabled: true } });
    const [yaml] = await run(convertData, 'sample.json', 'json', 'yaml');
    expect((load(text(yaml.data)) as unknown[]).length).toBe(2);
    const [xml] = await run(convertData, 'sample.json', 'json', 'xml');
    expect(text(xml.data)).toMatch(/^<\?xml[\s\S]*<root>[\s\S]*<name>Alpha<\/name>/);
    const [again] = await convertData({ data: xml.data, name: 'x.xml', from: 'xml' }, { to: 'json', options: {} });
    expect(JSON.parse(text(again.data)).root.item[0].name).toBe('Alpha');
  });

  it('CSV → SQL, Markdown, HTML and TSV', async () => {
    const [sql] = await run(convertData, 'sample.csv', 'csv', 'sql');
    expect(text(sql.data)).toContain('CREATE TABLE "sample"');
    expect(text(sql.data)).toContain(`INSERT INTO "sample" ("name", "size", "active", "note") VALUES ('Alpha', 1, TRUE, 'Comma, inside');`);
    const [md] = await run(convertData, 'sample.csv', 'csv', 'md');
    expect(text(md.data).split('\n')[1]).toBe('| --- | --- | --- | --- |');
    const [html] = await run(convertData, 'sample.csv', 'csv', 'html');
    expect(text(html.data)).toContain('<td>Comma, inside</td>');
    const [tsv] = await run(convertData, 'sample.csv', 'csv', 'tsv');
    expect(text(tsv.data).split('\r\n')[1]).toBe('Alpha\t1\ttrue\tComma, inside');
  });

  it('reports invalid input clearly', async () => {
    const bad = (s: string, from: string) => convertData({ data: new TextEncoder().encode(s), name: 'x', from }, { to: 'json', options: {} });
    await expect(bad('{"a": ', 'json').then(() => convertData({ data: new TextEncoder().encode('{"a": '), name: 'x', from: 'json' }, { to: 'csv', options: {} }))).rejects.toThrow(/not valid JSON/);
    await expect(bad('<a><b></a>', 'xml')).rejects.toThrow(/not valid XML/);
    await expect(bad('a: [1', 'yaml')).rejects.toThrow(/not valid YAML/);
  });

  it('does not expand XML entities (no billion laughs)', async () => {
    const bomb = '<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><r>&b;</r>';
    const [out] = await convertData({ data: new TextEncoder().encode(bomb), name: 'x.xml', from: 'xml' }, { to: 'json', options: {} });
    expect(out.data.length).toBeLessThan(200);
  });
});

describe('spreadsheets', () => {
  for (const src of ['xlsx', 'xls', 'ods']) {
    it(`${src.toUpperCase()} → CSV, JSON, HTML and other workbooks`, async () => {
      const [csv] = await run(convertSheet, `sample.${src}`, src, 'csv');
      expect(text(csv.data)).toMatch(/^name,size,active,note\nAlpha,1,TRUE,"Comma, inside"/);
      const [json] = await run(convertSheet, `sample.${src}`, src, 'json');
      expect(JSON.parse(text(json.data))[0]).toMatchObject({ name: 'Alpha', size: 1 });
      const [html] = await run(convertSheet, `sample.${src}`, src, 'html');
      expect(text(html.data)).toContain('Gamma');
      for (const to of ['xlsx', 'xls', 'ods'].filter((t) => t !== src)) {
        const [book] = await run(convertSheet, `sample.${src}`, src, to);
        expect(sniff(book.data, book.name).format).toBe(to);
        const wb = XLSX.read(book.data);
        expect(XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]])).toContain('Beta,2.5');
      }
    });
  }

  it('CSV → XLSX opens in LibreOffice', async () => {
    const [book] = await run(convertSheet, 'sample.csv', 'csv', 'xlsx');
    const p = join(tmp, 'book.xlsx');
    writeFileSync(p, book.data);
    execFileSync('soffice', ['--headless', `-env:UserInstallation=file://${tmp}/lo`, '--convert-to', 'csv', '--outdir', tmp, p], { stdio: 'ignore' });
    expect(readFileSync(join(tmp, 'book.csv'), 'utf8')).toContain('Gamma');
  });

  it('writes one CSV per sheet', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a'], [1]]), 'First');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['b'], [2]]), 'Second');
    const data = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    const outs = await convertSheet({ data, name: 'two.xlsx', from: 'xlsx' }, { to: 'csv', options: {} });
    expect(outs.map((o) => o.name)).toEqual(['two - First.csv', 'two - Second.csv']);
  });
});

describe('archives', () => {
  const names = (outs: { name: string }[]) => outs.map((o) => o.name).sort();

  for (const [file, from] of [['sample.zip', 'zip'], ['sample.tar', 'tar'], ['sample.tar.gz', 'targz']] as const) {
    it(`extracts ${file} and repackages it`, async () => {
      const files = await run(convertArchive, file, from, 'files');
      expect(names(files)).toEqual(['folder/notes.txt', 'picture.png']);
      expect(text(files.find((f) => f.name.endsWith('.txt'))!.data)).toBe(text(fixture('sample.txt')));
      for (const to of ['zip', 'tar', 'targz'].filter((t) => t !== from)) {
        const [out] = await run(convertArchive, file, from, to);
        expect(sniff(out.data, out.name).format).toBe(to);
        const path = join(tmp, out.name);
        writeFileSync(path, out.data);
        const listing = execFileSync(to === 'zip' ? 'unzip' : 'tar', to === 'zip' ? ['-l', path] : ['-tf', path]).toString();
        expect(listing).toContain('folder/notes.txt');
      }
    });
  }

  it('decompresses a single GZ file', async () => {
    const [out] = await run(convertArchive, 'sample.txt.gz', 'gz', 'files');
    expect(out.name).toBe('sample.txt');
    expect(text(out.data)).toBe(text(fixture('sample.txt')));
  });

  it('skips paths that try to leave the folder', () => {
    const z = zipSync({ '../evil.txt': new Uint8Array([1]), 'ok/../../x': new Uint8Array([2]), 'fine.txt': new Uint8Array([3]) });
    expect(readZip(z).map((e) => e.path)).toEqual(['fine.txt']);
  });

  it('stops a ZIP bomb before it fills memory', async () => {
    const zeros = new Uint8Array(100 * 1024 * 1024);
    const bomb = zipSync({ 'zeros.bin': [zeros, { level: 9 }] });
    expect(bomb.length).toBeLessThan(200_000);
    const strict = makeArchiveConverter({ ...LIMITS, ratioCheckFloor: 1024 * 1024, maxCompressionRatio: 100 });
    await expect(strict({ data: bomb, name: 'b.zip', from: 'zip' }, { to: 'files', options: {} })).rejects.toThrow(ConversionError);
    await expect(strict({ data: gzipSync(zeros), name: 'b.gz', from: 'gz' }, { to: 'files', options: {} })).rejects.toThrow(/more data than/);
  });

  it('limits the number of entries', () => {
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i < 30; i++) many[`f${i}`] = new Uint8Array([i]);
    expect(() => readZip(zipSync(many), { ...LIMITS, maxArchiveEntries: 10 })).toThrow(/more than 10 files/);
  });

  it('writes long and Unicode paths that GNU tar reads back', () => {
    const long = `${'deep/'.repeat(30)}файл.txt`;
    const tar = writeTar([{ path: long, data: new Uint8Array([65]) }]);
    writeFileSync(join(tmp, 'long.tar'), tar);
    const out = execFileSync('tar', ['--quoting-style=literal', '-tf', join(tmp, 'long.tar')], { env: { ...process.env, LC_ALL: 'C.UTF-8' } });
    expect(out.toString().trim()).toBe(long);
    expect(readTar(tar)[0].path).toBe(long);
  });

  it('rejects damaged TAR files', () => {
    const tar = fixture('sample.tar').slice();
    tar[100] ^= 0xff;
    expect(() => readTar(tar)).toThrow(/damaged/);
  });
});

describe('pure image codecs', () => {
  const pixels: Pixels = {
    width: 3,
    height: 2,
    data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 0, 10, 20, 30, 255, 40, 50, 60, 128]),
  };

  it('BMP output is a valid image', () => {
    expect(identify(encodeBmp(pixels), 'bmp')).toMatch(/^BMP3? 3 2$/);
  });

  it('TIFF output is valid and round-trips', () => {
    const tiff = encodeTiff(pixels);
    expect(identify(tiff, 'tiff')).toBe('TIFF 3 2');
    expect([...decodeTiff(tiff).data.slice(0, 8)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
    expect(decodeTiff(fixture('sample.tiff')).width).toBe(64);
  });

  it('GIF output is valid and keeps transparency', () => {
    const gif = encodeGif(pixels);
    expect(identify(gif, 'gif')).toBe('GIF 3 2');
  });

  it('ICO output holds every size and reads back', () => {
    const png = fixture('sample.png');
    const ico = encodeIco([{ size: 16, png }, { size: 64, png }]);
    writeFileSync(join(tmp, 'x.ico'), ico);
    expect(execFileSync('file', [join(tmp, 'x.ico')]).toString()).toMatch(/MS Windows icon resource - 2 icons/);
    expect(largestIcoEntry(ico).width).toBe(64);
    expect(largestIcoEntry(fixture('sample.ico')).width).toBe(48);
  });
});

describe('documents', () => {
  it('DOCX → HTML keeps headings, lists and tables', async () => {
    const [html] = await run(convertDocx, 'sample.docx', 'docx', 'html');
    const s = text(html.data);
    expect(s).toContain('<h1>CocoaConvert sample</h1>');
    expect(s).toMatch(/<li>First item<\/li>/);
    expect(s).toMatch(/<table>[\s\S]*Alpha/);
  });

  it('DOCX → TXT', async () => {
    const [txt] = await run(convertDocx, 'sample.docx', 'docx', 'txt');
    expect(text(txt.data)).toContain('A paragraph with bold, italic and a link.');
  });

  it('Markdown and text → HTML', async () => {
    const [html] = await run(convertToHtml, 'sample.md', 'md', 'html');
    expect(text(html.data)).toMatch(/<h1[^>]*>CocoaConvert sample<\/h1>[\s\S]*<strong>bold<\/strong>[\s\S]*<table>/);
    const [t] = await run(convertToHtml, 'sample.txt', 'txt', 'html');
    expect(text(t.data)).toContain('&amp; &lt;angle&gt;');
  });

  it('images → one-page PDF the size of the image', async () => {
    for (const [file, from] of [['sample.png', 'png'], ['sample.jpg', 'jpg']]) {
      const [pdf] = await run(convertImageToPdf, file, from, 'pdf');
      const doc = await PDFDocument.load(pdf.data);
      expect(doc.getPageCount()).toBe(1);
      expect(doc.getPage(0).getSize()).toEqual({ width: 48, height: 36 });
      writeFileSync(join(tmp, 'x.pdf'), pdf.data);
      expect(execFileSync('pdfinfo', [join(tmp, 'x.pdf')]).toString()).toMatch(/Pages:\s+1/);
    }
  });
});
