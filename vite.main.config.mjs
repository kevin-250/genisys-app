import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  // Lets the packaged app notice when its own source changed after this build (code-change toast).
  define: {
    __PROJECT_DIR__: JSON.stringify(process.cwd()),
    __BUILD_TIME__: JSON.stringify(Date.now()),
  },
  build: { rollupOptions: { external: ['node:sqlite'] } },
});
