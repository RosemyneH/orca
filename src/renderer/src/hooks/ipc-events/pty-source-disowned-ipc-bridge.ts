import { retireDesktopTerminalObservation } from '../../runtime/desktop-terminal-observation-owner'
import { useAppStore } from '../../store'

/** Record disowned IDs even while panes are unmounted so reconnect can replace unusable handles. Disowning proves no future reattach, never process exit; respawn may leave the old process alive. Link loss/timeouts/identity mismatches send no exit (ssh-execution-boundary.md). */
export function registerPtySourceDisownedIpcBridge(unsubs: (() => void)[]): void {
  const unavailable = window.api.pty?.onWriteUnavailable?.(({ id }) =>
    retireDesktopTerminalObservation(id)
  )
  if (unavailable) {
    unsubs.push(unavailable)
  }
  const unsubscribe = window.api.pty?.onExit?.((payload) => {
    retireDesktopTerminalObservation(payload.id, payload.incarnationId)
    if (payload.ptySourceDisowned !== true) {
      return
    }
    useAppStore.getState().markPtySourceDisowned(payload.id)
  })
  if (unsubscribe) {
    unsubs.push(unsubscribe)
  }
}
