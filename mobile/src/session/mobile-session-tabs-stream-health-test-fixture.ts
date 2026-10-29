import { vi } from 'vitest'
import { createFakeRpcClient } from '../mobile-web-shell/bridge-host-test-fakes'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import {
  MobileSessionTabsStreamHealth,
  type SessionTabsApplyOutcome
} from './mobile-session-tabs-stream-health'
export type TestResult = {
  type?: 'snapshot' | 'updated' | 'error' | 'end'
  snapshotVersion: number
  tabs: string[]
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

export function result(
  snapshotVersion: number,
  type?: TestResult['type'],
  tabs = [`tab-${snapshotVersion}`]
): TestResult {
  return { snapshotVersion, tabs, ...(type ? { type } : {}) }
}

export function success(value: TestResult): RpcResponse {
  return {
    id: `list-${value.snapshotVersion}`,
    ok: true,
    result: value,
    _meta: { runtimeId: 'runtime-1' }
  }
}

export function failure(): RpcResponse {
  return {
    id: 'list-failure',
    ok: false,
    error: { code: 'unavailable', message: 'try again' },
    _meta: { runtimeId: 'runtime-1' }
  }
}

export function makeHarness(options?: {
  generation?: { current: number }
  apply?: (value: TestResult) => SessionTabsApplyOutcome<string>
  getApplicationRevision?: () => number
}) {
  const requests: Deferred<RpcResponse>[] = []
  const sendRequest = vi.fn(() => {
    const request = deferred<RpcResponse>()
    requests.push(request)
    return request.promise
  })
  const generation = options?.generation ?? { current: 1 }
  const client: RpcClient = {
    ...createFakeRpcClient({ getGeneration: () => generation.current }),
    sendRequest
  }
  const apply =
    options?.apply ??
    vi.fn((value: TestResult): SessionTabsApplyOutcome<string> => ({
      accepted: true,
      effectiveTabs: value.tabs
    }))
  const consumeAccepted = vi.fn()
  let recoveryNeeded = false
  const controller = new MobileSessionTabsStreamHealth<TestResult, string>({
    client,
    scope: 'id:repo::worktree',
    apply,
    consumeAccepted,
    hasRecoveryNeed: () => recoveryNeeded,
    getApplicationRevision: options?.getApplicationRevision
  })
  return {
    apply,
    client,
    consumeAccepted,
    controller,
    generation,
    requests,
    sendRequest,
    setRecoveryNeeded(value: boolean) {
      recoveryNeeded = value
    }
  }
}

export async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}
