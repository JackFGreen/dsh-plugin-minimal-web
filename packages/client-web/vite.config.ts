import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const file = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url))

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
    rollupOptions: {
      input: {
        app: file('./index.html'),
        'plugins/connection': file('../client-connection/src/client/index.ts'),
        'plugins/runtime': file('../client-runtime/src/index.ts'),
        'plugins/chat': file('../client-ui-minimal-chat/src/index.tsx'),
      },
      preserveEntrySignatures: 'exports-only',
      output: {
        entryFileNames: chunk => chunk.name.startsWith('plugins/') ? '[name].js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
