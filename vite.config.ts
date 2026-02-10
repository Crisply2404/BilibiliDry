import path from 'path';
import net from 'node:net';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

type ListenResult = 'free' | 'in-use' | 'no-address';

function parsePort(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i <= 0 || i > 65535) return null;
  return i;
}

function parseOffset(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const v = value.trim();
  if (!v) return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

function canListen(port: number, host: string): Promise<ListenResult> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (err: any) => {
      const code = String(err?.code ?? '');
      if (code === 'EADDRNOTAVAIL') resolve('no-address');
      else resolve('in-use');
    });
    server.listen(port, host, () => {
      server.close(() => resolve('free'));
    });
  });
}

async function isPortFreeForLocalhost(port: number): Promise<boolean> {
  // CRXJS dev loader always uses `http://localhost:<port>`; on Windows this may resolve to IPv4 or IPv6.
  // To avoid “port looks free but localhost points elsewhere”, require the port to be free on both.
  const ipv4 = await canListen(port, '127.0.0.1');
  if (ipv4 !== 'free') return false;
  const ipv6 = await canListen(port, '::1');
  return ipv6 === 'free' || ipv6 === 'no-address';
}

async function findFreePort(startPort: number): Promise<number> {
  const start = Number.isFinite(startPort) ? startPort : 3000;
  for (let i = 0; i < 50; i += 1) {
    const port = start + i;
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFreeForLocalhost(port)) return port;
  }
  throw new Error(`No free port found from ${start} (localhost)`);
}

export default defineConfig(async () => {
  const env = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), '');

  // CRXJS dev loader runs inside Chrome extension pages/service worker.
  // On Windows, `localhost` may resolve to IPv4 or IPv6 depending on the client.
  // If we bind the dev server to only one family (e.g. ::1 or 127.0.0.1), Chrome may fail to connect.
  // Prefer binding to IPv6 unspecified (`::`) to (usually) enable dual-stack so both IPv4/IPv6 localhost can reach it.
  // If the machine doesn't support IPv6, fall back to IPv4 loopback.
  const ipv6Probe = await canListen(0, '::1');
  const host = ipv6Probe === 'no-address' ? '127.0.0.1' : '::';
  const basePort = parsePort(env.PORT) ?? parsePort(process.env.PORT) ?? 3000;
  const offset = parseOffset(env.PORT_OFFSET ?? env.VITE_PORT_OFFSET) || parseOffset(process.env.PORT_OFFSET ?? process.env.VITE_PORT_OFFSET);
  const startPort = basePort + offset;
  const port = await findFreePort(startPort);

  return {
    server: {
      port,
      strictPort: true,
      host,
      cors: true,
      origin: `http://localhost:${port}`,
      headers: {
        // MV3 service worker/content scripts load dev modules from `http://localhost:<port>` and require CORS headers.
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': '*'
      },
      hmr: {
        host: 'localhost',
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
