import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import ClientModules from '../src/index.ts'
import { parseBootManifest } from '../src/client/index.ts'
import WebServer from '../../host-webserver/src/index.ts'

let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
})

describe('client-modules', () => {
  it('serves a fixed executable boot manifest', async () => {
    const ctx = new Context()
    context = ctx
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(ClientModules)

    const response = await fetch(`http://127.0.0.1:${String(ctx.webServer.port)}/boot.js`)
    const script = await response.text()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/javascript')
    expect(script).toContain('globalThis.__DSH_BOOT__=')
    expect(script).toContain('/plugins/connection.js')
    expect(script).toContain('/plugins/runtime.js')
    expect(script).toContain('/plugins/chat.js')
  })

  it('validates browser manifest fields and duplicate ids', () => {
    expect(parseBootManifest({
      cwd: '/workspace',
      entries: [{ id: 'one', url: '/one.js' }],
    })).toEqual({ cwd: '/workspace', entries: [{ id: 'one', url: '/one.js' }] })
    expect(() => parseBootManifest(undefined)).toThrow(/missing/)
    expect(() => parseBootManifest({ cwd: '', entries: [] })).toThrow(/cwd/)
    expect(() => parseBootManifest({
      cwd: '/workspace',
      entries: [{ id: 'one', url: '/one.js' }, { id: 'one', url: '/two.js' }],
    })).toThrow(/duplicate/)
  })
})
