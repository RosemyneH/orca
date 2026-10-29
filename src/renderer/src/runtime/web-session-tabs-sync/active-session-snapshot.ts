import type { DesktopPresentationSource } from '../terminal-foreground-presentation'
import type { RuntimeRpcResponse } from '../../../../shared/runtime-rpc-envelope'
import type { RuntimeMobileSessionTabsResult } from '../../../../shared/runtime-types'
import { isRuntimeSubscriptionReplayResponse } from '../../../../shared/runtime-subscription-replay'
import { useAppStore } from '../../store'
import { ORCA_LAYOUT_OWNER_IS_MAIN } from '../../../../shared/layout-owner-switch'
import { isFrameDrawnServerWorkspace } from './frame-drawn-server-workspaces'
import { recoverMirroredTerminalOrphansBeforeApply } from './mirror-terminal-orphan-recovery'
import { shouldApplyRecoveredWebSessionTabsSnapshot } from './tracking'
import {
  decideWebSessionTabsSnapshot,
  shouldRespawnWebRuntimeTerminalAfterWake
} from './tracking-decisions'
import { acceptReplayedWebSessionTabsSnapshot } from './tracking-lifecycle'
import { applyWebSessionTabsSnapshot } from './snapshot-api'
import { applyWebSessionTabsStorePatch } from './store-patch'
import {
  hostSessionMirrorSettleForPatchlessFrame,
  type HostSessionMirrorSettle
} from './mirror-settle'
import {
  beginWebRuntimeWakeTerminalRespawn,
  endWebRuntimeWakeTerminalRespawn,
  shouldSkipWebRuntimeWakeTerminalRespawn
} from '../web-runtime-wake-terminal-respawn'
import { createWebRuntimeSessionTerminal } from '../web-runtime-terminal-creation'
import { releaseWebRuntimeInitialTerminalBootstrapOnMirrorFrame } from '../web-runtime-initial-terminal-bootstrap'
import type { createInitialTerminalSeeder } from './initial-terminal-seeder'
import { hostSnapshotAffirmsWorktreeContents } from '../host-session-snapshot-authority'
import type { SessionTabsStreamEvent } from './state'
import type { ActiveSubscriptionArgs } from './visibility-resume-types'
type SnapshotApplierArgs = Pick<
  ActiveSubscriptionArgs,
  | 'activeWorktreeRuntimeConnectionGeneration'
  | 'activeWorktreeRuntimePairingRevision'
  | 'visibilitySnapshotApply'
  | 'visibilitySnapshotAccepted'
