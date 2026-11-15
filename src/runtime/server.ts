import { safeName } from '../engine/filenames';
import { ConversionError, type ConvertOptions, type OutputFile } from '../engine/types';

export interface ServerCapabilities {
  converters: string[];
  maxUploadBytes: number;
}

const API = (import.meta.env?.VITE_API_BASE as string | undefined) ?? '/api';

/** Asks the optional server which tools it has. Resolves to null when there is no server. */
export async function fetchCapabilities(timeoutMs = 4000): Promise<ServerCapabilities | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}/capabilities`, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    const body = (await res.json()) as ServerCapabilities;
    return Array.isArray(body.converters) ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ServerProgress {
  phase: 'upload' | 'convert' | 'download';
  /** Fraction of the current phase, or null while the server works. */
  fraction: number | null;
}

/** Uploads one file, waits for the server to convert it, and returns the result. Nothing is kept on the server. */
export function convertOnServer(
  converter: string,
  input: { data: Uint8Array; name: string; from: string },
  to: string,
  options: ConvertOptions,
  onProgress: (p: ServerProgress) => void,
  signal?: AbortSignal,
): Promise<OutputFile[]> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ converter, from: input.from, to, options: JSON.stringify(options) });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/convert?${params}`);
    xhr.responseType = 'arraybuffer';
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => onProgress({ phase: 'upload', fraction: e.lengthComputable ? e.loaded / e.total : null });
    xhr.upload.onload = () => onProgress({ phase: 'convert', fraction: null });
    xhr.onprogress = (e) => {
      if (xhr.readyState >= 3) onProgress({ phase: 'download', fraction: e.lengthComputable ? e.loaded / e.total : null });
    };
    xhr.onerror = () => reject(new ConversionError('The conversion server could not be reached. Check your connection and try again.', 'network'));
    xhr.ontimeout = () => reject(new ConversionError('The conversion server took too long to answer.', 'timeout'));
    xhr.onabort = () => reject(new DOMException('Cancelled', 'AbortError'));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const name = decodeURIComponent(xhr.getResponseHeader('x-output-name') ?? '') || `output`;
        const format = xhr.getResponseHeader('x-output-format') ?? to;
        resolve([{ name: safeName(name), data: new Uint8Array(xhr.response as ArrayBuffer), format }]);
        return;
      }
      let message = 'The conversion did not finish on the server.';
      try {
        const body = JSON.parse(new TextDecoder().decode(xhr.response as ArrayBuffer)) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        if (xhr.status === 413) message = 'This file is larger than the server accepts.';
        if (xhr.status === 429) message = 'Too many conversions at once. Wait a minute and try again.';
      }
      reject(new ConversionError(message, xhr.status === 413 ? 'too-large' : 'failed'));
    };
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    // The name travels separately only so the server can name the result; it is not logged or stored.
    xhr.setRequestHeader('x-file-name', encodeURIComponent(input.name));
    xhr.send(new Blob([input.data as BlobPart]));
  });
}
