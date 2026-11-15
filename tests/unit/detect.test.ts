import { describe, expect, it } from 'vitest';
import { formatFromName } from '../../src/engine/formats';
import { fixture, fixtureNames, sniff } from '../helpers/fixtures';

const EXPECTED: Record<string, string> = {
  'animated.gif': 'gif',
  'sample.tar.gz': 'targz',
  'sample.tar.bz2': 'tarbz2',
  'sample.tar.xz': 'tarxz',
  'sample.txt.gz': 'gz',
  'sample.txt.bz2': 'bz2',
  'sample.txt.xz': 'xz',
};

describe('format detection', () => {
  for (const name of fixtureNames()) {
    const expected = EXPECTED[name] ?? formatFromName(name)!.id;
    it(`detects ${name} as ${expected}`, () => {
      const d = sniff(fixture(name), name);
      expect(d.format).toBe(expected);
      expect(d.extensionMismatch).toBeUndefined();
    });
  }

  it('trusts content over a wrong extension', () => {
    const d = sniff(fixture('sample.jpg'), 'photo.png');
    expect(d).toEqual({ format: 'jpg', extensionMismatch: 'png' });
  });

  it('recognises office files with no extension', () => {
    expect(sniff(fixture('sample.docx'), 'document').format).toBe('docx');
    expect(sniff(fixture('sample.xlsx'), 'book').format).toBe('xlsx');
    expect(sniff(fixture('sample.odt'), 'x').format).toBe('odt');
    expect(sniff(fixture('sample.epub'), 'x').format).toBe('epub');
    expect(sniff(fixture('sample.doc'), 'x').format).toBe('doc');
  });

  it('rejects unknown binary data', () => {
    const junk = new Uint8Array(512).map((_, i) => (i * 37 + 3) % 256);
    expect(sniff(junk, 'mystery.bin').format).toBeNull();
  });

  it('falls back to text for invalid JSON named .json', () => {
    const d = sniff(new TextEncoder().encode('hello'), 'x.json');
    expect(d.format).toBe('txt');
    expect(d.extensionMismatch).toBe('json');
  });

  it('does not treat an executable renamed to .png as an image', () => {
    const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, ...new Array(200).fill(0)]);
    expect(sniff(elf, 'cat.png').format).toBeNull();
  });
});
