/**
 * Shared JSON protocol for the minimal browser client and Host API proxy.
 * The schemas validate untrusted wire values while preserving the core
 * session package's branded identity and merge-extensible event type.
 *
 * @module @minimal-web/host-apiproxy/protocol
 */

import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session/types'
import { z } from 'zod'

/** Request body for `POST /api/session.create`. */
export interface SessionCreateRequest {
  /** Working directory assigned to the new session. */
  cwd: string
}

/** Response body for `POST /api/session.create`. */
export interface SessionCreateResponse {
  /** Opaque identity of the created session. */
  sessionId: SessionId
}

/** Request body for `POST /api/session.prompt`. */
export interface SessionPromptRequest {
  /** Target session identity. */
  sessionId: SessionId
  /** Non-blank user text delivered to the Agent. */
  text: string
}

/** Response body for an accepted `POST /api/session.prompt`. */
export interface SessionPromptResponse {
  /** Confirms that the Agent accepted the message for processing. */
  accepted: true
}

/** One durable session event delivered through `/api/events.mux`. */
export interface SessionEventFrame {
  /** Downlink frame discriminator. */
  type: 'session/event'
  /** Session that owns the event. */
  sessionId: SessionId
  /** Event exactly as recorded by the core session service. */
  event: SessionEvent
}

/** Non-empty wire string branded as the core session identity. */
export const sessionIdSchema = z.string().min(1) as unknown as z.ZodType<SessionId>

/** JSON request schema for `session.create`. */
export const sessionCreateRequestSchema = z.object({
  cwd: z.string().min(1),
}) satisfies z.ZodType<SessionCreateRequest>

/** JSON response schema for `session.create`. */
export const sessionCreateResponseSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<SessionCreateResponse>

/** JSON request schema for `session.prompt`. */
export const sessionPromptRequestSchema = z.object({
  sessionId: sessionIdSchema,
  text: z.string().refine(text => text.trim().length > 0, {
    message: 'prompt text must not be blank',
  }),
}) satisfies z.ZodType<SessionPromptRequest>

/** JSON response schema for an accepted `session.prompt`. */
export const sessionPromptResponseSchema = z.object({
  accepted: z.literal(true),
}) satisfies z.ZodType<SessionPromptResponse>

/**
 * Session event envelope schema. Event data stays open because plugins extend
 * `SessionEventMap`; the client runtime decides which event types it folds.
 */
export const sessionEventSchema = z.object({
  type: z.string().min(1),
  seq: z.number().int().nonnegative(),
  time: z.number(),
  data: z.unknown(),
  sourceEventSeqs: z.array(z.number().int().nonnegative()).optional(),
  surfaceOp: z.unknown().optional(),
  ignorable: z.literal(true).optional(),
}) as unknown as z.ZodType<SessionEvent>

/** JSON frame schema for the session-event downlink. */
export const sessionEventFrameSchema = z.object({
  type: z.literal('session/event'),
  sessionId: sessionIdSchema,
  event: sessionEventSchema,
}) satisfies z.ZodType<SessionEventFrame>

/**
 * Parse one JSON string and validate it with the supplied wire schema.
 * @param json - UTF-8 request or frame body decoded to a string.
 * @param schema - Schema that owns the expected wire fields.
 * @returns The validated and typed value.
 * @throws `SyntaxError` for invalid JSON or `ZodError` for invalid fields.
 */
export function parseWireJson<T>(json: string, schema: z.ZodType<T>): T {
  const value: unknown = JSON.parse(json)
  return schema.parse(value)
}
