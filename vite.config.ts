import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
  // Prevent Vite from clearing the console so Rust / Tauri logs stay visible
  clearScreen: false,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    // Let the server accept connections while deps finish; safe here because `include` pins the hot path.
    holdUntilCrawlEnd: false,
    // Pre-bundle the critical graph up front so Tauri’s `beforeDevCommand` / first webview load does not
    // wait on a full crawl + surprise bundles (symptom: DevTools stuck on about:blank / “(no domain)” for minutes).
    include: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      'react-router-dom',
      'lucide-react',
      'zustand',
      'clsx',
      'tailwind-merge',
    ],
    // Heavy ML stacks: keep excluded so they only load with ONNX / workers / Pyodide (dynamic imports).
    // Do NOT exclude lucide-react (critical path; excluding defers a huge first-request esbuild).
    exclude: [
      'pyodide',
      '@huggingface/transformers',
      'kokoro-js',
      'onnxruntime-web',
      'onnxruntime-node',
    ],
  },
  worker: {
    format: 'es',
  },
  define: {
    'import.meta.env.allowLocalModels': true,
    'import.meta.env.allowRemoteModels': true,
    'import.meta.env.useBrowserCache': true,
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
    // Pre-transform the entry graph during `vite`/Tauri startup so the first paint after localhost loads is faster.
    warmup: {
      clientFiles: [
        './index.html',
        './src/main.tsx',
        './src/App.tsx',
        './src/components/Sidebar.tsx',
        './src/components/Landing.tsx',
      ],
    },
  },
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === 'windows'
        ? 'chrome105'
        : 'safari13',
    minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
