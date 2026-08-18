import { once } from 'node:events'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebServer from '../src/index.ts'
import type { WebUpgradeRoute } from '../src/index.ts'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

async function compose(): Promise<{ ctx: Context; fiber: ReturnType<Context['plugin']> }> {
  const ctx = new Context()
  context = ctx
  const fiber = ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await fiber
  return { ctx, fiber }
}

async function request(port: number, path: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`http://127.0.0.1:${String(port)}${path}`)
  return { status: response.status, body: await response.text() }
}

async function openUpgrade(port: number, path: string): Promise<ReturnType<typeof connect>> {
  const socket = connect(port, '127.0.0.1')
  await once(socket, 'connect')
  const response = once(socket, 'data')
  socket.write([
    `GET ${path} HTTP/1.1`,
    `Host: 127.0.0.1:${String(port)}`,
    'Connection: Upgrade',
    'Upgrade: minimal-test',
    '',
    '',
  ].join('\r\n'))
  const [data] = await response as [Buffer]
  expect(String(data)).toContain('101 Switching Protocols')
  return socket
}

describe('WebServer', () => {
  it('prints the usable URL after the server starts listening', async () => {
    const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const { ctx } = await compose()

    expect(output).toHaveBeenCalledWith(`minimal web: http://127.0.0.1:${String(ctx.webServer.port)}\n`)
  })

  it('serves health and exact routes until their owner unloads', async () => {
    const { ctx } = await compose()
    const port = ctx.webServer.port

    await expect(request(port, '/health')).resolves.toEqual({ status: 200, body: 'ok' })
    expect(() => ctx.webServer.register({ path: '/health', handler: () => undefined }))
      .toThrow(/duplicate route/)

    const routeOwner = ctx.plugin((child) => {
      child.effect(() => ctx.webServer.register({
        path: '/probe',
        handler: (_request, response) => {
          response.writeHead(200)
          response.end('probe')
        },
      }))
    })
    await routeOwner

    await expect(request(port, '/probe?query=ignored')).resolves.toEqual({ status: 200, body: 'probe' })
    expect(() => ctx.webServer.register({ path: '/probe', handler: () => undefined }))
      .toThrow(/duplicate route/)

    await routeOwner.dispose()
    await expect(request(port, '/probe')).resolves.toEqual({ status: 404, body: '' })
  })

  it('dispatches exact Upgrade routes and supports idempotent disposal', async () => {
    const { ctx } = await compose()
    const route: WebUpgradeRoute = {
      path: '/events',
      handler: (_request, socket) => {
        socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: minimal-test\r\n\r\n')
      },
    }
    const dispose = ctx.webServer.registerUpgrade(route)
    expect(() => ctx.webServer.registerUpgrade(route)).toThrow(/duplicate upgrade route/)

    const socket = await openUpgrade(ctx.webServer.port, '/events?channel=mux')
    dispose()
    dispose()
    expect(() => ctx.webServer.registerUpgrade(route)).not.toThrow()
    socket.destroy()
  })

  it('uses one disposable fallback only after exact-route lookup misses', async () => {
    const { ctx } = await compose()
    const dispose = ctx.webServer.registerFallback((_request, response) => {
      response.writeHead(200)
      response.end('fallback')
    })
    expect(() => ctx.webServer.registerFallback(() => undefined)).toThrow(/already registered/)
    ctx.webServer.register({
      path: '/exact',
      handler: (_request, response) => {
        response.writeHead(200)
        response.end('exact')
      },
    })

    await expect(request(ctx.webServer.port, '/exact')).resolves.toEqual({ status: 200, body: 'exact' })
    await expect(request(ctx.webServer.port, '/other')).resolves.toEqual({ status: 200, body: 'fallback' })
    dispose()
    dispose()
    await expect(request(ctx.webServer.port, '/other')).resolves.toEqual({ status: 404, body: '' })
  })

  it('closes upgraded sockets and releases its port on teardown', async () => {
    const { ctx, fiber } = await compose()
    ctx.webServer.registerUpgrade({
      path: '/events',
      handler: (_request, socket) => {
        socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: minimal-test\r\n\r\n')
      },
    })
    const port = ctx.webServer.port
    const socket = await openUpgrade(port, '/events')
    const socketClosed = once(socket, 'close')

    await fiber.dispose()
    await socketClosed

    const replacement = createServer()
    await new Promise<void>((resolve, reject) => {
      replacement.once('error', reject)
      replacement.listen(port, '127.0.0.1', resolve)
    })
    await new Promise<void>((resolve) => { replacement.close(() => { resolve() }) })
  })
})
