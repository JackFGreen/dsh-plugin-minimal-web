/**
 * Minimal React chat root plugin.
 *
 * @module @minimal-web/client-ui-minimal-chat
 */

import type { FormEvent } from 'react'
import { useCallback, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { Sessions, TimelineItem } from '@minimal-web/client-runtime'
import type {} from '@minimal-web/client-ui-slots'

/** Props accepted by the independently testable chat root. */
export interface ChatAppProps {
  readonly sessions: Sessions
}

/** One-input chat view with an ordered Agent process timeline. */
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
      <section aria-label="Agent过程">
        {state.timeline.map(item => <TimelineItemView key={item.id} item={item} />)}
      </section>
    </main>
  )
}

function TimelineItemView({ item }: { readonly item: TimelineItem }): React.JSX.Element {
  switch (item.type) {
    case 'user':
      return (
        <article data-kind="user">
          <h2>用户</h2>
          <pre>{item.text}</pre>
        </article>
      )
    case 'turn':
      return (
        <p data-kind="turn">
          轮次 {item.turn} · {item.status === 'running' ? '运行中' : `已结束（${item.reason ?? 'unknown'}）`}
        </p>
      )
    case 'step':
      return (
        <p data-kind="step">
          步骤 {item.turn}.{item.step} · {item.status === 'running' ? '运行中' : '已完成'}
        </p>
      )
    case 'reasoning':
      return (
        <details open data-kind="reasoning">
          <summary>思考 · {item.turn}.{item.step}</summary>
          <pre aria-label={`思考 ${item.turn}.${item.step}`}>{item.text}</pre>
        </details>
      )
    case 'assistant':
      return (
        <article data-kind="assistant">
          <h2>回答 · {item.turn}.{item.step}</h2>
          <pre aria-label={`模型回答 ${item.turn}.${item.step}`}>{item.text}</pre>
        </article>
      )
    case 'tool':
      return (
        <details open data-kind="tool">
          <summary>
            工具：{item.name} · {toolStatus(item.status)}
          </summary>
          <p>Call ID：{item.callId}</p>
          <pre aria-label={`工具参数 ${item.name}`}>{item.arguments}</pre>
          {item.result === undefined ? null : <pre aria-label={`工具结果 ${item.name}`}>{item.result}</pre>}
          {item.error === undefined ? null : <p role="alert">{item.error}</p>}
        </details>
      )
  }
}

function toolStatus(status: Extract<TimelineItem, { type: 'tool' }>['status']): string {
  switch (status) {
    case 'running': return '运行中'
    case 'completed': return '已完成'
    case 'error': return '失败'
  }
}

/** Services required by the chat root plugin. */
export const inject = ['slots', 'sessions']

/** Register the chat view as the only root Slot. */
export function apply(ctx: Context): void {
  const Root = (): React.JSX.Element => <ChatApp sessions={ctx.sessions} />
  ctx.effect(() => ctx.slots.registerRoot(Root), 'minimalChat.root')
}

export default Object.assign(apply, { inject })
