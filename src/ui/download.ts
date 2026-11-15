import { uniqueName } from '../engine/filenames';
import { zipLevel } from '../converters/archive/levels';
import type { Output } from './batch';

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before the URL is released.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Packs outputs into one ZIP. Compression runs off the main thread; media is stored as is. */
export async function zipOutputs(outputs: Output[]): Promise<Blob> {
  const { zip } = await import('fflate');
  const taken = new Set<string>();
  const tree: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const o of outputs) {
    const name = uniqueName(o.name, taken);
    tree[name] = [new Uint8Array(await o.blob.arrayBuffer()), { level: zipLevel(name) }];
  }
  const data = await new Promise<Uint8Array>((resolve, reject) =>
    zip(tree, { consume: true }, (err, out) => (err ? reject(err) : resolve(out))),
  );
  return new Blob([data as BlobPart], { type: 'application/zip' });
}
