import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base: the bundle works both at the domain root and under /fitbrain/ on GitHub Pages.
  base: './',
  plugins: [react()],
  server: { port: 5173, open: false },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: { output: { manualChunks: { react: ['react', 'react-dom'], chart: ['chart.js'], fitsdk: ['@garmin/fitsdk'] } } },
  },
});
