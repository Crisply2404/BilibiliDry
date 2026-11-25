// Zip dist/ for the Chrome Web Store / GitHub Releases, after checking no secret leaked in.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

const suspicious = /\b(sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,})/;
for (const f of files(dist)) {
  if (!/\.(js|html|json|css)$/.test(f)) continue;
  const m = readFileSync(f, 'utf8').match(suspicious);
  if (m) {
    console.error(`Refusing to package: ${path.relative(root, f)} contains something that looks like an API key.`);
    process.exit(1);
  }
}

const outDir = path.join(root, 'release');
mkdirSync(outDir, { recursive: true });
const zip = path.join(outDir, `bilibilidry-v${pkg.version}.zip`);
rmSync(zip, { force: true });
execFileSync('zip', ['-qr', zip, '.'], { cwd: dist, stdio: 'inherit' });
console.log(`Packaged ${path.relative(root, zip)}`);