> & {
  activeWorktreeId: string
  environmentId: string
  expectedTrackingGeneration: number
  seeder: ReturnType<typeof createInitialTerminalSeeder>
  isSelected: () => boolean
}
export function createActiveSessionSnapshotApplier({
  activeWorktreeId,
  environmentId,
  activeWorktreeRuntimeConnectionGeneration,
  activeWorktreeRuntimePairingRevision,
  visibilitySnapshotApply,
  visibilitySnapshotAccepted,
  expectedTrackingGeneration,
  seeder,
  isSelected
}: SnapshotApplierArgs) {
  let requestedRespawnAfterWake = false
  let hostAffirmedWorktree = false

  const applyActiveSnapshot = async (
    event: RuntimeMobileSessionTabsResult & { type: 'snapshot' | 'updated' },
    response: RuntimeRpcResponse<unknown>,
    isCurrent: () => boolean,
    receivedFrame: number,
    runtimeId?: string,
    presentationSource?: DesktopPresentationSource
  ): Promise<HostSessionMirrorSettle | null> => {
    const presentationDelivery = presentationSource?.capture(event)
    try {
      const recovered = await recoverMirroredTerminalOrphansBeforeApply(
        useAppStore.getState(),
        event,
        environmentId,
        {
          expectedEnvironmentPairingRevision: activeWorktreeRuntimePairingRevision,
          getCurrentState: () => useAppStore.getState()
        }
      )
      if (
        !isCurrent() ||
        !recovered ||
        !shouldApplyRecoveredWebSessionTabsSnapshot(
          environmentId,
          recovered,
          receivedFrame,
          runtimeId
        ) ||
        !visibilitySnapshotApply.current(environmentId, recovered, receivedFrame, runtimeId)
      ) {
        return null
      }
      if (event.type === 'snapshot' || isRuntimeSubscriptionReplayResponse(response)) {
        acceptReplayedWebSessionTabsSnapshot(environmentId, recovered.worktree)
      }
      const recoveredEvent: SessionTabsStreamEvent = { ...recovered, type: event.type }
      const decision = decideWebSessionTabsSnapshot(recovered, environmentId, runtimeId)
      const syncState = useAppStore.getState()
      const localTabs = syncState.tabsByWorktree[activeWorktreeId] ?? []
      const hasLiveLocalPty = localTabs.some(
        (tab) => (syncState.ptyIdsByTabId[tab.id] ?? []).length > 0
      )
      const firstHostAnswer = !hostAffirmedWorktree
      const bootstrap = decision.apply && seeder.decide(recoveredEvent, firstHostAnswer)
      const respawn = shouldRespawnWebRuntimeTerminalAfterWake({
        event: recoveredEvent,
        activeWorktreeId,
        requestedRespawnAfterWake,
        snapshotIsFresh: decision.apply,
        localTerminalCount: localTabs.length,
        hasLiveLocalPty,
        skipWakeRespawn:
          shouldSkipWebRuntimeWakeTerminalRespawn(activeWorktreeId) ||
          // Switch point: ORCA_LAYOUT_OWNER_IS_MAIN && — a frame-drawn workspace's terminals are not the mirror's to respawn.
          // Interim (ledger L240): respawn stays only for servers without `layout.intents.v1`, until Phase 2.
          (ORCA_LAYOUT_OWNER_IS_MAIN &&
            isFrameDrawnServerWorkspace(environmentId, activeWorktreeId))
      })
      let settle: HostSessionMirrorSettle | null = decision.apply
        ? null
        : hostSessionMirrorSettleForPatchlessFrame(decision, environmentId, recovered.worktree, {
            connectionGeneration: activeWorktreeRuntimeConnectionGeneration,
            pairingRevision: activeWorktreeRuntimePairingRevision,
            trackingGeneration: expectedTrackingGeneration
          })
      if (decision.apply) {
        hostAffirmedWorktree ||= hostSnapshotAffirmsWorktreeContents(recovered)
        const replayed = isRuntimeSubscriptionReplayResponse(response)
        settle = applyWebSessionTabsStorePatch(
          (state) => applyWebSessionTabsSnapshot(state, recovered, environmentId),
          {
            frames: [
              {
                environmentId,
                worktreeId: recovered.worktree,
                source: recovered,
                presentationSource: presentationDelivery,
                decision,
                expectedEnvironmentConnectionGeneration: activeWorktreeRuntimeConnectionGeneration,
                expectedEnvironmentPairingRevision: activeWorktreeRuntimePairingRevision,
                expectedTrackingGeneration
              }
            ]
          },
          recovered,
          event.type === 'updated' && !replayed
        )
        visibilitySnapshotAccepted.current(environmentId, recovered, receivedFrame, runtimeId)
        // Applied frames release awaiting-mirror only after seeding checked the held latch; pending RPCs retain claims and later frames decide retries.
        releaseWebRuntimeInitialTerminalBootstrapOnMirrorFrame(environmentId, recovered.worktree)
      }
      if (decision.apply && isCurrent()) {
        // Warm streams may answer empty only while unselected; redecide on selection.
        seeder.noteAppliedFrame(
          bootstrap ? { event: recoveredEvent, firstHostAnswer, receivedFrame, runtimeId } : null,
          isSelected()
        )
      }
      try {
        if (isCurrent() && isSelected() && bootstrap) {
          await seeder.seed()
        } else if (
          isCurrent() &&
          isSelected() &&
          respawn &&
          beginWebRuntimeWakeTerminalRespawn(activeWorktreeId)
        ) {
          requestedRespawnAfterWake = true
          await createWebRuntimeSessionTerminal({
            worktreeId: activeWorktreeId,
            environmentId,
            activate: true,
            selectWorktree: false
          }).finally(() => endWebRuntimeWakeTerminalRespawn(activeWorktreeId))
        }
      } catch (error) {
        if (isCurrent()) {
          console.warn('[web-session-tabs-sync] snapshot follow-up failed:', error)
        }
      }
      return settle
    } finally {
      presentationDelivery?.dispose()
    }
  }

  return applyActiveSnapshot
}
