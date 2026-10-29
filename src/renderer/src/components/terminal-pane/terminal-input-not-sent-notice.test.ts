import { beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ info: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { notifyTerminalTypingDiscardedBeforeBind } from './terminal-input-not-sent-notice'

describe('pre-bind typing discard notice', () => {
  beforeEach(() => toast.info.mockReset())

  it('shows one non-blocking notice per tab, however many panes report it', () => {
    notifyTerminalTypingDiscardedBeforeBind('tab-1')
    notifyTerminalTypingDiscardedBeforeBind('tab-1')

    expect(toast.info).toHaveBeenCalledWith(
      'Some keys typed while the terminal was starting were not sent.',
      { id: 'terminal-typing-discarded-before-bind:tab-1' }
    )
    expect(new Set(toast.info.mock.calls.map((call) => call[1].id)).size).toBe(1)
  })
})
