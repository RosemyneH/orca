import { createDesktopPresentationSource } from '../terminal-foreground-presentation'
import { LOCAL_STRUCTURED_SESSION_OWNER } from '../local-structured-session-owner'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'
import type { RuntimeMobileSessionTabsResult } from '../../../../shared/runtime-types'
import { refreshLocalRuntimeCapabilities } from '../local-runtime-capabilities'
import {
  isCurrentLocalStructuredSessionGeneration,
  localStructuredSessionGeneration
} from './inventory-generation-fence'
import {
  refreshLocalStructuredSessionTabs,
  restoreLocalStructuredSessionTabsOnce
} from './inventory-refresh'
import { recheckUnconfirmedStructuredAgentLaunches } from '../../lib/agent-session/launch/structured-agent-session-launch-unconfirmed-recheck'
import { scheduleRetiredEpochRepair } from './retired-epoch-repair'
import {
  applyStructuredSessionTabSnapshots,
  type StructuredSessionSnapshotApplyOptions
} from './snapshot-apply'

// Inject refresh to avoid a dependency cycle back from snapshot apply through repair.
const REPAIR_DROPPED_EPOCHS: StructuredSessionSnapshotApplyOptions = {
  onRetiredEpochDrop: (worktreeId, publicationEpoch) =>
    scheduleRetiredEpochRepair(worktreeId, publicationEpoch, (generation) =>
      refreshLocalStructuredSessionTabs(generation, { authoritative: true })
    )
}

type SessionTabsEvent =
  | (RuntimeMobileSessionTabsResult & { type: 'snapshot' | 'updated' })
  | { type: 'snapshots'; snapshots: RuntimeMobileSessionTabsResult[]; authoritative?: boolean }
  | { type: 'end' }

export async function startLocalStructuredSessionTabsSync(args: {
  isDisposed: () => boolean
  setUnsubscribe: (unsubscribe: () => void) => void
}): Promise<void> {
  const syncGeneration = localStructuredSessionGeneration()
  const isCurrent = (): boolean =>
    !args.isDisposed() && isCurrentLocalStructuredSessionGeneration(syncGeneration)
  let presentationSource = createDesktopPresentationSource(
    LOCAL_STRUCTURED_SESSION_OWNER,
    'subscription',
    isCurrent
  )
  args.setUnsubscribe(() => presentationSource.dispose())
  const initialSource = presentationSource
  let capabilities: Awaited<ReturnType<typeof refreshLocalRuntimeCapabilities>>
  try {
    capabilities = await refreshLocalRuntimeCapabilities()
  } catch (error) {
    initialSource.dispose()
    throw error
  }
  if (!isCurrent()) {
    presentationSource.dispose()
    return
  }
  const supported = capabilities.includes(STRUCTURED_AGENT_SESSION_RUNTIME_CAPABILITY)
  try {
    await restoreLocalStructuredSessionTabsOnce(syncGeneration)
  } catch (error) {
    initialSource.dispose()
    throw error
  }
  if (!isCurrent()) {
    presentationSource.dispose()
    return
  }
  if (!supported) {
    presentationSource.dispose()
    return
  }
  let subscriptionGeneration = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempt = 0
  let activeHandle: { unsubscribe: () => void } | null = null
  const scheduleSubscribeRetry = (): void => {
    if (!isCurrent() || reconnectTimer !== null) {
      return
    }
    const reconnectDelay = Math.min(250 * 2 ** reconnectAttempt, 5000)
    reconnectAttempt += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void refreshLocalStructuredSessionTabs(syncGeneration)
        .catch((error) => console.warn('[structured-session-tabs] resync failed', error))
        .finally(() => {
          if (isCurrent()) {
            void subscribeCurrent().catch((error) => {
              console.warn('[structured-session-tabs] resubscribe failed', error)
              scheduleSubscribeRetry()
            })
          }
        })
    }, reconnectDelay)
  }
  const subscribeCurrent = async (): Promise<void> => {
    if (!isCurrent()) {
      return
    }
    const generation = ++subscriptionGeneration
    presentationSource = createDesktopPresentationSource(
      LOCAL_STRUCTURED_SESSION_OWNER,
      'subscription',
      () => isCurrent() && generation === subscriptionGeneration
    )
    const capturedPresentationSource = presentationSource
    let handle: { unsubscribe: () => void } | null = null
    try {
      handle = await window.api.runtime.subscribe(
        { method: 'session.tabs.subscribeAll', params: {} },
        (response) => {
          if (!isCurrent() || generation !== subscriptionGeneration) {
            return
          }
          if (!response.ok) {
            // Streaming errors can precede handle resolution; fence that generation and retry.
            capturedPresentationSource.dispose()
            subscriptionGeneration += 1
            handle?.unsubscribe()
            if (activeHandle === handle) {
              activeHandle = null
            }
            scheduleSubscribeRetry()
            return
          }
          const event = response.result as SessionTabsEvent
          if (event.type === 'snapshots') {
            capturedPresentationSource.retain(event.snapshots.map((snapshot) => snapshot.worktree))
            applyStructuredSessionTabSnapshots(event.snapshots, undefined, {
              ...REPAIR_DROPPED_EPOCHS,
              presentationSource: capturedPresentationSource,
              authoritative: event.authoritative === true
            })
            // Each subscription opens with one census: the host is reachable again.
            recheckUnconfirmedStructuredAgentLaunches(LOCAL_EXECUTION_HOST_ID)
          } else if (event.type === 'snapshot' || event.type === 'updated') {
            applyStructuredSessionTabSnapshots([event], undefined, {
              ...REPAIR_DROPPED_EPOCHS,
              presentationSource: capturedPresentationSource
            })
          } else if (event.type === 'end' && generation === subscriptionGeneration) {
            // Reattach with one refresh so a runtime-restart boundary cannot strand stale tabs.
            capturedPresentationSource.dispose()
            subscriptionGeneration += 1
            handle?.unsubscribe()
            if (activeHandle === handle) {
              activeHandle = null
            }
            if (reconnectTimer !== null) {
              clearTimeout(reconnectTimer)
            }
            scheduleSubscribeRetry()
          }
        }
      )
    } catch (error) {
      capturedPresentationSource.dispose()
      throw error
    }
    if (!isCurrent() || generation !== subscriptionGeneration) {
      capturedPresentationSource.dispose()
      handle.unsubscribe()
    } else {
      activeHandle = handle
    }
  }
  args.setUnsubscribe(() => {
    presentationSource.dispose()
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    activeHandle?.unsubscribe()
    activeHandle = null
  })
  void subscribeCurrent().catch((error) => {
    console.warn('[structured-session-tabs] subscribe failed', error)
    scheduleSubscribeRetry()
  })
}
