import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { buildManifest } from './scripts/sounds.mjs';

// Sounds in public/sounds/ are picked up automatically on every build/dev start.
const soundsManifest = () => ({
  name: 'sounds-manifest',
  buildStart() { buildManifest(); },
  configureServer() { buildManifest(); },
});

export default defineConfig({
  plugins: [react(), soundsManifest()],
  build: { outDir: 'dist', target: 'es2022' },
});
