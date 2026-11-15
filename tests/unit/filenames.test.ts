import { describe, expect, it } from 'vitest';
import { baseName, outputName, safeEntryPath, safeName, uniqueName } from '../../src/engine/filenames';
import { formatBytes } from '../../src/engine/limits';
import { optionsFor } from '../../src/engine/options';

describe('file names', () => {
  it('swaps extensions, including double ones', () => {
    expect(outputName('holiday.HEIC', 'jpg')).toBe('holiday.jpg');
    expect(outputName('backup.tar.gz', 'zip')).toBe('backup.zip');
    expect(outputName('report.final.docx', 'pdf')).toBe('report.final.pdf');
    expect(outputName('noext', 'png')).toBe('noext.png');
    expect(baseName('a/b/c.md')).toBe('c');
  });

  it('removes characters that break file systems', () => {
    expect(safeName('a<b>:c"d|e?f*g.txt')).toBe('a_b__c_d_e_f_g.txt');
    expect(safeName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(safeName('CON.txt')).toBe('file_CON.txt');
    expect(safeName('   ')).toBe('file');
    expect(safeName('x'.repeat(300) + '.png').length).toBeLessThanOrEqual(180);
  });

  it('keeps names unique', () => {
    const taken = new Set<string>();
    expect(uniqueName('a.png', taken)).toBe('a.png');
    expect(uniqueName('A.png', taken)).toBe('A (2).png');
    expect(uniqueName('a.png', taken)).toBe('a (3).png');
    expect(uniqueName('x.tar.gz', taken)).toBe('x.tar.gz');
    expect(uniqueName('x.tar.gz', taken)).toBe('x (2).tar.gz');
  });

  it('rejects archive paths that escape the folder', () => {
    expect(safeEntryPath('../evil.sh')).toBeNull();
    expect(safeEntryPath('a/../../b')).toBeNull();
    expect(safeEntryPath('/etc/passwd')).toBe('etc/passwd');
    expect(safeEntryPath('C:\\win\\x.txt')).toBe('C_/win/x.txt');
    expect(safeEntryPath('ok/file.txt')).toBe('ok/file.txt');
  });

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });

  it('shows only options that apply', () => {
    expect(optionsFor('png', 'image', 'jpg').map((o) => o.key)).toEqual(['quality']);
    expect(optionsFor('png', 'image', 'png')).toEqual([]);
    expect(optionsFor('svg', 'image', 'png').map((o) => o.key)).toEqual(['svgScale']);
    expect(optionsFor('mp4', 'video', 'gif').map((o) => o.key)).toEqual(['gifWidth', 'gifFps']);
    expect(optionsFor('mov', 'video', 'mp4').map((o) => o.key)).toEqual(['videoQuality', 'resolution']);
    expect(optionsFor('pdf', 'document', 'jpg').map((o) => o.key)).toEqual(['quality', 'dpi']);
  });
});
