import { getMainHttpClient } from '../network/http-client'
import { abortSignalWithTimeout } from '../lib/abort-signal-with-timeout'
import type { CursorAuthSession } from './cursor-auth'
import { cursorSessionCookie } from './cursor-session-token'
import { mapCursorIncludedTokens } from './cursor-usage-mapping'
import {
  CURSOR_MODELS_BUCKET_NAME,
  CURSOR_ON_DEMAND_BUCKET_NAME
} from '../../shared/cursor-usage-buckets'
import type { ProviderRateLimits, RateLimitWindow } from '../../shared/rate-limit-types'

const DAILY_USAGE_URL = 'https://cursor.com/api/dashboard/v2/query-daily-usage'
const API_TIMEOUT_MS = 10_000

function includedTokenWindow(limits: ProviderRateLimits): RateLimitWindow | null {
  const cursorModels = limits.buckets?.find((bucket) => bucket.name === CURSOR_MODELS_BUCKET_NAME)
  const candidate =
    cursorModels ??
    limits.monthly ??
    limits.buckets?.find((bucket) => bucket.name !== CURSOR_ON_DEMAND_BUCKET_NAME) ??
    null
  if (!candidate || candidate.resetsAt === null || candidate.windowMinutes <= 0) {
    return null
  }
  return candidate
}

function applyIncludedTokens(limits: ProviderRateLimits, tokens: number): ProviderRateLimits {
  const buckets = limits.buckets
  if (buckets?.some((bucket) => bucket.name === CURSOR_MODELS_BUCKET_NAME)) {
    return {
      ...limits,
      buckets: buckets.map((bucket) =>
        bucket.name === CURSOR_MODELS_BUCKET_NAME ? { ...bucket, includedTokens: tokens } : bucket
      )
    }
  }
  if (limits.monthly) {
    return { ...limits, monthly: { ...limits.monthly, includedTokens: tokens } }
  }
  const first = buckets?.[0]
  if (!first || !buckets) {
    return limits
  }
  return { ...limits, buckets: [{ ...first, includedTokens: tokens }, ...buckets.slice(1)] }
}

/** Percentages stay published when the included-token read fails. */
export async function attachCursorIncludedTokens(
  session: CursorAuthSession,
  limits: ProviderRateLimits,
  signal?: AbortSignal
): Promise<ProviderRateLimits> {
  if (limits.status !== 'ok') {
    return limits
  }
  const window = includedTokenWindow(limits)
  if (!window?.resetsAt) {
    return limits
  }
  try {
    const startMs = window.resetsAt - window.windowMinutes * 60_000
    const endMs = Math.min(Date.now() + 120_000, window.resetsAt)
    const res = await getMainHttpClient().fetch(DAILY_USAGE_URL, {
      method: 'POST',
      redirect: 'manual',
      credentials: 'omit',
      headers: {
        Cookie: cursorSessionCookie(session.token),
        Accept: 'application/json',
        Origin: 'https://cursor.com',
        Referer: 'https://cursor.com/dashboard',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        scope: 'user',
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString(),
        groupBy: ['usageType']
      }),
      signal: abortSignalWithTimeout(signal, API_TIMEOUT_MS)
    })
    if (!res.ok) {
      return limits
    }
    const tokens = mapCursorIncludedTokens(await res.json())
    return tokens === null ? limits : applyIncludedTokens(limits, tokens)
  } catch {
    return limits
  }
}
