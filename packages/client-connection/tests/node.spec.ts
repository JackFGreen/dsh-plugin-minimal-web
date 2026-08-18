import { Context } from '@deepseek-ai/cordis'
import type { SessionEventFrame } from '@minimal-web/host-apiproxy/protocol'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import Connection from '../src/index.ts'
import WebServer from '../../host-webserver/src/index.ts'

let context: Context | undefined

interface TestComposition {
  ctx: Context
  connectionFiber: ReturnType<Context['plugin']>
  createSession: ReturnType<typeof vi.fn>
  prompt: ReturnType<typeof vi.fn>
  publish(frame: SessionEventFrame): void
}

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

async function compose(): Promise<TestComposition> {
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
  const connectionFiber = ctx.plugin(Connection)
  await connectionFiber
  return {
    ctx,
    connectionFiber,
    createSession,
    prompt,
    publish(frame) {
      for (const listener of listeners) listener(frame)
    },
  }
}

async function request(
  port: number,
  path: string,
  body: string,
  contentType = 'application/json',
): Promise<Response> {
  return fetch(`http://127.0.0.1:${String(port)}${path}`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  })
}

describe('client-connection Node half', () => {
  it('maps valid HTTP requests to apiProxy', async () => {
    const test = await compose()
    const port = test.ctx.webServer.port

    const created = await request(port, '/api/session.create', JSON.stringify({ cwd: '/workspace' }))
    expect(created.status).toBe(200)
    await expect(created.json()).resolves.toEqual({ sessionId: 'session-1' })
    expect(test.createSession).toHaveBeenCalledWith({ cwd: '/workspace' })

    const prompted = await request(port, '/api/session.prompt', JSON.stringify({
      sessionId: 'session-1',
      text: 'hello',
    }))
    expect(prompted.status).toBe(200)
    await expect(prompted.json()).resolves.toEqual({ accepted: true })
    expect(test.prompt).toHaveBeenCalledWith({ sessionId: 'session-1', text: 'hello' })
  })

  it('rejects invalid methods, media types, JSON, fields, and oversized bodies', async () => {
    const test = await compose()
    const base = `http://127.0.0.1:${String(test.ctx.webServer.port)}/api/session.create`

    expect((await fetch(base)).status).toBe(405)
    expect((await request(test.ctx.webServer.port, '/api/session.create', '{}', 'text/plain')).status).toBe(415)
    expect((await request(test.ctx.webServer.port, '/api/session.create', '{')).status).toBe(400)
    expect((await request(test.ctx.webServer.port, '/api/session.prompt', JSON.stringify({
      sessionId: 'session-1',
      text: '   ',
    }))).status).toBe(400)
    expect((await request(test.ctx.webServer.port, '/api/session.create', JSON.stringify({
      cwd: 'x'.repeat(65 * 1024),
    }))).status).toBe(413)
  })

  it('sends API events through a server-only WebSocket and closes it on unload', async () => {
    const test = await compose()
    const socket = new WebSocket(`ws://127.0.0.1:${String(test.ctx.webServer.port)}/api/events.mux`)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    const frame = {
      type: 'session/event',
      sessionId: 'session-1',
      event: {
        type: 'turn/end',
        seq: 1,
        time: 2,
        data: { turn: 1 },
      },
    } as SessionEventFrame
    const received = new Promise<string>((resolve) => {
      socket.once('message', data => { resolve(String(data)) })
    })

    test.publish(frame)
    await expect(received).resolves.toBe(JSON.stringify(frame))

    const closed = new Promise<number>((resolve) => {
      socket.once('close', code => { resolve(code) })
    })
    socket.send('not allowed')
    await expect(closed).resolves.toBe(1008)

    const second = new WebSocket(`ws://127.0.0.1:${String(test.ctx.webServer.port)}/api/events.mux`)
    await new Promise<void>((resolve, reject) => {
      second.once('open', resolve)
      second.once('error', reject)
    })
    const secondClosed = new Promise<void>((resolve) => { second.once('close', () => { resolve() }) })
    await test.connectionFiber.dispose()
    await secondClosed

    const removed = await request(test.ctx.webServer.port, '/api/session.create', JSON.stringify({ cwd: '/workspace' }))
    expect(removed.status).toBe(404)
  })
})
