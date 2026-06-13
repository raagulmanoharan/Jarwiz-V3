import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiProxy = {
  '/api': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react()],
  server: { proxy: apiProxy },
  // `vite preview` serves the production build with no HMR — used by the
  // screenshot harness so the page never enters an HMR reload loop.
  preview: { proxy: apiProxy },
});
