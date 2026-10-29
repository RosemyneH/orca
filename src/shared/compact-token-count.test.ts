import { describe, expect, it } from 'vitest'
import { formatCompactTokenCount, formatIncludedTokenSuffix } from './compact-token-count'

describe('formatCompactTokenCount', () => {
  it.each([
    [999, '999'],
    [1_000, '1K'],
    [12_400, '12.4K'],
    [278_000_000, '278M'],
    [1_500_000, '1.5M'],
    [1_200_000_000, '1.2B']
  ])('formats %s as %s', (tokens, label) => {
    expect(formatCompactTokenCount(tokens)).toBe(label)
  })

  it('hides empty counts', () => {
    expect(formatCompactTokenCount(0)).toBeNull()
    expect(formatCompactTokenCount(-5)).toBeNull()
    expect(formatCompactTokenCount(Number.NaN)).toBeNull()
    expect(formatCompactTokenCount(undefined)).toBeNull()
    expect(formatIncludedTokenSuffix(278_000_000)).toBe(' · 278M')
    expect(formatIncludedTokenSuffix(null)).toBe('')
  })
})
