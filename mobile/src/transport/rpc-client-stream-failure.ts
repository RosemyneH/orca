import { translate } from '../i18n/mobile-i18n'
import type { RpcResponse } from './types'

export function interruptedStreamFailure() {
  return {
    type: 'error',
    message: translate('connection.rpcClientStreamRegistry.interrupted', 'Connection interrupted')
  }
}

export function endedStreamFailure(response: RpcResponse) {
  return {
    type: 'error',
    message: response.ok
      ? translate(
          'connection.rpcClientStreamRegistry.endedBeforeReady',
          'Streaming request ended before it was ready.'
        )
      : response.error.message,
    error: response.ok ? undefined : response.error
  }
}
