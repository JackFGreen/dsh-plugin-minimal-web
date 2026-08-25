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
      timeline: [],
    })

    await test.ctx.sessions.send('hello')
    expect(test.prompt).toHaveBeenCalledWith('session-1', 'hello')
    expect(test.ctx.sessions.getSnapshot()).toEqual({
      sessionId: 'session-1',
      status: 'running',
      timeline: [{ id: 'user:1', type: 'user', text: 'hello' }],
    })
    expect(snapshots).toHaveLength(3)
  })

  it('folds the active Session process into one ordered timeline', async () => {
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
      type: 'turn/start',
      seq: 2,
      time: 2,
      data: { turn: 1 },
    }))
    test.publish(frame('session-1', {
      type: 'step/start',
      seq: 3,
      time: 3,
      data: { turn: 1, step: 1 },
    }))
    test.publish(frame('session-1', {
      type: 'assistant/chunk',
      seq: 4,
      time: 4,
      data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'think' } },
    }))
    test.publish(frame('session-1', {
      type: 'assistant/chunk',
      seq: 5,
      time: 5,
      data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'ing' } },
    }))
    test.publish(frame('session-1', {
      type: 'tool/call',
      seq: 6,
      time: 6,
      data: { turn: 1, step: 1, callId: 'call-1' as never, name: 'echo', arguments: '{"text":"hello"}' },
    }))
    test.publish(frame('session-1', {
      type: 'tool/result',
      seq: 7,
      time: 7,
      data: {
        turn: 1,
        step: 1,
        message: {
          id: 'message-1' as never,
          role: 'user',
          source: { kind: 'tool', callId: 'call-1' as never },
          content: [{
            type: 'tool-result',
            toolCallId: 'call-1' as never,
            content: [{ type: 'text', text: 'echo: hello' }],
          }],
        },
      },
    }))
    test.publish(frame('session-1', {
      type: 'step/end',
      seq: 8,
      time: 8,
      data: { turn: 1, step: 1 },
    }))
    test.publish(frame('session-1', {
      type: 'step/start',
      seq: 9,
      time: 9,
      data: { turn: 1, step: 2 },
    }))
    test.publish(frame('session-1', {
      type: 'assistant/chunk',
      seq: 10,
      time: 10,
      data: { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: 'hel' } },
    }))
    test.publish(frame('session-1', {
      type: 'assistant/chunk',
      seq: 11,
      time: 11,
      data: { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: 'lo' } },
    }))
    test.publish(frame('session-1', {
      type: 'step/end',
      seq: 12,
      time: 12,
      data: { turn: 1, step: 2 },
    }))
    test.publish(frame('session-1', {
      type: 'turn/end',
      seq: 13,
      time: 13,
      data: { turn: 1, reason: { kind: 'completed' } },
    }))

    expect(test.ctx.sessions.getSnapshot()).toEqual({
      sessionId: 'session-1',
      status: 'ready',
      timeline: [
        { id: 'user:1', type: 'user', text: 'hello' },
        { id: 'turn:1', type: 'turn', turn: 1, status: 'completed', reason: 'completed' },
        { id: 'step:1:1', type: 'step', turn: 1, step: 1, status: 'completed' },
        { id: 'reasoning:1:1:0', type: 'reasoning', turn: 1, step: 1, text: 'thinking' },
        {
          id: 'tool:1:call-1',
          type: 'tool',
          turn: 1,
          step: 1,
          callId: 'call-1',
          name: 'echo',
          arguments: '{"text":"hello"}',
          status: 'completed',
          result: 'echo: hello',
        },
        { id: 'step:1:2', type: 'step', turn: 1, step: 2, status: 'completed' },
        { id: 'assistant:1:2:0', type: 'assistant', turn: 1, step: 2, text: 'hello' },
      ],
    })
  })

  it('marks a failed tool result and preserves its error identity', async () => {
    const test = await compose()
    await test.ctx.sessions.start('/workspace')
    await test.ctx.sessions.send('run tool')
    test.publish(frame('session-1', {
      type: 'tool/call',
      seq: 1,
      time: 1,
      data: { turn: 1, step: 1, callId: 'call-1' as never, name: 'bash', arguments: '{"command":"false"}' },
    }))
    test.publish(frame('session-1', {
      type: 'tool/result',
      seq: 2,
      time: 2,
      data: {
        turn: 1,
        step: 1,
        message: {
          id: 'message-1' as never,
          role: 'user',
          source: { kind: 'tool', callId: 'call-1' as never },
          content: [{
            type: 'tool-result',
            toolCallId: 'call-1' as never,
            content: [{ type: 'text', text: 'exit 1' }],
            isError: true,
          }],
        },
        error: { name: 'ToolError', code: 'COMMAND_FAILED' },
      },
    }))

    expect(test.ctx.sessions.getSnapshot().timeline.at(-1)).toEqual({
      id: 'tool:1:call-1',
      type: 'tool',
      turn: 1,
      step: 1,
      callId: 'call-1',
      name: 'bash',
      arguments: '{"command":"false"}',
      status: 'error',
      result: 'exit 1',
      error: 'ToolError: COMMAND_FAILED',
    })
  })

  it('publishes the detailed turn error and clears it on retry', async () => {
    const test = await compose()
    await test.ctx.sessions.start('/workspace')
    await test.ctx.sessions.send('hello')
    test.publish(frame('session-1', {
      type: 'turn/end',
      seq: 1,
      time: 1,
      data: {
        turn: 1,
        reason: {
          kind: 'error',
          error: { message: '401: Invalid API Key', code: 'AUTH' },
        },
      },
    }))

    expect(test.ctx.sessions.getSnapshot()).toEqual({
      sessionId: 'session-1',
      status: 'error',
      timeline: [
        { id: 'user:1', type: 'user', text: 'hello' },
        { id: 'turn:1', type: 'turn', turn: 1, status: 'completed', reason: 'error' },
      ],
      error: 'AUTH: 401: Invalid API Key',
    })

    await test.ctx.sessions.send('retry')
    expect(test.ctx.sessions.getSnapshot()).toEqual({
      sessionId: 'session-1',
      status: 'running',
      timeline: [
        { id: 'user:1', type: 'user', text: 'hello' },
        { id: 'turn:1', type: 'turn', turn: 1, status: 'completed', reason: 'error' },
        { id: 'user:2', type: 'user', text: 'retry' },
      ],
    })
  })

  it('publishes request failures and unsubscribes on unload', async () => {
    const test = await compose()
    test.createSession.mockRejectedValueOnce(new Error('create failed'))
    await expect(test.ctx.sessions.start('/workspace')).rejects.toThrow('create failed')
    expect(test.ctx.sessions.getSnapshot()).toEqual({
      status: 'error',
      timeline: [],
      error: 'create failed',
    })

    expect(test.listenerCount()).toBe(1)
    const sessions = test.ctx.sessions
    await test.fiber.dispose()
    expect(test.listenerCount()).toBe(0)
    expect(() => sessions.subscribe(() => undefined)).toThrow(/closing/)
  })
})
