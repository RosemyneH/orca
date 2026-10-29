import {
  buildTerminalUnsubscribeParams,
  buildStreamUnsubscribe
} from './rpc-client-terminal-subscription'
import type { RpcClient } from './rpc-client'
import type { RpcEnvelopeFields } from './rpc-envelope-fields'
import type { RpcResponse } from './types'
export type StreamRecord = {
  method: string
  params: unknown
  envelope?: RpcEnvelopeFields
  listener: (result: unknown, metadata?: RpcResponse['_meta']) => void
  onBinaryFrame?: Parameters<RpcClient['subscribe']>[3] extends
    | { onBinaryFrame?: infer Listener }
    | undefined
    ? Listener
    : never
  streamIds: Set<number>
  subscriptionId?: string
  cancelled: boolean
  /** Position in this session's send order, or null while unsent. */
  sendOrder: number | null
  receivedSnapshot?: boolean
}

export type StreamUnsubscribe = { method: string; params: Record<string, unknown> }

// Include the whole envelope in cleanup-slot identity; sort keys so equivalent routing names the same slot.
export function unsubscribeSlot(
  { method, params }: StreamUnsubscribe,
  envelope: RpcEnvelopeFields | undefined
): string | null {
  if (!('subscriptionId' in params)) {
    return null
  }
  const client =
    'client' in params && typeof params.client === 'object' && params.client !== null
      ? params.client
      : null
  const clientId = client && 'id' in client ? client.id : null
  const routing = envelope ? Object.entries(envelope).sort(([a], [b]) => (a < b ? -1 : 1)) : null
  return JSON.stringify([method, params.subscriptionId, clientId, routing])
}

export function buildParamsUnsubscribe(
  method: string,
  params: unknown,
  requestId: string
): StreamUnsubscribe | null {
  if (method === 'terminal.subscribe') {
    const unsubscribeParams = buildTerminalUnsubscribeParams(params)
    return unsubscribeParams ? { method: 'terminal.unsubscribe', params: unsubscribeParams } : null
  }
  return buildStreamUnsubscribe(method, params, requestId)
}
