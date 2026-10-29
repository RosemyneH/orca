import type {
  PtyProcessInspection,
  PtyProcessInspectionOptions
} from '../providers/pty-process-inspection'
import { admitRemoteForegroundEvidence } from '../../shared/remote-foreground-evidence-admission'
import { parseAppSshPtyId } from '../../shared/ssh-pty-id'
import type { RemoteForegroundEvidence } from '../../shared/foreground-process-evidence'
import type { TerminalForegroundPresentation } from '../../shared/terminal-foreground-presentation'
import type { RuntimePtyController } from './runtime-pty-controller-contract'
import type { RuntimePtyWorktreeRecord } from './runtime-terminal-state-records'
export type ForegroundPresentationDependencies = {
  getController(): RuntimePtyController | null
  getPty(ptyId: string): RuntimePtyWorktreeRecord | null
  touchSnapshot(ptyId: string): void
  finishDelayedSnapshot(ptyId: string, changed: boolean): void
}

export type ForegroundSourceAdmissions = Map<
  string,
  { incarnation: string; evidence: RemoteForegroundEvidence; generations: Set<string> }
>
export function acceptPtyForegroundPresentation(
  deps: ForegroundPresentationDependencies,
  sourceAdmissions: ForegroundSourceAdmissions,
  pty: RuntimePtyWorktreeRecord | null,
  controller: RuntimePtyController,
  incarnation: string | null | undefined,
  state: TerminalForegroundPresentation | undefined,
  support: 'supported' | 'legacy',
  startedAt: number,
  evidence: RemoteForegroundEvidence | undefined,
  publish: boolean,
  current: () => boolean,
  nextVersion: () => number
) {
  if (
    !current() ||
    !pty ||
    !incarnation ||
    deps.getPty(pty.ptyId) !== pty ||
    deps.getController() !== controller ||
    pty.incarnationId !== incarnation ||
    (!pty.connected && state !== 'gone')
  ) {
    return undefined
  }
  if (pty.connectionId && support === 'supported') {
    const prior = sourceAdmissions.get(pty.ptyId)
    const current = prior?.incarnation === incarnation ? prior : undefined
    const admitted = admitRemoteForegroundEvidence(evidence, {
      expectedPtyId: parseAppSshPtyId(pty.ptyId)?.relayPtyId ?? pty.ptyId,
      expectedIncarnationId: incarnation,
      requestStartedAtMonotonic: startedAt,
      receivedAtMonotonic: performance.now(),
      lastAuthorityGeneration: current?.evidence.authorityGeneration ?? null,
      lastObservationEpoch: current?.evidence.observationEpoch ?? -1,
      knownAuthorityGenerations: current?.generations
    })
    if (!admitted || admitted.verdict === 'unverifiable') {
      return undefined
    }
    const generations = current?.generations ?? new Set<string>()
    generations.add(admitted.authorityGeneration)
    sourceAdmissions.set(pty.ptyId, { incarnation, evidence: admitted, generations })
  }
  if (support === 'legacy' && pty.presentation?.support === 'supported') {
    return undefined
  }
  const commit = (effective: typeof state, notify = true) => {
    if (
      !current() ||
      deps.getPty(pty.ptyId) !== pty ||
      deps.getController() !== controller ||
      pty.incarnationId !== incarnation
    ) {
      return undefined
    }
    if (
      pty.presentation?.incarnationId !== incarnation ||
      pty.presentation.state !== effective ||
      pty.presentation.support !== support
    ) {
      pty.presentation = {
        state: effective,
        support,
        incarnationId: incarnation,
        version: nextVersion()
      }
      if (notify) {
        deps.touchSnapshot(pty.ptyId)
      }
    }
    return pty.presentation
  }
  return commit(state, publish)
}

export async function confirmPtyForegroundPresentation(
  deps: ForegroundPresentationDependencies,
  sourceAdmissions: ForegroundSourceAdmissions,
  ptyId: string,
  current: () => boolean,
  nextVersion: () => number
) {
  const controller = deps.getController()
  const pty = deps.getPty(ptyId)
  const incarnation = pty?.incarnationId
  let state: TerminalForegroundPresentation | null | undefined
  let supported = false
  const startedAt = performance.now()
  const foregroundProcess =
    (await controller?.confirmForegroundProcess?.(ptyId, (value) => {
      supported = true
      state = value
    })) ?? null
  const presentation =
    controller && supported
      ? acceptPtyForegroundPresentation(
          deps,
          sourceAdmissions,
          pty,
          controller,
          incarnation,
          state ?? undefined,
          state === null ? 'legacy' : 'supported',
          startedAt,
          undefined,
          true,
          current,
          nextVersion
        )
      : undefined
  return { foregroundProcess, presentation }
}

export type ForegroundInspectionEntry = {
  controller: RuntimePtyController
  options?: PtyProcessInspectionOptions
  lease: object
  incarnation: string | null | undefined
  promise: Promise<PtyProcessInspection>
}
