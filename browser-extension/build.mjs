import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, 'src');
const outDir = path.join(here, 'dist');

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const bundles = [
  ['service-worker.js', 'service-worker.js'],
  ['youtube-content.js', 'youtube-content.js'],
  ['popup.js', 'popup.js'],
];

for (const [input, output] of bundles) {
  await build({
    entryPoints: [path.join(srcDir, input)],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome120',
    outfile: path.join(outDir, output),
  });
}

for (const name of ['manifest.json', 'popup.html', 'popup.css']) {
  fs.copyFileSync(path.join(srcDir, name), path.join(outDir, name));
}
