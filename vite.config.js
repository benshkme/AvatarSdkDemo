import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: {
    include: ['@breezystack/lamejs'],
  },
  build: {
    target: 'es2020',
  },
});
