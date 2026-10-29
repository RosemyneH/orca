import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { ProviderPanel } from './tooltip'

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values?: Record<string, string>) => {
    let result = fallback
    for (const [key, value] of Object.entries(values ?? {})) {
      result = result.replace(`{{${key}}}`, value)
    }
    return result
  }
}))

vi.mock('@/lib/agent-catalog', () => ({
  AgentIcon: () => null
}))

describe('included token totals', () => {
  it('shows the count beside the window percentage', () => {
    const p: ProviderRateLimits = {
      provider: 'cursor',
      session: null,
      weekly: null,
      updatedAt: 0,
      error: null,
      status: 'ok',
      buckets: [
        {
          name: 'Cursor Models',
          usedPercent: 9,
          windowMinutes: 10_080,
          resetsAt: null,
          resetDescription: null,
          includedTokens: 278_000_000
        }
      ]
    }
    const markup = renderToStaticMarkup(createElement(ProviderPanel, { p }))
    expect(markup).toContain('9% used · 278M')
  })
})
