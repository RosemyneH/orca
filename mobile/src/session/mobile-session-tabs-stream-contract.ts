import type { RpcClient } from '../transport/rpc-client'
import type { RpcFailure, RpcResponse } from '../transport/types'

export type SessionTabsApplyOutcome<Tab> =
  | { accepted: false }
  | { accepted: true; effectiveTabs: readonly Tab[]; applicationRevision?: number }

export type SessionTabsStreamSource = 'list' | 'stream'

export type StreamHealth = 'probing' | 'live' | 'degraded'

export type RequestOwner = {
  generation: number
  barrier: number
  requirement: number
  applicationRevision: number
}

export type RequestCohort = {
  promise: Promise<void>
  resolve: () => void
  retry: boolean
}

export type ControllerOptions<Result, Tab> = {
  client: RpcClient
  scope: string
  apply: (result: Result) => SessionTabsApplyOutcome<Tab>
  consumeAccepted: (
    result: Result,
    effectiveTabs: readonly Tab[],
    source: SessionTabsStreamSource
  ) => void
  hasRecoveryNeed: () => boolean
  allowRecoveryPoll?: () => boolean
  getApplicationRevision?: () => number
  onFetchStarted?: () => void
  onFetchSucceeded?: (result: Result) => void
  onFetchFailed?: (failure: RpcFailure) => void
  onFetchErrored?: (error: unknown) => void
}

export type StreamSubscription = {
  listener: (payload: unknown, metadata?: RpcResponse['_meta']) => void
  cancel: () => void
}
