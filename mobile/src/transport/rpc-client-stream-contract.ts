import type { BrowserScreencastFrame } from './browser-screencast-protocol'
import type { RpcEnvelopeFields, RpcRequestFrame } from './rpc-envelope-fields'
import type { ConnectionState, RpcResponse } from './types'

export type RpcStreamingListener = (result: unknown, metadata?: RpcResponse['_meta']) => void

export type RpcStreamSubscribeOptions = {
  onBinaryFrame?: (frame: BrowserScreencastFrame) => void
  envelope?: RpcEnvelopeFields
}

export type StreamRequest = {
  method: string
  params: unknown
  envelope?: RpcEnvelopeFields
  listener?: RpcStreamingListener
  onBinaryFrame?: (frame: BrowserScreencastFrame) => void
  subscriptionId?: string
  cancelled?: boolean
  sent?: boolean
  receivedSnapshot?: boolean
}

export type StreamRegistryOptions = {
  nextId: () => string
  getState: () => ConnectionState
  sendFrame: (frame: RpcRequestFrame) => boolean
}
