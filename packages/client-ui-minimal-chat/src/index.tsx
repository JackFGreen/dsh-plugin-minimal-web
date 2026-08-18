/**
 * Minimal React chat root plugin.
 *
 * @module @minimal-web/client-ui-minimal-chat
 */

import type { FormEvent } from 'react'
import { useCallback, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { Sessions } from '@minimal-web/client-runtime'
import type {} from '@minimal-web/client-ui-slots'

/** Props accepted by the independently testable chat root. */
export interface ChatAppProps {
  readonly sessions: Sessions
}

/** One-input, one-answer chat view. */
export function ChatApp({ sessions }: ChatAppProps): React.JSX.Element {
  const subscribe = useCallback((listener: () => void) => sessions.subscribe(listener), [sessions])
  const getSnapshot = useCallback(() => sessions.getSnapshot(), [sessions])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [input, setInput] = useState('')
  const disabled = state.sessionId === undefined
    || state.status === 'starting'
    || state.status === 'running'
    || input.trim().length === 0

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const text = input.trim()
    if (disabled || text.length === 0) return
    setInput('')
    void sessions.send(text).catch(() => undefined)
  }

  return (
    <main>
      <form onSubmit={submit}>
        <textarea
          aria-label="消息"
          value={input}
          onChange={event => { setInput(event.currentTarget.value) }}
          disabled={state.status === 'starting' || state.status === 'running'}
        />
        <button type="submit" disabled={disabled}>发送</button>
      </form>
      {state.error === undefined ? null : <p role="alert">{state.error}</p>}
      <pre aria-label="模型回答">{state.assistantText}</pre>
    </main>
  )
}

/** Services required by the chat root plugin. */
export const inject = ['slots', 'sessions']

/** Register the chat view as the only root Slot. */
export function apply(ctx: Context): void {
  const Root = (): React.JSX.Element => <ChatApp sessions={ctx.sessions} />
  ctx.effect(() => ctx.slots.registerRoot(Root), 'minimalChat.root')
}

export default Object.assign(apply, { inject })
