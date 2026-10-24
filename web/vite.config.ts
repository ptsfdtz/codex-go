import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^crypto$/,
        replacement: fileURLToPath(new URL('./src/transport/browser-crypto.ts', import.meta.url)),
      },
    ],
  },
  build: { target: 'es2022' },
});
