/**
 * Minimal browser connection service for session commands and event delivery.
 *
 * @module @minimal-web/client-connection/client
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import {
  parseWireJson,
  sessionCreateResponseSchema,
  sessionEventFrameSchema,
  sessionPromptResponseSchema,
} from '@minimal-web/host-apiproxy/protocol'
import type { SessionEventFrame } from '@minimal-web/host-apiproxy/protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

export type { SessionEventFrame } from '@minimal-web/host-apiproxy/protocol'
export type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Browser HTTP-up and WebSocket-down transport. */
    connection: Connection
  }
}

/** Current WebSocket connection state. */
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

/** Browser operations exposed to the minimal client runtime. */
export interface Connection {
  /** Current WebSocket state. */
  readonly status: ConnectionStatus

  /**
   * Create a Session rooted at one working directory.
   * @param cwd - Host working directory for the Session.
   * @returns The new opaque Session identity.
   */
  createSession(cwd: string): Promise<SessionId>

  /**
   * Send one text prompt to an existing Session.
   * @param sessionId - Target Session identity.
   * @param text - Non-blank user prompt.
   */
  prompt(sessionId: SessionId, text: string): Promise<void>

  /**
   * Subscribe to validated Session event frames.
   * @param listener - Synchronous event consumer.
   * @returns An idempotent disposer.
   */
  subscribe(listener: (frame: SessionEventFrame) => void): () => void
}

/** Browser implementation provided as `ctx.connection`. */
export class BrowserConnection extends Service implements Connection {
  private readonly listeners = new Set<(frame: SessionEventFrame) => void>()
  private socket!: WebSocket
  private currentStatus: ConnectionStatus = 'connecting'
  private closing = false

  constructor(ctx: Context) {
    super(ctx, 'connection')
  }

  /** Current WebSocket state. */
  get status(): ConnectionStatus {
    return this.currentStatus
  }

  /** Open the event downlink before publishing the service as active. */
  async [Service.init](): Promise<void> {
    const url = new URL('/api/events.mux', globalThis.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    this.socket = new WebSocket(url.href)
    this.socket.addEventListener('message', (event) => { this.receive(event) })
    this.socket.addEventListener('close', () => { this.currentStatus = 'disconnected' })

    this.ctx.effect(() => async () => {
      this.closing = true
      this.listeners.clear()
      this.currentStatus = 'disconnected'
      if (this.socket.readyState === WebSocket.CLOSED) return
      await new Promise<void>((resolve) => {
        this.socket.addEventListener('close', () => { resolve() }, { once: true })
        this.socket.close(1000, 'plugin unloaded')
      })
    }, 'minimalBrowserConnection.socket')

    await new Promise<void>((resolve, reject) => {
      const opened = (): void => {
        cleanup()
        this.currentStatus = 'connected'
        resolve()
      }
      const failed = (): void => {
        cleanup()
        this.currentStatus = 'disconnected'
        reject(new Error('minimal browser connection: WebSocket failed before opening'))
      }
      const cleanup = (): void => {
        this.socket.removeEventListener('open', opened)
        this.socket.removeEventListener('error', failed)
        this.socket.removeEventListener('close', failed)
      }
      this.socket.addEventListener('open', opened)
      this.socket.addEventListener('error', failed)
      this.socket.addEventListener('close', failed)
    })
  }

  async createSession(cwd: string): Promise<SessionId> {
    this.assertActive()
    const response = await this.post('/api/session.create', { cwd })
    return parseWireJson(response, sessionCreateResponseSchema).sessionId
  }

  async prompt(sessionId: SessionId, text: string): Promise<void> {
    this.assertActive()
    const response = await this.post('/api/session.prompt', { sessionId, text })
    parseWireJson(response, sessionPromptResponseSchema)
  }

  subscribe(listener: (frame: SessionEventFrame) => void): () => void {
    this.assertActive()
    this.listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
    }
  }

  private async post(path: string, body: unknown): Promise<string> {
    const response = await fetch(new URL(path, globalThis.location.href), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      throw new Error(`minimal browser connection: POST ${path} returned ${String(response.status)}`)
    }
    return response.text()
  }

  private receive(event: MessageEvent): void {
    if (typeof event.data !== 'string') {
      this.rejectEvent(new Error('minimal browser connection: expected a text WebSocket message'))
      return
    }
    let frame: SessionEventFrame
    try {
      frame = parseWireJson(event.data, sessionEventFrameSchema)
    } catch (error: unknown) {
      this.rejectEvent(error instanceof Error ? error : new Error(String(error)))
      return
    }
    for (const listener of this.listeners) {
      try {
        listener(frame)
      } catch (error: unknown) {
        this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  private rejectEvent(error: Error): void {
    this.ctx.logger.warn(error)
    this.socket.close(1007, 'invalid event')
  }

  private assertActive(): void {
    if (this.closing) throw new Error('minimal browser connection is closing')
  }
}

export default BrowserConnection
