/**
 * Writes docs/SUPPORTED_FORMATS.md from the conversion registry, so the list always matches the app.
 * Run with: npm run docs:formats
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { CATEGORY_LABELS, CATEGORY_ORDER, FORMATS, getFormat } from '../src/engine/formats';
import { allRoutes, routeUsesServer } from '../src/engine/graph';
import { CONVERTERS } from '../src/engine/registry';

const server = { server: new Set(CONVERTERS.filter((c) => c.env === 'server').map((c) => c.id)) };
const lines: string[] = [
  '# Supported conversions',
  '',
  'Generated from the conversion registry (`src/engine/registry.ts`) by `npm run docs:formats`. Every single-step conversion in the registry is run by the test suite on real sample files and its output checked. Some targets are reached in two or three steps (for example Markdown → HTML → PDF); those chain tested steps and keep the result in memory between them.',
  '',
  '- **On device**: runs in the browser. The file never leaves the computer.',
  '- **Server**: needs the optional CocoaConvert server with the tools listed in the README, and the user’s permission for each session.',
  '',
];
let device = 0;
let viaServer = 0;
for (const cat of CATEGORY_ORDER) {
  const sources = FORMATS.filter((f) => f.category === cat && !f.pseudo);
  const rows: string[] = [];
  for (const f of sources) {
    const routes = [...allRoutes(f.id, 0, server)];
    if (!routes.length) continue;
    const label = (to: string) => getFormat(to).label;
    const d = routes.filter(([, r]) => !routeUsesServer(r)).map(([to]) => label(to));
    const s = routes.filter(([, r]) => routeUsesServer(r)).map(([to]) => label(to));
    device += d.length;
    viaServer += s.length;
    rows.push(`| ${f.label} (${f.exts.filter(Boolean).map((e) => '.' + e).join(', ')}) | ${d.join(', ') || '—'} | ${s.join(', ') || '—'} |`);
  }
  if (!rows.length) continue;
  lines.push(`## ${CATEGORY_LABELS[cat]}`, '', '| From | On device | Server |', '| --- | --- | --- |', ...rows, '');
}
lines.splice(7, 0, `In total: ${device} conversions on device and ${viaServer} more with the server.`, '');
mkdirSync('docs', { recursive: true });
writeFileSync('docs/SUPPORTED_FORMATS.md', lines.join('\n'));
console.log(`docs/SUPPORTED_FORMATS.md: ${device} on device, ${viaServer} with the server`);
