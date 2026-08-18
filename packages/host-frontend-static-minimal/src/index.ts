/**
 * Minimal Vite dist fallback for the Host WebServer.
 *
 * @module @minimal-web/host-frontend-static-minimal
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@minimal-web/host-webserver'
import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, dirname, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Stable Cordis plugin name. */
export const name = 'minimal-frontend-static'

/** Services required by the static fallback. */
export const inject = ['webServer']

/** Optional dist override, primarily for isolated tests. */
export interface Config {
  readonly root?: string
}

/** Register the Vite dist fallback. */
export function apply(ctx: Context, config: Config = {}): void {
  const root = resolve(config.root ?? defaultDistRoot())
  ctx.effect(() => ctx.webServer.registerFallback((request, response) => {
    return serve(root, request, response)
  }), 'minimalFrontendStatic.fallback')
}

async function serve(root: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' })
    response.end()
    return
  }
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
  const isStaticAsset = pathname.startsWith('/assets/') || pathname.startsWith('/plugins/')
  const requested = isStaticAsset ? safeResolve(root, pathname) : resolve(root, 'index.html')
  if (requested === undefined) {
    response.writeHead(404)
    response.end()
    return
  }
  try {
    const content = await readFile(requested)
    response.writeHead(200, {
      'content-type': contentType(requested),
      'content-length': String(content.byteLength),
    })
    response.end(request.method === 'HEAD' ? undefined : content)
  } catch (error: unknown) {
    if (isFileMissing(error)) {
      response.writeHead(404)
      response.end()
      return
    }
    throw error
  }
}

function safeResolve(root: string, pathname: string): string | undefined {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }
  const filename = resolve(root, `.${decoded}`)
  const child = relative(root, filename)
  if (child === '' || child === '..' || child.startsWith(`..${sep}`)) return undefined
  return filename
}

function contentType(filename: string): string {
  switch (extname(filename)) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    default: return 'application/octet-stream'
  }
}

function isFileMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error
    && (error.code === 'ENOENT' || error.code === 'EISDIR')
}

function defaultDistRoot(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url))
  const packageDirectory = basename(moduleDirectory) === 'src'
    ? dirname(moduleDirectory)
    : dirname(dirname(moduleDirectory))
  return resolve(packageDirectory, '../client-web/dist')
}

export default Object.assign(apply, { inject })
