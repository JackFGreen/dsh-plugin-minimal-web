/**
 * Minimal single-session browser state runtime.
 *
 * @module @minimal-web/client-runtime
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEventFrame, SessionId } from '@minimal-web/client-connection/client'

/** Lifecycle state exposed to the minimal chat UI. */
export type ChatStatus = 'starting' | 'ready' | 'running' | 'error'

/** Immutable snapshot of the one active chat Session. */
export interface ChatState {
  readonly sessionId?: SessionId
  readonly status: ChatStatus
  readonly userText: string
  readonly assistantText: string
  readonly error?: string
}

/** Single-session commands and observable state consumed by the UI. */
export interface Sessions {
  getSnapshot(): ChatState
  subscribe(listener: () => void): () => void
  start(cwd: string): Promise<void>
  send(text: string): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Minimal single-session browser state. */
    sessions: Sessions
  }
}

/** Services required by the browser runtime. */
export const inject = ['connection']

/** Browser runtime provided as `ctx.sessions`. */
export class MinimalSessions extends Service implements Sessions {
  static inject = inject

  private readonly listeners = new Set<() => void>()
  private state: ChatState = {
    status: 'starting',
    userText: '',
    assistantText: '',
  }
  private closing = false

  constructor(ctx: Context) {
    super(ctx, 'sessions')
  }

  /** Subscribe to the connection before the service becomes active. */
  [Service.init](): void {
    const unsubscribe = this.ctx.connection.subscribe((frame) => { this.receive(frame) })
    this.ctx.effect(() => () => {
      this.closing = true
      unsubscribe()
      this.listeners.clear()
    }, 'minimalSessions.connection')
  }

  getSnapshot(): ChatState {
    return this.state
  }

  subscribe(listener: () => void): () => void {
    this.assertActive()
    this.listeners.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
    }
  }

  async start(cwd: string): Promise<void> {
    this.assertActive()
    this.publish({ status: 'starting', userText: '', assistantText: '' })
    try {
      const sessionId = await this.ctx.connection.createSession(cwd)
      this.assertActive()
      this.publish({ sessionId, status: 'ready', userText: '', assistantText: '' })
    } catch (error: unknown) {
      if (!this.closing) this.fail(error)
      throw error
    }
  }

  async send(text: string): Promise<void> {
    this.assertActive()
    const { sessionId } = this.state
    if (sessionId === undefined) throw new Error('minimal client runtime: Session has not started')
    this.publish({ sessionId, status: 'running', userText: text, assistantText: '' })
    try {
      await this.ctx.connection.prompt(sessionId, text)
    } catch (error: unknown) {
      if (!this.closing) this.fail(error)
      throw error
    }
  }

  private receive(frame: SessionEventFrame): void {
    if (this.closing || frame.sessionId !== this.state.sessionId) return
    const { event } = frame
    if (event.type === 'assistant/chunk' && event.data.chunk.type === 'text-delta') {
      this.publish({
        ...this.state,
        assistantText: this.state.assistantText + event.data.chunk.text,
      })
      return
    }
    if (event.type === 'turn/end') this.publish({ ...this.state, status: 'ready' })
  }

  private fail(error: unknown): void {
    this.publish({
      ...this.state,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    })
  }

  private publish(state: ChatState): void {
    this.state = state
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error: unknown) {
        this.ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  private assertActive(): void {
    if (this.closing) throw new Error('minimal client runtime is closing')
  }
}

export default MinimalSessions
