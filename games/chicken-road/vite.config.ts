import { defineConfig } from 'vite';
export default defineConfig({ base: './', build: { target: ['es2019', 'safari14', 'chrome87'], assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 } });
