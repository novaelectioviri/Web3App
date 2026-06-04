import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          tonconnect: ['@tonconnect/ui'],
          toncore: ['@ton/core'],
        },
      },
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
