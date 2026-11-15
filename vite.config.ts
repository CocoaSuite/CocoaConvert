import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [preact()],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  build: {
    target: 'es2022',
    sourcemap: false,
    // FFmpeg, pdf.js, HEIC and AVIF codecs are large but only load when a file needs them.
    chunkSizeWarningLimit: 2500,
    assetsInlineLimit: 0,
  },
  server: { proxy: { '/api': 'http://localhost:8080' } },
  preview: { proxy: { '/api': 'http://localhost:8080' } },
});
