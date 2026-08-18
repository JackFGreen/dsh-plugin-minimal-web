/** Minimal native-ESM browser plugin loader. */

import type { Context } from '@deepseek-ai/cordis'
import type { BootEntry, BootManifest } from '../manifest.ts'

type CordisPlugin = Parameters<Context['plugin']>[0]

/** Read and validate one Host-provided boot manifest. */
export function parseBootManifest(wire: unknown): BootManifest {
  if (typeof wire !== 'object' || wire === null) {
    throw new Error('minimal client modules: window.__DSH_BOOT__ is missing')
  }
  const candidate = wire as Record<string, unknown>
  if (typeof candidate.cwd !== 'string' || candidate.cwd.length === 0) {
    throw new Error('minimal client modules: cwd must be a non-empty string')
  }
  if (!Array.isArray(candidate.entries)) {
    throw new Error('minimal client modules: entries must be an array')
  }
  const ids = new Set<string>()
  const entries: BootEntry[] = candidate.entries.map((value, index) => {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`minimal client modules: entry ${String(index)} must be an object`)
    }
    const entry = value as Record<string, unknown>
    if (typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new Error(`minimal client modules: entry ${String(index)} has an invalid id`)
    }
    if (ids.has(entry.id)) throw new Error(`minimal client modules: duplicate entry "${entry.id}"`)
    if (typeof entry.url !== 'string' || !entry.url.startsWith('/')) {
      throw new Error(`minimal client modules: entry "${entry.id}" has an invalid url`)
    }
    ids.add(entry.id)
    return { id: entry.id, url: entry.url }
  })
  return { cwd: candidate.cwd, entries }
}

/** Read the manifest installed by `/boot.js`. */
export function readBootManifest(): BootManifest {
  return parseBootManifest((globalThis as typeof globalThis & { __DSH_BOOT__?: unknown }).__DSH_BOOT__)
}

/** Import and activate every browser plugin in manifest order. */
export async function loadClientPlugins(ctx: Context, manifest: BootManifest): Promise<void> {
  for (const entry of manifest.entries) {
    const loaded: unknown = await import(/* @vite-ignore */ entry.url)
    const module = loaded as { default?: unknown }
    const plugin = (module.default ?? loaded) as CordisPlugin
    await ctx.plugin(plugin)
  }
}

export type { BootEntry, BootManifest } from '../manifest.ts'
