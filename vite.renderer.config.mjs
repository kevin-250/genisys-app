import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config
// JSX (the React input bar, src/ui) is compiled by esbuild; no React Refresh plugin: its inline preamble is blocked by the CSP.
export default defineConfig({
  plugins: [tailwindcss()],
  esbuild: { jsx: 'automatic' },
});
