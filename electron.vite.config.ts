import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { contentSecurityPolicy } from './scripts/csp';
import { thirdPartyLicenses } from './scripts/third-party-licenses';

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: resolve('src/main/index.ts') } },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    build: {
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } },
      // Never inline assets as data: URLs; the CSP only allows the app's own files (fonts included).
      assetsInlineLimit: 0,
    },
    plugins: [react(), contentSecurityPolicy(), thirdPartyLicenses()],
  },
});
