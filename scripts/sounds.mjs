import { readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sounds');
const exts = new Set(['.mp3', '.ogg', '.m4a', '.wav', '.webm', '.aac']);
const out = [];

for (const f of readdirSync(dir)) {
  if (f === 'manifest.json' || f.startsWith('.')) continue;
  const dot = f.lastIndexOf('.');
  if (dot === -1) continue;
  const ext = f.slice(dot).toLowerCase();
  if (!exts.has(ext)) continue;
  const id = f.slice(0, dot);
  out.push({ id, title: id.replace(/[-_]+/g, ' '), file: `/sounds/${encodeURIComponent(f)}` });
}

out.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(join(dir, 'manifest.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`manifest written: ${out.length} sound(s)`);
