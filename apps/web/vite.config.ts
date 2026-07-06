import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiProxy = {
  '/api': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
};

export default defineConfig({
  // Served at the domain root in dev/preview; the GitHub Pages build passes
  // VITE_BASE=/<repo>/app/ so the embedded demo resolves its assets correctly.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: { proxy: apiProxy },
  // `vite preview` serves the production build with no HMR — used by the
  // screenshot harness so the page never enters an HMR reload loop.
  preview: { proxy: apiProxy },
  // tldraw's asset imports use `?url` suffixes that Vite's dep optimizer
  // doesn't resolve, leaving the URLs undefined at runtime. Skip pre-bundling
  // for these so they hit the regular asset pipeline.
  optimizeDeps: {
    exclude: ['@tldraw/assets/imports.vite', '@tldraw/assets'],
  },
});
