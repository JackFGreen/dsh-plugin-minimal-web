import { Context } from '@deepseek-ai/cordis'
import type { SessionEventFrame } from '@minimal-web/host-apiproxy/protocol'
import type { Connection } from '@minimal-web/client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MinimalSessions from '../src/index.ts'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

interface Composition {
  ctx: Context
  fiber: ReturnType<Context['plugin']>
  createSession: ReturnType<typeof vi.fn<Connection['createSession']>>
  prompt: ReturnType<typeof vi.fn<Connection['prompt']>>
  publish(frame: SessionEventFrame): void
  listenerCount(): number
}

async function compose(): Promise<Composition> {
  const ctx = new Context()
  context = ctx
  const eventListeners = new Set<(frame: SessionEventFrame) => void>()
  const createSession = vi.fn<Connection['createSession']>().mockResolvedValue('session-1' as SessionId)
  const prompt = vi.fn<Connection['prompt']>().mockResolvedValue(undefined)
  ctx.provide('connection', {
    status: 'connected',
    createSession,
    prompt,
    subscribe(listener) {
      eventListeners.add(listener)
      return () => { eventListeners.delete(listener) }
    },
  })
  const fiber = ctx.plugin(MinimalSessions)
  await fiber
  return {
    ctx,
    fiber,
    createSession,
    prompt,
    publish(frame) {
      for (const listener of eventListeners) listener(frame)
    },
    listenerCount: () => eventListeners.size,
  }
}

function frame(sessionId: string, event: SessionEventFrame['event']): SessionEventFrame {
  return { type: 'session/event', sessionId: sessionId as SessionId, event }
}

describe('MinimalSessions', () => {
  it('creates one Session and sends through the connection', async () => {
    const test = await compose()
    const snapshots: unknown[] = []
    test.ctx.sessions.subscribe(() => { snapshots.push(test.ctx.sessions.getSnapshot()) })

    await test.ctx.sessions.start('/workspace')
    expect(test.createSession).toHaveBeenCalledWith('/workspace')
    expect(test.ctx.sessions.getSnapshot()).toEqual({
      sessionId: 'session-1',
      status: 'ready',
      userText: '',
      assistantText: '',
    })

    await test.ctx.sessions.send('hello')
    expect(test.prompt).toHaveBeenCalledWith('session-1', 'hello')
    expect(test.ctx.sessions.getSnapshot()).toEqual({
      sessionId: 'session-1',
      status: 'running',
      userText: 'hello',
      assistantText: '',
    })
    expect(snapshots).toHaveLength(3)
  })

  it('folds only the active Session text deltas and completes the turn', async () => {
    const test = await compose()
    await test.ctx.sessions.start('/workspace')
    await test.ctx.sessions.send('hello')

    test.publish(frame('other', {
      type: 'assistant/chunk',
      seq: 1,
      time: 1,
      data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'ignored' } },
    }))
    test.publish(frame('session-1', {
      type: 'assistant/chunk',
      seq: 2,
      time: 2,
      data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'hel' } },
    }))
    test.publish(frame('session-1', {
      type: 'assistant/chunk',
      seq: 3,
      time: 3,
      data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'lo' } },
    }))
    test.publish(frame('session-1', {
      type: 'turn/end',
      seq: 4,
      time: 4,
      data: { turn: 1, reason: { kind: 'completed' } },
    }))

    expect(test.ctx.sessions.getSnapshot()).toEqual({
      sessionId: 'session-1',
      status: 'ready',
      userText: 'hello',
      assistantText: 'hello',
    })
  })

  it('publishes request failures and unsubscribes on unload', async () => {
    const test = await compose()
    test.createSession.mockRejectedValueOnce(new Error('create failed'))
    await expect(test.ctx.sessions.start('/workspace')).rejects.toThrow('create failed')
    expect(test.ctx.sessions.getSnapshot()).toEqual({
      status: 'error',
      userText: '',
      assistantText: '',
      error: 'create failed',
    })

    expect(test.listenerCount()).toBe(1)
    const sessions = test.ctx.sessions
    await test.fiber.dispose()
    expect(test.listenerCount()).toBe(0)
    expect(() => sessions.subscribe(() => undefined)).toThrow(/closing/)
  })
})
