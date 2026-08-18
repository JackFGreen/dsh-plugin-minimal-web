import { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import MinimalApiProxyService from '../src/index.ts'

interface TestComposition {
  readonly ctx: Context
  readonly fiber: ReturnType<Context['plugin']>
  readonly create: ReturnType<typeof vi.fn<(options: CreateAgentOptions) => Promise<AgentHandle>>>
  readonly followups: Map<SessionId, ReturnType<typeof vi.fn<(message: UserMessage) => void>>>
  readonly disposals: Map<SessionId, ReturnType<typeof vi.fn<() => Promise<void>>>>
}

async function compose(
  createOverride?: (options: CreateAgentOptions) => Promise<AgentHandle>,
): Promise<TestComposition> {
  const ctx = new Context()
  const followups = new Map<SessionId, ReturnType<typeof vi.fn<(message: UserMessage) => void>>>()
  const disposals = new Map<SessionId, ReturnType<typeof vi.fn<() => Promise<void>>>>()
  const create = vi.fn(async (options: CreateAgentOptions): Promise<AgentHandle> => {
    if (createOverride !== undefined) return createOverride(options)
    const followup = vi.fn<(message: UserMessage) => void>()
    const dispose = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    followups.set(options.sessionId, followup)
    disposals.set(options.sessionId, dispose)
    return {
      agent: { id: options.sessionId, followup } as unknown as Agent,
      dispose,
    }
  })
  ctx.provide('agents', { create } as never)
  ctx.provide('agentLoop', {} as never)
  const fiber = ctx.plugin(MinimalApiProxyService, { provider: 'mock', model: 'mock-model' })
  await fiber
  return { ctx, fiber, create, followups, disposals }
}

function emitSessionEvent(ctx: Context, sessionId: SessionId, event: SessionEvent): void {
  ctx.emit('session/event', { id: sessionId } as Session, event)
}

describe('MinimalApiProxyService', () => {
  it('creates an Agent with the configured model and submits a user follow-up', async () => {
    const test = await compose()
    const created = await test.ctx.apiProxy.createSession({ cwd: '/workspace' })

    expect(test.create).toHaveBeenCalledWith({
      sessionId: created.sessionId,
      meta: { cwd: '/workspace' },
      agentOptions: { provider: 'mock', model: 'mock-model' },
    })
    await expect(test.ctx.apiProxy.prompt({
      sessionId: created.sessionId,
      text: 'hello',
    })).resolves.toEqual({ accepted: true })
    expect(test.followups.get(created.sessionId)).toHaveBeenCalledWith(expect.objectContaining({
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
      source: { kind: 'user' },
    }))

    await expect(test.ctx.apiProxy.prompt({
      sessionId: 'missing' as SessionId,
      text: 'hello',
    })).rejects.toThrow(/session "missing" not found/)
    await test.fiber.dispose()
  })

  it('publishes events only for owned Sessions and contains listener failures', async () => {
    const test = await compose()
    const created = await test.ctx.apiProxy.createSession({ cwd: '/workspace' })
    const received: SessionEvent[] = []
    const warning = vi.spyOn(test.ctx.logger, 'warn').mockImplementation(() => undefined)
    test.ctx.apiProxy.subscribe(() => { throw new Error('subscriber failed') })
    const unsubscribe = test.ctx.apiProxy.subscribe(frame => { received.push(frame.event) })
    const event = {
      type: 'assistant/chunk',
      seq: 0,
      time: 1,
      data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'a' } },
    } as SessionEvent

    emitSessionEvent(test.ctx, 'other' as SessionId, event)
    emitSessionEvent(test.ctx, created.sessionId, event)
    expect(received).toEqual([event])
    expect(warning).toHaveBeenCalledOnce()

    unsubscribe()
    unsubscribe()
    emitSessionEvent(test.ctx, created.sessionId, event)
    expect(received).toEqual([event])
    await test.fiber.dispose()
  })

  it('disposes every owned AgentHandle when the plugin unloads', async () => {
    const test = await compose()
    const first = await test.ctx.apiProxy.createSession({ cwd: '/one' })
    const second = await test.ctx.apiProxy.createSession({ cwd: '/two' })

    await test.fiber.dispose()

    expect(test.disposals.get(first.sessionId)).toHaveBeenCalledOnce()
    expect(test.disposals.get(second.sessionId)).toHaveBeenCalledOnce()
  })

  it('releases an AgentHandle that resolves after teardown begins', async () => {
    const pending = Promise.withResolvers<AgentHandle>()
    const dispose = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const test = await compose(() => pending.promise)
    const creation = test.ctx.apiProxy.createSession({ cwd: '/workspace' })
    const disposing = test.fiber.dispose()
    const options = test.create.mock.calls[0]?.[0]
    if (options === undefined) throw new Error('Agent creation did not start')

    pending.resolve({
      agent: { id: options.sessionId } as Agent,
      dispose,
    })

    await expect(creation).rejects.toThrow(/closing/)
    await disposing
    expect(dispose).toHaveBeenCalledOnce()
  })
})
