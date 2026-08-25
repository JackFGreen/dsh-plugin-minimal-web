// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ChatState, Sessions } from '@minimal-web/client-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatApp } from '../src/index.tsx'

class TestSessions implements Sessions {
  private readonly listeners = new Set<() => void>()
  private state: ChatState = {
    sessionId: 'session-1' as ChatState['sessionId'],
    status: 'ready',
    timeline: [],
  }

  readonly start = vi.fn<Sessions['start']>().mockResolvedValue(undefined)
  readonly send = vi.fn<Sessions['send']>().mockResolvedValue(undefined)

  getSnapshot = (): ChatState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  publish(state: ChatState): void {
    this.state = state
    for (const listener of this.listeners) listener()
  }
}

afterEach(() => {
  cleanup()
})

describe('ChatApp', () => {
  it('sends trimmed input and disables submission while running', () => {
    const sessions = new TestSessions()
    render(<ChatApp sessions={sessions} />)
    const input = screen.getByRole('textbox', { name: '消息' })
    const button = screen.getByRole('button', { name: '发送' })

    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: '  hello  ' } })
    expect((button as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(button)
    expect(sessions.send).toHaveBeenCalledWith('hello')

    act(() => {
      sessions.publish({
        sessionId: 'session-1' as ChatState['sessionId'],
        status: 'running',
        timeline: [
          { id: 'user:1', type: 'user', text: 'hello' },
          { id: 'reasoning:1:1:0', type: 'reasoning', turn: 1, step: 1, text: 'thinking' },
          { id: 'assistant:1:1:1', type: 'assistant', turn: 1, step: 1, text: 'hel' },
        ],
      })
    })
    expect((input as HTMLTextAreaElement).disabled).toBe(true)
    expect(screen.getByLabelText('思考 1.1').textContent).toBe('thinking')
    expect(screen.getByLabelText('模型回答 1.1').textContent).toBe('hel')
  })

  it('renders turns, steps, tool calls, results and runtime errors', () => {
    const sessions = new TestSessions()
    render(<ChatApp sessions={sessions} />)

    act(() => {
      sessions.publish({
        sessionId: 'session-1' as ChatState['sessionId'],
        status: 'error',
        timeline: [
          { id: 'turn:1', type: 'turn', turn: 1, status: 'completed', reason: 'error' },
          { id: 'step:1:1', type: 'step', turn: 1, step: 1, status: 'completed' },
          {
            id: 'tool:1:call-1',
            type: 'tool',
            turn: 1,
            step: 1,
            callId: 'call-1',
            name: 'echo',
            arguments: '{"text":"hello"}',
            status: 'completed',
            result: 'echo: hello',
          },
          { id: 'assistant:1:2:0', type: 'assistant', turn: 1, step: 2, text: 'hello world' },
        ],
        error: 'AUTH: 401: Invalid API Key',
      })
    })

    expect(screen.getByText('轮次 1 · 已结束（error）')).toBeDefined()
    expect(screen.getByText('步骤 1.1 · 已完成')).toBeDefined()
    expect(screen.getByText('工具：echo · 已完成')).toBeDefined()
    expect(screen.getByLabelText('工具参数 echo').textContent).toBe('{"text":"hello"}')
    expect(screen.getByLabelText('工具结果 echo').textContent).toBe('echo: hello')
    expect(screen.getByLabelText('模型回答 1.2').textContent).toBe('hello world')
    expect(screen.getByRole('alert').textContent).toBe('AUTH: 401: Invalid API Key')
  })
})
