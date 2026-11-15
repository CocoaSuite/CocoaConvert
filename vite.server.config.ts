import { defineConfig } from 'vite';

/** Bundles the optional conversion server into dist-server/index.js. */
export default defineConfig({
  build: {
    ssr: 'server/index.ts',
    outDir: 'dist-server',
    target: 'node20',
    emptyOutDir: true,
    sourcemap: false,
  },
  publicDir: false,
});
