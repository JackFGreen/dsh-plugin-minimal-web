/**
 * Minimal Node HTTP carrier with exact HTTP and Upgrade route registries.
 *
 * @module @minimal-web/host-webserver
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** HTTP carrier used by minimal Host transport plugins. */
    webServer: WebServer
  }
}

/** One exact-path HTTP route. */
export interface WebRoute {
  /** Absolute URL pathname. */
  path: string
  /** Handler that owns the response. */
  handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>
}

/** One exact-path HTTP Upgrade route. */
export interface WebUpgradeRoute {
  /** Absolute URL pathname. */
  path: string
  /** Handler that owns protocol negotiation and the upgraded socket. */
  handler: (request: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
}

/** One HTTP fallback used when no exact route matches. */
export type WebFallback = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>

/** HTTP listen address. */
export interface Config {
  /** Loopback or all-interfaces bind host. */
  host: '127.0.0.1' | '0.0.0.0'
  /** TCP port; zero requests an OS-assigned port. */
  port: number
}

/** Cordis Service providing the minimal HTTP carrier as `ctx.webServer`. */
export class WebServer extends Service {
  static Config: z<Config> = z.object({
    host: z.union([z.const('127.0.0.1'), z.const('0.0.0.0')]).required(),
    port: z.natural().max(65535).required(),
  })

  private readonly routes = new Map<string, WebRoute>()
  private readonly upgrades = new Map<string, WebUpgradeRoute>()
  private fallback: WebFallback | undefined
  private readonly upgradedSockets = new Set<Duplex>()
  private server!: Server
  private listenedPort!: number

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'webServer')
  }

  /** Bound host from the service configuration. */
  get host(): Config['host'] {
    return this.config.host
  }

  /** Bound port, including the OS-assigned value when configured with zero. */
  get port(): number {
    return this.listenedPort
  }

  /**
   * Register one exact HTTP route.
   * @param route - Absolute pathname and response handler.
   * @returns An idempotent disposer for this registration.
   */
  register(route: WebRoute): () => void {
    this.assertPath(route.path)
    if (route.path === '/health' || this.routes.has(route.path)) {
      throw new Error(`minimal webserver: duplicate route "${route.path}"`)
    }
    this.routes.set(route.path, route)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.routes.get(route.path) === route) this.routes.delete(route.path)
    }
  }

  /**
   * Register one exact HTTP Upgrade route.
   * @param route - Absolute pathname and upgraded-socket handler.
   * @returns An idempotent disposer for this registration.
   */
  registerUpgrade(route: WebUpgradeRoute): () => void {
    this.assertPath(route.path)
    if (this.upgrades.has(route.path)) {
      throw new Error(`minimal webserver: duplicate upgrade route "${route.path}"`)
    }
    this.upgrades.set(route.path, route)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.upgrades.get(route.path) === route) this.upgrades.delete(route.path)
    }
  }

  /**
   * Register the single HTTP fallback.
   * @param handler - Handler used after exact-route lookup misses.
   * @returns An idempotent disposer for this registration.
   */
  registerFallback(handler: WebFallback): () => void {
    if (this.fallback !== undefined) throw new Error('minimal webserver: fallback is already registered')
    this.fallback = handler
    let active = true
    return () => {
      if (!active) return
      active = false
      this.fallback = undefined
    }
  }

  /** Start listening and register shutdown with the owning Cordis fiber. */
  async [Service.init](): Promise<void> {
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response).catch((error: unknown) => {
        this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        if (response.headersSent) {
          response.destroy()
          return
        }
        response.writeHead(500)
        response.end()
      })
    })
    this.server.on('upgrade', (request, socket, head) => {
      this.handleUpgrade(request, socket, head)
    })

    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.config.port, this.config.host, () => {
        this.server.off('error', reject)
        this.listenedPort = (this.server.address() as AddressInfo).port
        resolve()
      })
    })

    this.ctx.effect(() => async () => {
      const closed = new Promise<void>((resolve) => {
        this.server.close(() => { resolve() })
      })
      this.server.closeAllConnections()
      for (const socket of this.upgradedSockets) socket.destroy()
      await closed
    }, 'minimalWebServer.listen')

    const accessHost = this.config.host === '0.0.0.0' ? '127.0.0.1' : this.config.host
    process.stdout.write(`minimal web: http://${accessHost}:${String(this.listenedPort)}\n`)
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    if (pathname === '/health') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('ok')
      return
    }
    const route = this.routes.get(pathname)
    if (route === undefined) {
      if (this.fallback === undefined) {
        response.writeHead(404)
        response.end()
        return
      }
      await this.fallback(request, response)
      return
    }
    await route.handler(request, response)
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    socket.on('error', (error: Error) => {
      this.ctx.logger.warn(error)
      socket.destroy()
    })
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    const route = this.upgrades.get(pathname)
    if (route === undefined) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
      return
    }
    this.upgradedSockets.add(socket)
    socket.once('close', () => { this.upgradedSockets.delete(socket) })
    try {
      void Promise.resolve(route.handler(request, socket, head)).catch((error: unknown) => {
        this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
        socket.destroy()
      })
    } catch (error: unknown) {
      this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
      socket.destroy()
    }
  }

  private assertPath(path: string): void {
    if (!path.startsWith('/') || (path.length > 1 && path.endsWith('/'))) {
      throw new Error(`minimal webserver: invalid route path "${path}"`)
    }
  }
}

export default WebServer
