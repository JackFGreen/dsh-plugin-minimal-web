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
    userText: '',
    assistantText: '',
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
        userText: 'hello',
        assistantText: 'hel',
      })
    })
    expect((input as HTMLTextAreaElement).disabled).toBe(true)
    expect(screen.getByLabelText('模型回答').textContent).toBe('hel')
  })

  it('renders completed text and runtime errors', () => {
    const sessions = new TestSessions()
    render(<ChatApp sessions={sessions} />)

    act(() => {
      sessions.publish({
        sessionId: 'session-1' as ChatState['sessionId'],
        status: 'error',
        userText: 'hello',
        assistantText: 'hello world',
        error: 'request failed',
      })
    })

    expect(screen.getByLabelText('模型回答').textContent).toBe('hello world')
    expect(screen.getByRole('alert').textContent).toBe('request failed')
  })
})
