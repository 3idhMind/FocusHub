import path from 'path';
import { defineConfig } from 'vite';

/**
 * Vite Config — FocusHub (Vanilla JS, no frameworks)
 * No React, no Tailwind plugins — this is a pure HTML/CSS/JS project.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    hmr: process.env.DISABLE_HMR !== 'true',
  },
});
