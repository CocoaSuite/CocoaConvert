/// <reference types="vite/client" />

declare module 'gifenc' {
  export type Palette = number[][];
  export function quantize(data: Uint8Array | Uint8ClampedArray, maxColors: number, options?: Record<string, unknown>): Palette;
  export function applyPalette(data: Uint8Array | Uint8ClampedArray, palette: Palette, format?: string): Uint8Array;
  export function GIFEncoder(): {
    writeFrame(index: Uint8Array, width: number, height: number, options?: Record<string, unknown>): void;
    finish(): void;
    bytes(): Uint8Array;
  };
}

declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  const factory: (options?: Record<string, unknown>) => any;
  export default factory;
}

declare module 'mammoth' {
  interface Result {
    value: string;
    messages: unknown[];
  }
  const mammoth: {
    convertToHtml(input: { arrayBuffer?: ArrayBuffer; buffer?: Uint8Array }): Promise<Result>;
    extractRawText(input: { arrayBuffer?: ArrayBuffer; buffer?: Uint8Array }): Promise<Result>;
  };
  export default mammoth;
}
