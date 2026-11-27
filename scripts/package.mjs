// Zip dist/ for the Chrome Web Store / GitHub Releases, after checking no secret leaked in.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { findSecret } from './scan-secrets.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

const leaked = findSecret(dist);
if (leaked) {
  console.error(`Refusing to package: ${path.relative(root, leaked)} contains something that looks like an API key.`);
  process.exit(1);
}

const outDir = path.join(root, 'release');
mkdirSync(outDir, { recursive: true });
const zip = path.join(outDir, `bilibilidry-v${pkg.version}.zip`);
rmSync(zip, { force: true });
execFileSync('zip', ['-qr', zip, '.'], { cwd: dist, stdio: 'inherit' });
console.log(`Packaged ${path.relative(root, zip)}`);
