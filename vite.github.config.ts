import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(rootDirectory, 'github-pages'),
  base: '/HearU/',
  publicDir: path.join(rootDirectory, 'public'),
  resolve: {
    alias: {
      '@': rootDirectory,
    },
  },
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react()],
  build: {
    outDir: path.join(rootDirectory, 'dist-github'),
    emptyOutDir: true,
  },
});
