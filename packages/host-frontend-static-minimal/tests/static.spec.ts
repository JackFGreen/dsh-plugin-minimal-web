import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import FrontendStatic from '../src/index.ts'
import WebServer from '../../host-webserver/src/index.ts'

let context: Context | undefined
let fixture: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (fixture !== undefined) await rm(fixture, { recursive: true, force: true })
  fixture = undefined
})

describe('host-frontend-static-minimal', () => {
  it('serves assets and falls application routes back to index.html', async () => {
    fixture = await mkdtemp(join(tmpdir(), 'minimal-static-'))
    await mkdir(join(fixture, 'assets'))
    await mkdir(join(fixture, 'plugins'))
    await writeFile(join(fixture, 'index.html'), '<main>app</main>')
    await writeFile(join(fixture, 'assets', 'app.js'), 'export {}')
    await writeFile(join(fixture, 'plugins', 'chat.js'), 'export default {}')
    const ctx = new Context()
    context = ctx
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
    await ctx.plugin(FrontendStatic, { root: fixture })
    const base = `http://127.0.0.1:${String(ctx.webServer.port)}`

    const index = await fetch(`${base}/chat/session`)
    expect(index.status).toBe(200)
    expect(index.headers.get('content-type')).toContain('text/html')
    expect(await index.text()).toBe('<main>app</main>')
    const asset = await fetch(`${base}/assets/app.js`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toContain('text/javascript')
    expect(await asset.text()).toBe('export {}')
    await expect(fetch(`${base}/plugins/missing.js`).then(response => response.status)).resolves.toBe(404)
  })
})
