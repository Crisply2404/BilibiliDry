import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The online demo (GitHub Pages): the extension's real background and UI
 * code in ordinary web pages, with Bilibili and the model replaced by local
 * data (see demo/src). `DEMO_BASE` is the path the site is served under,
 * e.g. /BilibiliDry/ on GitHub Pages.
 */
const root = path.resolve(__dirname, 'demo');

export default defineConfig({
  root,
  base: process.env.DEMO_BASE ?? '/',
  // Never read .env.local: this bundle is published, and VITE_* values would be inlined into it.
  envDir: path.resolve(__dirname, 'scripts/release-env'),
  publicDir: path.resolve(root, 'public'),
  css: { postcss: __dirname },
  plugins: [react()],
  server: { port: 5199 },
  preview: { port: 5199 },
  build: {
    outDir: path.resolve(__dirname, 'dist-demo'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: path.resolve(root, 'index.html'),
        agent: path.resolve(root, 'video/BV1dryAgent1/index.html'),
        pork: path.resolve(root, 'video/BV1dryPork01/index.html'),
        dashboard: path.resolve(root, 'dashboard.html')
      }
    }
  }
});
