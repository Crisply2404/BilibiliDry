import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

export default defineConfig(({ mode }) => {
    return {
      server: {
        port: 3000,
        strictPort: false,
        host: 'localhost',
        cors: true,
        hmr: {
          host: 'localhost'
        }
      },
      plugins: [react(), crx({ manifest })],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
