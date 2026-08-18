/**
 * Minimal Host transport for session commands and event delivery.
 *
 * @module @minimal-web/client-connection
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  parseWireJson,
  sessionCreateRequestSchema,
  sessionPromptRequestSchema,
} from '@minimal-web/host-apiproxy/protocol'
import type {} from '@minimal-web/host-apiproxy'
import type {} from '@minimal-web/host-webserver'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'

/** Stable Cordis plugin name. */
export const name = 'minimal-client-connection'

/** Services required by the Host transport. */
export const inject = ['webServer', 'apiProxy']

const MAX_REQUEST_BODY_BYTES = 64 * 1024

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/** Register the minimal HTTP-up and WebSocket-down transport. */
export function apply(ctx: Context): void {
  const sockets = new WebSocketServer({ noServer: true })
  sockets.on('connection', (socket) => {
    socket.on('message', () => {
      socket.close(1008, 'server-to-client only')
    })
  })

  const unsubscribe = ctx.apiProxy.subscribe((frame) => {
    const message = JSON.stringify(frame)
    for (const socket of sockets.clients) {
      if (socket.readyState === WebSocket.OPEN) socket.send(message)
    }
  })

  ctx.effect(() => ctx.webServer.register({
    path: '/api/session.create',
    handler: (request, response) => handleJsonRequest(ctx, request, response, async (json) => {
      const input = parseWireJson(json, sessionCreateRequestSchema)
      return ctx.apiProxy.createSession(input)
    }),
  }), 'minimalConnection.sessionCreate')

  ctx.effect(() => ctx.webServer.register({
    path: '/api/session.prompt',
    handler: (request, response) => handleJsonRequest(ctx, request, response, async (json) => {
      const input = parseWireJson(json, sessionPromptRequestSchema)
      return ctx.apiProxy.prompt(input)
    }),
  }), 'minimalConnection.sessionPrompt')

  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: '/api/events.mux',
    handler: (request, socket, head) => {
      sockets.handleUpgrade(request, socket, head, (websocket) => {
        sockets.emit('connection', websocket, request)
      })
    },
  }), 'minimalConnection.eventsMux')

  ctx.effect(() => async () => {
    unsubscribe()
    for (const socket of sockets.clients) socket.terminate()
    await new Promise<void>((resolve) => { sockets.close(() => { resolve() }) })
  }, 'minimalConnection.sockets')
}

async function handleJsonRequest(
  ctx: Context,
  request: IncomingMessage,
  response: ServerResponse,
  operation: (json: string) => Promise<unknown>,
): Promise<void> {
  if (request.method !== 'POST') {
    response.writeHead(405, { allow: 'POST' })
    response.end()
    return
  }
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    response.writeHead(415)
    response.end()
    return
  }

  try {
    const json = await readBody(request)
    const result = await operation(json)
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify(result))
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      response.writeHead(error.status)
      response.end()
      return
    }
    if (error instanceof SyntaxError || isValidationError(error)) {
      response.writeHead(400)
      response.end()
      return
    }
    ctx.logger.warn(error instanceof Error ? error : new Error(String(error)))
    response.writeHead(500)
    response.end()
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false

    const cleanup = (): void => {
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onError)
    }
    const onData = (chunk: Buffer): void => {
      size += chunk.length
      if (size <= MAX_REQUEST_BODY_BYTES) {
        chunks.push(chunk)
        return
      }
      settled = true
      cleanup()
      request.resume()
      reject(new HttpError(413, 'request body too large'))
    }
    const onEnd = (): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks).toString('utf8'))
    }
    const onError = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    request.on('data', onData)
    request.on('end', onEnd)
    request.on('error', onError)
  })
}

function isValidationError(error: unknown): boolean {
  return error instanceof Error && error.name === 'ZodError'
}

export default Object.assign(apply, { inject })
