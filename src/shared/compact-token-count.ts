/** Compact included-token counts for status chips: 999, 12.4K, 278M, 1.2B. */
export function formatCompactTokenCount(tokens: number | null | undefined): string | null {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0) {
    return null
  }
  const units: readonly [number, string][] = [
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K']
  ]
  for (const [scale, suffix] of units) {
    if (tokens < scale) {
      continue
    }
    const scaled = (tokens / scale).toFixed(1)
    const compact = scaled.endsWith('.0') ? scaled.slice(0, -2) : scaled
    return `${compact}${suffix}`
  }
  return String(Math.round(tokens))
}

export function formatIncludedTokenSuffix(tokens: number | null | undefined): string {
  const label = formatCompactTokenCount(tokens)
  return label ? ` · ${label}` : ''
}
