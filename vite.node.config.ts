import { builtinModules } from 'node:module'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const file = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url))

const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map(module => `node:${module}`),
])

export default defineConfig({
  resolve: {
    alias: {
      '@minimal-web/host-apiproxy/protocol': file('./packages/host-apiproxy/src/protocol.ts'),
    },
  },
  build: {
    target: 'node22',
    outDir: 'lib',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    ssr: true,
    rollupOptions: {
      input: {
        'host-apiproxy': file('./packages/host-apiproxy/src/index.ts'),
        'host-webserver': file('./packages/host-webserver/src/index.ts'),
        'client-connection': file('./packages/client-connection/src/index.ts'),
        'client-modules': file('./packages/client-modules/src/index.ts'),
        'host-frontend-static-minimal': file('./packages/host-frontend-static-minimal/src/index.ts'),
      },
      external: source => nodeBuiltins.has(source)
        || source === 'ws'
        || source === 'zod'
        || source.startsWith('@deepseek-ai/'),
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
      preserveEntrySignatures: 'strict',
    },
  },
})
