// Embeds data/hooks.json into the page so the host only needs one file.
// Run: node scripts/build-single.mjs [outDir]
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.resolve(process.argv[2] || path.join(root, '..', 'smart-site'));
let html = await readFile(path.join(root, 'site', 'index.html'), 'utf8');
const data = await readFile(path.join(root, 'data', 'hooks.json'), 'utf8');
const marker = / {2}<script>\r?\n {4}\/\/ ===== Settings/; // the file may have Windows line endings
if (!marker.test(html)) throw new Error('settings script not found in index.html');
html = html.replace(marker, (m) => `  <script>window.SMART_DATA = ${data.replace(/<\/script/gi, '<\\/script')};</script>\n${m}`);
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'index.html'), html);
for (const img of ['avatar.png', 'x-header.png']) await copyFile(path.join(root, 'site', img), path.join(outDir, img)).catch(() => {});
console.log(`wrote ${path.join(outDir, 'index.html')} (${(html.length / 1024).toFixed(0)} KB)`);
