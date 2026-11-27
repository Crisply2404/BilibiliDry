// Fail if a build output directory contains anything that looks like an API key.
//   node scripts/scan-secrets.mjs <dir>
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const suspicious = /\b(sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,})/;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

/** Returns the first file that looks like it contains a key, or null. */
export function findSecret(dir) {
  for (const f of files(dir)) {
    if (!/\.(js|html|json|css|map)$/.test(f)) continue;
    if (suspicious.test(readFileSync(f, 'utf8'))) return f;
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = path.resolve(process.argv[2] ?? 'dist');
  const hit = findSecret(dir);
  if (hit) {
    console.error(`Refusing to publish: ${path.relative(process.cwd(), hit)} contains something that looks like an API key.`);
    process.exit(1);
  }
  console.log(`No API keys found in ${path.relative(process.cwd(), dir) || dir}`);
}
