/**
 * Host route that exposes the fixed minimal browser boot manifest.
 *
 * @module @minimal-web/client-modules
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@minimal-web/host-webserver'
import { CLIENT_ENTRIES } from './manifest.ts'
import type { BootManifest } from './manifest.ts'

export type { BootEntry, BootManifest } from './manifest.ts'
export { CLIENT_ENTRIES } from './manifest.ts'

/** Stable Cordis plugin name. */
export const name = 'minimal-client-modules'

/** Host services required to expose the manifest script. */
export const inject = ['webServer']

/** Register the fixed `/boot.js` script before the static fallback. */
export function apply(ctx: Context): void {
  const manifest: BootManifest = { cwd: process.cwd(), entries: CLIENT_ENTRIES }
  const json = JSON.stringify(manifest).replaceAll('<', '\\u003c')
  const script = `globalThis.__DSH_BOOT__=${json};\n`
  ctx.effect(() => ctx.webServer.register({
    path: '/boot.js',
    handler: (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { allow: 'GET, HEAD' })
        response.end()
        return
      }
      response.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'content-length': String(Buffer.byteLength(script)),
        'cache-control': 'no-store',
      })
      response.end(request.method === 'HEAD' ? undefined : script)
    },
  }), 'minimalClientModules.bootScript')
}

export default Object.assign(apply, { inject })
