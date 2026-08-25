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

/** One ordered item rendered by the minimal process timeline. */
export type TimelineItem =
  | { readonly id: string; readonly type: 'user'; readonly text: string }
  | { readonly id: string; readonly type: 'turn'; readonly turn: number; readonly status: 'running' | 'completed'; readonly reason?: string }
  | { readonly id: string; readonly type: 'step'; readonly turn: number; readonly step: number; readonly status: 'running' | 'completed' }
  | { readonly id: string; readonly type: 'reasoning'; readonly turn: number; readonly step: number; readonly text: string }
  | { readonly id: string; readonly type: 'assistant'; readonly turn: number; readonly step: number; readonly text: string }
  | {
    readonly id: string
    readonly type: 'tool'
    readonly turn: number
    readonly step: number
    readonly callId: string
    readonly name: string
    readonly arguments: string
    readonly status: 'running' | 'completed' | 'error'
    readonly result?: string
    readonly error?: string
  }

/** Immutable snapshot of the one active chat Session. */
export interface ChatState {
  readonly sessionId?: SessionId
  readonly status: ChatStatus
  readonly timeline: readonly TimelineItem[]
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
    timeline: [],
  }
  private nextUserId = 0
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
    this.nextUserId = 0
    this.publish({ status: 'starting', timeline: [] })
    try {
      const sessionId = await this.ctx.connection.createSession(cwd)
      this.assertActive()
      this.publish({ sessionId, status: 'ready', timeline: [] })
    } catch (error: unknown) {
      if (!this.closing) this.fail(error)
      throw error
    }
  }

  async send(text: string): Promise<void> {
    this.assertActive()
    const { sessionId } = this.state
    if (sessionId === undefined) throw new Error('minimal client runtime: Session has not started')
    this.nextUserId += 1
    const { error: _error, ...state } = this.state
    this.publish({
      ...state,
      status: 'running',
      timeline: [...this.state.timeline, { id: `user:${this.nextUserId}`, type: 'user', text }],
    })
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
    switch (event.type) {
      case 'turn/start':
        this.upsert({
          id: `turn:${event.data.turn}`,
          type: 'turn',
          turn: event.data.turn,
          status: 'running',
        })
        return
      case 'turn/end': {
        const error = event.data.reason.kind === 'error'
          ? `${event.data.reason.error.code}: ${event.data.reason.error.message}`
          : undefined
        this.upsert({
          id: `turn:${event.data.turn}`,
          type: 'turn',
          turn: event.data.turn,
          status: 'completed',
          reason: event.data.reason.kind,
        }, error === undefined ? 'ready' : 'error', error)
        return
      }
      case 'step/start':
        this.upsert({
          id: `step:${event.data.turn}:${event.data.step}`,
          type: 'step',
          turn: event.data.turn,
          step: event.data.step,
          status: 'running',
        })
        return
      case 'step/end':
        this.upsert({
          id: `step:${event.data.turn}:${event.data.step}`,
          type: 'step',
          turn: event.data.turn,
          step: event.data.step,
          status: 'completed',
        })
        return
      case 'assistant/chunk': {
        const { chunk } = event.data
        if (chunk.type !== 'reasoning-delta' && chunk.type !== 'text-delta') return
        if (chunk.text.length === 0) return
        const type = chunk.type === 'reasoning-delta' ? 'reasoning' : 'assistant'
        this.appendText({
          id: `${type}:${event.data.turn}:${event.data.step}:${chunk.index}`,
          type,
          turn: event.data.turn,
          step: event.data.step,
        }, chunk.text)
        return
      }
      case 'tool/call':
        this.upsert({
          id: toolId(event.data.turn, event.data.callId),
          type: 'tool',
          turn: event.data.turn,
          step: event.data.step,
          callId: event.data.callId,
          name: event.data.name,
          arguments: event.data.arguments,
          status: 'running',
        })
        return
      case 'tool/result': {
        const block = event.data.message.content[0]
        const id = toolId(event.data.turn, block.toolCallId)
        const previous = this.state.timeline.find(
          (item): item is Extract<TimelineItem, { type: 'tool' }> => item.id === id && item.type === 'tool',
        )
        const failed = block.isError === true || event.data.error !== undefined
        this.upsert({
          id,
          type: 'tool',
          turn: event.data.turn,
          step: event.data.step,
          callId: block.toolCallId,
          name: previous?.name ?? 'unknown',
          arguments: previous?.arguments ?? '',
          status: failed ? 'error' : 'completed',
          result: renderContent(block.content),
          ...event.data.error === undefined
            ? {}
            : { error: `${event.data.error.name}: ${event.data.error.code}` },
        })
        return
      }
    }
  }

  private appendText(
    item: Omit<Extract<TimelineItem, { type: 'reasoning' | 'assistant' }>, 'text'>,
    text: string,
  ): void {
    const previous = this.state.timeline.find(current => current.id === item.id)
    this.upsert({ ...item, text: previous?.type === item.type ? previous.text + text : text } as TimelineItem)
  }

  private upsert(
    item: TimelineItem,
    status: ChatStatus = this.state.status,
    error: string | undefined = this.state.error,
  ): void {
    const index = this.state.timeline.findIndex(current => current.id === item.id)
    const timeline = index < 0
      ? [...this.state.timeline, item]
      : this.state.timeline.map((current, currentIndex) => currentIndex === index ? item : current)
    const { error: _error, ...state } = this.state
    this.publish({
      ...state,
      status,
      timeline,
      ...(error === undefined ? {} : { error }),
    })
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

function toolId(turn: number, callId: string): string {
  return `tool:${turn}:${callId}`
}

function renderContent(content: readonly unknown[]): string {
  return content.map((block) => {
    if (typeof block === 'object' && block !== null && 'type' in block) {
      if (block.type === 'text' && 'text' in block && typeof block.text === 'string') return block.text
      if (block.type === 'reasoning' && 'text' in block && typeof block.text === 'string') return block.text
      if (block.type === 'image') return '[image]'
    }
    return JSON.stringify(block, null, 2)
  }).join('\n')
}

export default MinimalSessions
