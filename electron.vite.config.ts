import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main/index.ts') }
      }
    }
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: '.',
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: { index: resolve(__dirname, 'index.html') }
      }
    },
    plugins: [react()],
    resolve: {
      alias: { '@': resolve(__dirname, 'src') }
    },
    // Force-include Monaco in Vite's dep pre-bundling. Big one-time cost on
    // cold start (cached to node_modules/.vite/), but subsequent boots skip
    // per-language module transforms and are much snappier.
    optimizeDeps: {
      include: ['monaco-editor', '@monaco-editor/react']
    }
  }
})
