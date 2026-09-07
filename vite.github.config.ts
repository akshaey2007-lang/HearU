import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => ({
  root: path.join(rootDirectory, 'github-pages'),
  base: mode === 'android' ? '/HearU/_android/' : '/HearU/',
  publicDir: path.join(rootDirectory, 'public'),
  resolve: {
    alias: {
      '@': rootDirectory,
    },
  },
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react()],
  build: {
    outDir: path.join(rootDirectory, mode === 'android' ? 'dist-android' : 'dist-github'),
    emptyOutDir: true,
    ...(mode === 'android' ? { rolldownOptions: { input: path.join(rootDirectory, 'github-pages/android.html') } } : {}),
  },
}));
