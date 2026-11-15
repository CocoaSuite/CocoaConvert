import { formatFromName, getFormat } from './formats';

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** Makes a name safe for every desktop file system. Keeps Unicode letters. */
export function safeName(name: string, fallback = 'file'): string {
  let s = name
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .trim();
  if (!s || RESERVED.test(s.split('.')[0])) s = fallback + (s ? '_' + s : '');
  if (s.length > 180) {
    const dot = s.lastIndexOf('.');
    const ext = dot > 0 && s.length - dot <= 12 ? s.slice(dot) : '';
    s = s.slice(0, 180 - ext.length) + ext;
  }
  return s;
}

/** File name without its (possibly double) format extension. */
export function baseName(name: string): string {
  const leaf = name.split(/[\\/]/).pop() ?? name;
  const def = formatFromName(leaf);
  if (def) {
    const lower = leaf.toLowerCase();
    const ext = def.exts.filter((e) => e && lower.endsWith('.' + e)).sort((a, b) => b.length - a.length)[0];
    if (ext) return leaf.slice(0, leaf.length - ext.length - 1) || leaf;
  }
  const dot = leaf.lastIndexOf('.');
  return dot > 0 ? leaf.slice(0, dot) : leaf;
}

export function outputName(sourceName: string, target: string, suffix = ''): string {
  return safeName(`${baseName(sourceName)}${suffix}.${getFormat(target).ext}`);
}

/** Returns a name that is not in `taken`, adding " (2)", " (3)"… before the extension. */
export function uniqueName(name: string, taken: Set<string>): string {
  const key = (n: string) => n.toLowerCase();
  if (!taken.has(key(name))) {
    taken.add(key(name));
    return name;
  }
  const def = formatFromName(name);
  const ext = def ? def.exts.find((e) => e && name.toLowerCase().endsWith('.' + e)) : undefined;
  const stem = ext ? name.slice(0, name.length - ext.length - 1) : name;
  const tail = ext ? name.slice(name.length - ext.length - 1) : '';
  for (let i = 2; ; i++) {
    const candidate = `${stem} (${i})${tail}`;
    if (!taken.has(key(candidate))) {
      taken.add(key(candidate));
      return candidate;
    }
  }
}

/** Cleans an archive entry path: no absolute paths, no "..", safe segments. Returns null to skip. */
export function safeEntryPath(path: string): string | null {
  const parts = path.replace(/\\/g, '/').split('/');
  const clean: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') return null;
    clean.push(safeName(part, '_'));
  }
  return clean.length ? clean.join('/') : null;
}
