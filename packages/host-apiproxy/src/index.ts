/**
 * Minimal Host API service that owns browser-created Agent handles and emits
 * their durable session events to transport subscribers.
 *
 * @module @minimal-web/host-apiproxy
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import type {
  SessionCreateRequest,
  SessionCreateResponse,
  SessionEventFrame,
  SessionPromptRequest,
  SessionPromptResponse,
} from './protocol.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Minimal transport-independent API for browser-created Agent sessions. */
    apiProxy: MinimalApiProxy
  }
}

/** Model route assigned to every Agent created by this service instance. */
export interface Config {
  /** Registered LLM provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
}

/** Callback receiving one event frame synchronously after its session append. */
export type SessionEventListener = (frame: SessionEventFrame) => void

/** Transport-independent operations exposed by the minimal Host API. */
export interface MinimalApiProxy {
  /**
   * Create and own one Agent and its Session.
   * @param request - Working directory for the new Session.
   * @returns The opaque identity shared by the Agent and Session.
   * @throws when Agent creation fails or service teardown has begun.
   */
  createSession(request: SessionCreateRequest): Promise<SessionCreateResponse>

  /**
   * Submit one ordinary user follow-up to an owned Agent.
   * @param request - Target Session and non-blank text already validated at the wire.
   * @returns Confirmation after `Agent.followup()` accepts the message.
   * @throws when the Session is unknown, the Agent rejects the message, or teardown has begun.
   */
  prompt(request: SessionPromptRequest): Promise<SessionPromptResponse>

  /**
   * Subscribe to durable events from Sessions owned by this service.
   * Listener failures are logged and do not prevent later listeners from receiving the frame.
   * @param listener - Synchronous frame consumer.
   * @returns An idempotent disposer that removes the listener.
   * @throws when service teardown has begun.
   */
  subscribe(listener: SessionEventListener): () => void
}

/** Minimal Agent API implementation provided as `ctx.apiProxy`. */
export class MinimalApiProxyService extends Service implements MinimalApiProxy {
  static inject = ['agents', 'agentLoop']

  static Config: z<Config> = z.object({
    provider: z.string().required(),
    model: z.string().required(),
  })

  private readonly handles = new Map<SessionId, AgentHandle>()
  private readonly listeners = new Set<SessionEventListener>()
  private readonly creations = new Set<Promise<SessionCreateResponse>>()
  private closing = false

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'apiProxy')

    const stopEvents = ctx.on('session/event', (session, event) => {
      if (this.closing || !this.handles.has(session.id)) return
      this.publish({ type: 'session/event', sessionId: session.id, event })
    })

    ctx.effect(() => async () => {
      this.closing = true
      this.listeners.clear()
      stopEvents()
      await Promise.allSettled([...this.creations])
      const handles = [...this.handles.values()]
      this.handles.clear()
      await Promise.all(handles.map(handle => handle.dispose()))
    }, 'minimalApiProxy.ownership')
  }

  createSession(request: SessionCreateRequest): Promise<SessionCreateResponse> {
    this.assertActive()
    const creation = this.createOwnedSession(request)
    this.creations.add(creation)
    void creation.then(
      () => { this.creations.delete(creation) },
      () => { this.creations.delete(creation) },
    )
    return creation
  }

  async prompt(request: SessionPromptRequest): Promise<SessionPromptResponse> {
    this.assertActive()
    const handle = this.handles.get(request.sessionId)
    if (handle === undefined) {
      throw new Error(`minimal api proxy: session "${request.sessionId}" not found`)
    }
    handle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: request.text }],
      source: { kind: 'user' },
    }))
    return { accepted: true }
  }

  subscribe(listener: SessionEventListener): () => void {
    this.assertActive()
    this.listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
    }
  }

  private async createOwnedSession(request: SessionCreateRequest): Promise<SessionCreateResponse> {
    const sessionId = SessionId(randomUUID())
    const handle = await this.ctx.agents.create({
      sessionId,
      meta: { cwd: request.cwd },
      agentOptions: {
        provider: this.config.provider,
        model: this.config.model,
      },
    })
    if (this.closing) {
      await handle.dispose()
      throw new Error('minimal api proxy is closing')
    }
    this.handles.set(sessionId, handle)
    return { sessionId }
  }

  private publish(frame: SessionEventFrame): void {
    for (const listener of this.listeners) {
      try {
        listener(frame)
      } catch (error: unknown) {
        this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  private assertActive(): void {
    if (this.closing) throw new Error('minimal api proxy is closing')
  }
}

export default MinimalApiProxyService
