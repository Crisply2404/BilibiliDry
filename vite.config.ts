import path from 'path';
import net from 'node:net';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

function canListen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findFreePort(startPort: number, host: string): Promise<number> {
  const start = Number.isFinite(startPort) ? startPort : 3000;
  for (let i = 0; i < 50; i += 1) {
    const port = start + i;
    // eslint-disable-next-line no-await-in-loop
    if (await canListen(port, host)) return port;
  }
  throw new Error(`No free port found from ${start} (host=${host})`);
}

export default defineConfig(async () => {
  // Use IPv4 loopback to avoid localhost IPv4/IPv6 port-occupation edge cases on Windows.
  const host = '127.0.0.1';
  const port = await findFreePort(Number(process.env.PORT ?? 3000), host);

  return {
    server: {
      port,
      strictPort: true,
      host,
      cors: true,
      hmr: {
        host,
        port,
        clientPort: port,
        overlay: false
      }
    },
    build: {
      rollupOptions: {
        input: {
          popup: path.resolve(__dirname, 'index.html'),
          options: path.resolve(__dirname, 'options.html'),
          dashboard: path.resolve(__dirname, 'dashboard.html')
        }
      }
    },
    plugins: [react(), crx({ manifest })],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.')
      }
    }
  };
});
