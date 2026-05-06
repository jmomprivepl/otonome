/// <reference types="vitest/config" />
import { defineConfig, mergeConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';

const host = process.env.TAURI_DEV_HOST;

export default mergeConfig(
  defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    optimizeDeps: {
      holdUntilCrawlEnd: false,
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
      exclude: [
        'pyodide',
        '@huggingface/transformers',
        'kokoro-js',
        'onnxruntime-web',
        'onnxruntime-node',
      ],
    },
    worker: { format: 'es' },
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
        ? { protocol: 'ws', host, port: 1421 }
        : undefined,
      watch: { ignored: ['**/src-tauri/**'] },
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
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      passWithNoTests: false,
    },
  }),
  defineConfig({
    clearScreen: false,
  }),
);
