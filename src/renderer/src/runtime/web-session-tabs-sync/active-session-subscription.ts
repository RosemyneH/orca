import { createActiveSessionSnapshotApplier } from './active-session-snapshot'
import {
  createDesktopPresentationSource,
  retractDesktopPresentations
} from '../terminal-foreground-presentation'
import { useAppStore } from '../../store'
import { mirroredRuntimeEnvironmentIdForWorkspace } from './mirrored-workspace-owner'
import { getRuntimeEnvironmentRevision } from '../runtime-environment-revision'
import { installWindowVisibilitySubscriptionParking } from '../window-visibility-subscription-parking'
import { recordReceivedWebSessionTabsSnapshot } from './tracking'
import { shouldSyncRuntimeSessionTabs } from './tracking-decisions'
import { getWebSessionTabsTrackingGeneration } from './tracking-lifecycle'
import {
  acceptSessionTabsRuntimeId,
  getSessionTabsRuntimeIdFromResponse
} from './publisher-identity-fences'
import { createInitialTerminalSeeder } from './initial-terminal-seeder'
import { toRuntimeWorktreeSelector } from '../runtime-worktree-selector'
import { isSessionTabsStreamEnd, type SessionTabsStreamEvent } from './state'
import { subscribeRuntimeEnvironment } from '../runtime-environment-pairing-refresh'

export type {
  ActiveSubscriptionArgs,
  ActiveSessionTabsSubscription
} from './visibility-resume-types'
import type {
  ActiveSubscriptionArgs,
  ActiveSessionTabsSubscription
} from './visibility-resume-types'

export function installActiveSessionTabsSubscription({
  activeWorktreeId,
  activeWorktreeRuntimeEnvironmentId,
  activeWorktreeRuntimeConnectionGeneration,
  activeWorktreeRuntimePairingRevision,
  workspaceSessionReady,
  visibilitySnapshotReceipt,
  visibilitySnapshotApply,
  visibilitySnapshotAccepted
}: ActiveSubscriptionArgs): ActiveSessionTabsSubscription | undefined {
  const environmentId = activeWorktreeRuntimeEnvironmentId?.trim()
  if (
    !shouldSyncRuntimeSessionTabs({
      activeWorktreeId,
      activeWorktreeRuntimeEnvironmentId,
      workspaceSessionReady
    }) ||
    !environmentId ||
    !activeWorktreeId
  ) {
    return undefined
  }
  const expectedTrackingGeneration = getWebSessionTabsTrackingGeneration(environmentId)
  // Warm streams outlive selection; seed only the selected worktree on this host because IDs can collide across hosts.
  const isSelected = (): boolean => {
    const state = useAppStore.getState()
    return (
      state.activeWorktreeId === activeWorktreeId &&
      mirroredRuntimeEnvironmentIdForWorkspace(state, activeWorktreeId) === environmentId
    )
  }
  const seeder = createInitialTerminalSeeder(environmentId, activeWorktreeId)
  const applyActiveSnapshot = createActiveSessionSnapshotApplier({
    activeWorktreeId,
    environmentId,
    activeWorktreeRuntimeConnectionGeneration,
    activeWorktreeRuntimePairingRevision,
    visibilitySnapshotApply,
    visibilitySnapshotAccepted,
    expectedTrackingGeneration,
    seeder,
    isSelected
  })

  const parking = installWindowVisibilitySubscriptionParking([
    {
      subscribe: (isCurrent, { ended }) => {
        const presentationSource = createDesktopPresentationSource(
          environmentId,
          `active:${activeWorktreeId}`,
          isCurrent
        )
        return subscribeRuntimeEnvironment(
          {
            selector: environmentId,
            method: 'session.tabs.subscribe',
            params: { worktree: toRuntimeWorktreeSelector(activeWorktreeId) },
            timeoutMs: 15_000,
            expectedEnvironmentPairingRevision: activeWorktreeRuntimePairingRevision
          },
          {
            onResponse: (response) => {
              if (
                !isCurrent() ||
                getRuntimeEnvironmentRevision(environmentId) !==
                  activeWorktreeRuntimePairingRevision
              ) {
                return
              }
              if (response.ok === false) {
                console.warn('[web-session-tabs-sync] subscription failed:', response.error.message)
                presentationSource.dispose()
                ended()
                return
              }
              if (isSessionTabsStreamEnd(response.result)) {
                presentationSource.dispose()
                ended()
                return
              }
              const event = response.result as SessionTabsStreamEvent
              if (event.type !== 'snapshot' && event.type !== 'updated') {
                return
              }
              const runtimeId = getSessionTabsRuntimeIdFromResponse(response)
              if (runtimeId && !acceptSessionTabsRuntimeId(environmentId, runtimeId)) {
                return
              }
              const frame = recordReceivedWebSessionTabsSnapshot(
                environmentId,
                event,
                undefined,
                runtimeId
              )
              visibilitySnapshotReceipt.current(environmentId, event, frame, runtimeId)
              void applyActiveSnapshot(
                event,
                response,
                isCurrent,
                frame,
                runtimeId,
                presentationSource
              )
                .catch((error) => {
                  if (isCurrent()) {
                    console.warn('[web-session-tabs-sync] active snapshot recovery failed:', error)
                  }
                  return null
                })
                .then((settle) => {
                  if (isCurrent()) {
                    settle?.()
                  }
                })
            },
            onError: (error) => {
              if (isCurrent()) {
                presentationSource.dispose()
                console.warn('[web-session-tabs-sync] subscription error:', error.message)
              }
            },
            onClose: () => {
              if (isCurrent()) {
                presentationSource.dispose()
                ended()
              }
            }
          }
        )
          .then((handle) => ({
            ...handle,
            unsubscribe: () => {
              presentationSource.dispose()
              handle.unsubscribe()
            }
          }))
          .catch((error) => {
            presentationSource.dispose()
            throw error
          })
      },
      onSubscribeError: (error) => {
        console.warn(
          '[web-session-tabs-sync] failed to subscribe:',
          error instanceof Error ? error.message : String(error)
        )
      },
      onUnsubscribeError: (error) => {
        console.warn('[web-session-tabs-sync] failed to unsubscribe:', error)
      }
    }
  ])
  return Object.assign(
    () => {
      seeder.dispose()
      retractDesktopPresentations(environmentId, undefined, `active:${activeWorktreeId}`)
      parking()
    },
    {
      restartEnded: () => parking.restartEnded(),
      reconsiderSelected: () => seeder.reconsiderSelected(isSelected())
    }
  )
}
