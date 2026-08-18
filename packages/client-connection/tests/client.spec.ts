import { Context } from '@deepseek-ai/cordis'
import type { SessionEventFrame } from '@minimal-web/host-apiproxy/protocol'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NodeWebSocket from 'ws'
import HostConnection from '../src/index.ts'
import BrowserConnection from '../src/client/index.ts'
import WebServer from '../../host-webserver/src/index.ts'

let context: Context | undefined
const originalLocation = globalThis.location
const originalWebSocket = globalThis.WebSocket

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  Object.defineProperty(globalThis, 'location', { configurable: true, value: originalLocation })
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: originalWebSocket })
})

interface BrowserComposition {
  ctx: Context
  browserFiber: ReturnType<Context['plugin']>
  createSession: ReturnType<typeof vi.fn>
  prompt: ReturnType<typeof vi.fn>
  publish(frame: SessionEventFrame): void
}

async function compose(): Promise<BrowserComposition> {
  const ctx = new Context()
  context = ctx
  const listeners = new Set<(frame: SessionEventFrame) => void>()
  const createSession = vi.fn(async () => ({ sessionId: 'session-1' as SessionId }))
  const prompt = vi.fn(async () => ({ accepted: true as const }))
  ctx.provide('apiProxy', {
    createSession,
    prompt,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  })

  const webServerFiber = ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await webServerFiber
  const hostConnectionFiber = ctx.plugin(HostConnection)
  await hostConnectionFiber

  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: new URL(`http://127.0.0.1:${String(ctx.webServer.port)}/`),
  })
  Object.defineProperty(globalThis, 'WebSocket', {
    configurable: true,
    value: NodeWebSocket,
  })

  const browserFiber = ctx.plugin(BrowserConnection)
  await browserFiber
  return {
    ctx,
    browserFiber,
    createSession,
    prompt,
    publish(frame) {
      for (const listener of listeners) listener(frame)
    },
  }
}

describe('client-connection browser half', () => {
  it('creates a Session, sends a prompt, and receives a validated event', async () => {
    const test = await compose()
    expect(test.ctx.connection.status).toBe('connected')

    await expect(test.ctx.connection.createSession('/workspace')).resolves.toBe('session-1')
    expect(test.createSession).toHaveBeenCalledWith({ cwd: '/workspace' })
    await expect(test.ctx.connection.prompt('session-1' as SessionId, 'hello')).resolves.toBeUndefined()
    expect(test.prompt).toHaveBeenCalledWith({ sessionId: 'session-1', text: 'hello' })

    const frame = {
      type: 'session/event',
      sessionId: 'session-1',
      event: {
        type: 'assistant/chunk',
        seq: 1,
        time: 2,
        data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'hello' } },
      },
    } as SessionEventFrame
    const received: SessionEventFrame[] = []
    const unsubscribe = test.ctx.connection.subscribe(event => { received.push(event) })
    test.publish(frame)
    await vi.waitFor(() => { expect(received).toEqual([frame]) })

    unsubscribe()
    unsubscribe()
    test.publish(frame)
    await new Promise(resolve => { setTimeout(resolve, 10) })
    expect(received).toEqual([frame])
  })

  it('rejects invalid HTTP responses and invalid WebSocket events', async () => {
    const test = await compose()
    test.createSession.mockResolvedValueOnce({ wrong: true })
    await expect(test.ctx.connection.createSession('/workspace')).rejects.toThrow()

    const warning = vi.spyOn(test.ctx.logger, 'warn').mockImplementation(() => undefined)
    test.publish({ invalid: true } as unknown as SessionEventFrame)
    await vi.waitFor(() => { expect(test.ctx.connection.status).toBe('disconnected') })
    expect(warning).toHaveBeenCalled()
  })

  it('closes the browser WebSocket when the plugin unloads', async () => {
    const test = await compose()
    const connection = test.ctx.connection
    await test.browserFiber.dispose()
    expect(connection.status).toBe('disconnected')
    expect(() => connection.subscribe(() => undefined)).toThrow(/closing/)
  })
})
