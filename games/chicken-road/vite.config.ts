import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// the vendored open-rgs contract is the single copy of @open-rgs/contract
const contract = fileURLToPath(new URL('../../vendor/open-rgs-core/contract/index.ts', import.meta.url));
export default defineConfig({
  base: './',
  resolve: { alias: { '@open-rgs/contract': contract } },
  build: { target: ['es2019', 'safari14', 'chrome87'], assetsInlineLimit: 0, chunkSizeWarningLimit: 2000 },
});
