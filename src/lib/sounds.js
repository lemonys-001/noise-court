import { actx, decode } from './audio.js';
import { mulberry32, hashSeed, shuffle } from './rng.js';

let manifest = null;

export async function loadManifest() {
  if (manifest) return manifest;
  try {
    const r = await fetch('/sounds/manifest.json');
    manifest = await r.json();
    if (!Array.isArray(manifest)) manifest = [];
  } catch {
    manifest = [];
  }
  return manifest;
}

export function librarySounds() {
  return manifest || [];
}

export function hasSounds() {
  return (manifest || []).length > 0;
}

export function pickDeck(rand, count = 4) {
  return shuffle(librarySounds().map((s) => s.id), rand).slice(0, count);
}

export function dailyDeck(count = 4) {
  const day = new Date().toISOString().slice(0, 10); // UTC
  return pickDeck(mulberry32(hashSeed('noise-court/' + day)), count);
}

export async function getSoundBuffer(id) {
  const entry = manifest.find((s) => s.id === id);
  if (!entry) throw new Error('unknown sound ' + id);
  const res = await fetch(entry.file);
  if (!res.ok) throw new Error('sound not found: ' + entry.file);
  return await decode(await res.arrayBuffer());
}

export function soundTitle(id) {
  const e = manifest.find((s) => s.id === id);
  return e ? e.title : id;
}
