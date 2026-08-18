import { describe, expect, expectTypeOf, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  parseWireJson,
  sessionCreateRequestSchema,
  sessionCreateResponseSchema,
  sessionEventFrameSchema,
  sessionPromptRequestSchema,
  sessionPromptResponseSchema,
} from '../src/protocol.ts'

describe('minimal Web protocol', () => {
  it('parses the two request and response pairs', () => {
    expect(parseWireJson('{"cwd":"/workspace"}', sessionCreateRequestSchema)).toEqual({
      cwd: '/workspace',
    })

    const created = parseWireJson('{"sessionId":"session-1"}', sessionCreateResponseSchema)
    expect(created).toEqual({ sessionId: 'session-1' })
    expectTypeOf(created.sessionId).toEqualTypeOf<SessionId>()

    expect(parseWireJson(
      '{"sessionId":"session-1","text":" hello "}',
      sessionPromptRequestSchema,
    )).toEqual({ sessionId: 'session-1', text: ' hello ' })
    expect(parseWireJson('{"accepted":true}', sessionPromptResponseSchema)).toEqual({
      accepted: true,
    })
  })

  it('rejects invalid JSON', () => {
    expect(() => parseWireJson('{', sessionCreateRequestSchema)).toThrow(SyntaxError)
  })

  it.each(['', '   ', '\n\t'])('rejects blank prompt text %j', (text) => {
    expect(() => sessionPromptRequestSchema.parse({
      sessionId: 'session-1',
      text,
    })).toThrow(/must not be blank/)
  })

  it('rejects an invalid session id', () => {
    expect(() => sessionPromptRequestSchema.parse({
      sessionId: '',
      text: 'hello',
    })).toThrow()
  })

  it('accepts a core session event envelope and rejects invalid sequencing', () => {
    expect(sessionEventFrameSchema.parse({
      type: 'session/event',
      sessionId: 'session-1',
      event: {
        type: 'turn/start',
        seq: 0,
        time: 1,
        data: { trigger: { kind: 'user' } },
      },
    })).toMatchObject({ type: 'session/event', sessionId: 'session-1' })

    expect(() => sessionEventFrameSchema.parse({
      type: 'session/event',
      sessionId: 'session-1',
      event: {
        type: 'turn/start',
        seq: -1,
        time: 1,
        data: {},
      },
    })).toThrow()
  })
})
