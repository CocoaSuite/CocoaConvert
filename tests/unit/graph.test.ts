import { describe, expect, it } from 'vitest';
import { WORKER_CONVERTERS, MAIN_CONVERTERS } from '../../src/converters/loaders';
import { FORMATS, getFormat } from '../../src/engine/formats';
import { allRoutes, findRoute, NO_SERVER, routeUsesServer } from '../../src/engine/graph';
import { CONVERTERS } from '../../src/engine/registry';

const ALL_SERVER = { server: new Set(CONVERTERS.filter((c) => c.env === 'server').map((c) => c.id)) };
const SERVER_IMPLEMENTED = ['libreoffice', 'pandoc', 'ffmpeg', 'archive-native'];

describe('conversion registry', () => {
  it('every edge uses known formats', () => {
    for (const c of CONVERTERS) for (const e of c.edges) {
      expect(() => getFormat(e.from)).not.toThrow();
      expect(() => getFormat(e.to)).not.toThrow();
    }
  });

  it('every client converter has an implementation on the right thread', () => {
    for (const c of CONVERTERS.filter((x) => x.env === 'client')) {
      const table = c.thread === 'main' ? MAIN_CONVERTERS : WORKER_CONVERTERS;
      expect(table[c.id], c.id).toBeTypeOf('function');
    }
  });

  it('every server converter has an implementation', () => {
    for (const c of CONVERTERS.filter((x) => x.env === 'server')) expect(SERVER_IMPLEMENTED).toContain(c.id);
  });

  it('never routes through the server when there is none', () => {
    for (const f of FORMATS) for (const r of allRoutes(f.id, 1000, NO_SERVER).values()) expect(routeUsesServer(r)).toBe(false);
  });

  it('prefers on-device conversion when both exist', () => {
    const r = findRoute('mov', 'mp4', 1000, ALL_SERVER)!;
    expect(r.steps.map((s) => s.converter.id)).toEqual(['ffmpeg-wasm']);
  });

  it('falls back to the server for files too large for the browser', () => {
    const r = findRoute('mov', 'mp4', 2 * 1024 ** 3, ALL_SERVER)!;
    expect(r.steps.map((s) => s.converter.id)).toEqual(['ffmpeg']);
  });

  it('builds intermediate routes', () => {
    expect(findRoute('md', 'pdf', 1, ALL_SERVER)!.steps.map((s) => s.to)).toEqual(['html', 'pdf']);
    expect(findRoute('heic', 'pdf', 1, NO_SERVER)!.steps.map((s) => s.to)).toEqual(['png', 'pdf']);
    expect(findRoute('svg', 'jpg', 1, NO_SERVER)!.steps.map((s) => s.to)).toEqual(['png', 'jpg']);
    expect(findRoute('docx', 'md', 1, NO_SERVER)!.steps.map((s) => s.to)).toEqual(['html', 'md']);
    expect(findRoute('7z', 'files', 1, ALL_SERVER)!.steps.map((s) => s.to)).toEqual(['tar', 'files']);
  });

  it('never chains single-step-only edges', () => {
    // An image is never turned into a Word file by way of a PDF.
    expect(findRoute('jpg', 'docx', 1, ALL_SERVER)).toBeNull();
    expect(findRoute('png', 'mp4', 1, ALL_SERVER)).toBeNull();
    expect(findRoute('pdf', 'webp', 1, ALL_SERVER)).toBeNull();
    for (const f of FORMATS)
      for (const r of allRoutes(f.id, 1, ALL_SERVER).values())
        if (r.steps.length > 1) for (const s of r.steps) expect(s.converter.edges.find((e) => e.from === s.from && e.to === s.to)!.chain).toBe(true);
  });

  it('offers no identity conversions', () => {
    for (const f of FORMATS) expect(allRoutes(f.id, 1, ALL_SERVER).has(f.id)).toBe(false);
  });
});
