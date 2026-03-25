import { defineConfig } from 'vite';

export default defineConfig({
  // lamejs is a CommonJS module; make Vite pre-bundle it properly
  optimizeDeps: {
    include: ['lamejs'],
  },
  build: {
    target: 'es2020',
  },
});
