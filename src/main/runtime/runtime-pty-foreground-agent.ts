import { RuntimePtyAgentIdentification } from './runtime-pty-agent-identification'
import { subscribeToPtyEndpointLoss } from './terminal/pty-endpoint-loss-signal'
import {
  acceptPtyForegroundPresentation,
  confirmPtyForegroundPresentation,
  type ForegroundPresentationDependencies,
  type ForegroundInspectionEntry,
  type ForegroundSourceAdmissions
} from './runtime-pty-foreground-presentation'
import type { TerminalForegroundPresentation } from '../../shared/terminal-foreground-presentation'
import type {
  PtyProcessInspection,
  PtyProcessInspectionOptions
} from '../providers/pty-process-inspection'
import type {
  PtyForegroundAgentRefresh,
  PtyForegroundProcessRead,
  PtyForegroundProcessReadEntry
} from './runtime-terminal-contracts'

type PresentationLease = { current: () => boolean; dispose: () => void }
type PresentationRead = PtyForegroundProcessReadEntry & { lease: PresentationLease }

export class RuntimePtyForegroundAgent {
  private readonly refreshes = new Map<string, PtyForegroundAgentRefresh>()
  private readonly reads = new Map<string, PresentationRead>()
  private readonly delayedTitles = new Map<string, number>()
  private readonly inspections = new Map<string, ForegroundInspectionEntry>()
  private readonly identification: RuntimePtyAgentIdentification
  constructor(private readonly deps: ForegroundPresentationDependencies) {
    this.identification = new RuntimePtyAgentIdentification(deps, (ptyId, afterTitle) =>
      this.read(ptyId, afterTitle)
    )
  }

  private readonly sourceAdmissions: ForegroundSourceAdmissions = new Map()
  private readonly leases = new Map<string, PresentationLease>()
  private version = 0
  private readonly nextVersion = () => ++this.version

  private lease(ptyId: string): PresentationLease {
    const pty = this.deps.getPty(ptyId)
    const controller = this.deps.getController()
    if (!pty) {
      return { current: () => false, dispose: () => {} }
    }
    const incarnation = pty.incarnationId
    const existing = this.leases.get(ptyId)
    if (existing?.current()) {
      return existing
    }
    if (existing) {
      this.forget(ptyId)
    }
    const lease: PresentationLease = {
      current: () =>
        this.leases.get(ptyId) === lease &&
        this.deps.getPty(ptyId) === pty &&
        this.deps.getController() === controller &&
        pty?.incarnationId === incarnation,
      dispose: subscribeToPtyEndpointLoss(ptyId, () => {
        if (!lease.current()) {
          return
        }
        this.forget(ptyId)
        this.deps.touchSnapshot(ptyId)
      })
    }
    this.leases.set(ptyId, lease)
    return lease
  }

  inspect(ptyId: string, options?: PtyProcessInspectionOptions): Promise<PtyProcessInspection> {
    const controller = this.deps.getController()
    if (!controller?.inspectProcess) {
      return Promise.resolve({ foregroundProcess: null, hasChildProcesses: true })
    }
    const pty = this.deps.getPty(ptyId)
    const incarnation = pty?.incarnationId
    const lease = this.lease(ptyId)
    const pending = this.inspections.get(ptyId)
    if (
      pending?.lease === lease &&
      pending.controller === controller &&
      pending.incarnation === incarnation &&
      pending.options?.steadyState === options?.steadyState &&
      pending.options?.expectedIncarnationId === options?.expectedIncarnationId &&
      pending.options?.ignoreDetached === options?.ignoreDetached &&
      pending.options?.scanChildProcesses === options?.scanChildProcesses
    ) {
      return pending.promise
    }
    const startedAt = performance.now()
    const promise = controller
      .inspectProcess(ptyId, { ...options, includePresentation: true })
      .then((result) => {
        if (
          !lease.current() ||
          result.verdict === 'unverifiable' ||
          (options?.expectedIncarnationId && options.expectedIncarnationId !== incarnation)
        ) {
          return result
        }
        const presentation = acceptPtyForegroundPresentation(
          this.deps,
          this.sourceAdmissions,
          pty,
          controller,
          incarnation,
          result.foregroundPresentation,
          result.foregroundPresentationSupported ? 'supported' : 'legacy',
          startedAt,
          result.foregroundProcessEvidence,
          true,
          lease.current,
          this.nextVersion
        )
        return { ...result, presentation }
      })
    const entry = { controller, promise, incarnation, options, lease }
    this.inspections.set(ptyId, entry)
    void promise
      .finally(() => {
        if (this.inspections.get(ptyId) === entry) {
          this.inspections.delete(ptyId)
        }
      })
      .catch(() => {})
    return promise
  }

  confirmPresentation(ptyId: string) {
    return confirmPtyForegroundPresentation(
      this.deps,
      this.sourceAdmissions,
      ptyId,
      this.lease(ptyId).current,
      this.nextVersion
    )
  }

  read(ptyId: string, afterTitle = 0): Promise<PtyForegroundProcessRead> | null {
    const controller = this.deps.getController()
    if (!controller) {
      return null
    }
    const lease = this.lease(ptyId)
    const pending = this.reads.get(ptyId)
    if (
      pending?.lease === lease &&
      pending.controller === controller &&
      pending.startedAfterTitleObservation >= afterTitle
    ) {
      return pending.promise
    }
    if (pending?.lease === lease && pending.controller === controller) {
      return pending.promise.then(
        () =>
          (lease.current() ? this.read(ptyId, afterTitle) : null) ?? {
            controller,
            process: null,
            available: false
          }
      )
    }
    const unavailable: PtyForegroundProcessRead = { controller, process: null, available: false }
    const pty = this.deps.getPty(ptyId)
    const incarnation = pty?.incarnationId
    let foregroundPresentation: TerminalForegroundPresentation | null | undefined
    let annotated = false
    const startedAt = performance.now()
    let processRead: Promise<string | null>
    try {
      processRead = Promise.resolve(
        controller.getForegroundProcess(ptyId, (value) => {
          foregroundPresentation = value
          annotated = true
        })
      )
    } catch {
      const entry: PresentationRead = {
        lease,
        controller,
        startedAfterTitleObservation: afterTitle,
        promise: Promise.resolve(unavailable)
      }
      entry.promise = entry.promise.finally(() => this.deleteRead(ptyId, entry))
      this.reads.set(ptyId, entry)
      return entry.promise
    }
    let entry: PresentationRead
    const promise = processRead
      .then((process) => {
        if (annotated) {
          acceptPtyForegroundPresentation(
            this.deps,
            this.sourceAdmissions,
            pty,
            controller,
            incarnation,
            foregroundPresentation ?? undefined,
            foregroundPresentation === null ? 'legacy' : 'supported',
            startedAt,
            undefined,
            !this.refreshes.has(ptyId),
            lease.current,
            this.nextVersion
          )
        }
        return { controller, process, available: true }
      })
      .catch(() => unavailable)
      .finally(() => this.deleteRead(ptyId, entry))
    entry = { controller, startedAfterTitleObservation: afterTitle, promise, lease }
    this.reads.set(ptyId, entry)
    return entry.promise
  }

  refresh(ptyId: string, afterTitle = 0): Promise<boolean> {
    const pending = this.refreshes.get(ptyId)
    if (pending) {
      pending.requestedAfterTitleObservation = Math.max(
        pending.requestedAfterTitleObservation,
        afterTitle
      )
      return pending.promise
    }
    const entry: PtyForegroundAgentRefresh = {
      promise: Promise.resolve(false),
      startedAfterTitleObservation: afterTitle,
      requestedAfterTitleObservation: afterTitle
    }
    entry.promise = (async () => {
      while (true) {
        entry.startedAfterTitleObservation = entry.requestedAfterTitleObservation
        const changed = await this.identification.load(ptyId, entry.startedAfterTitleObservation)
        if (
          this.refreshes.get(ptyId) !== entry ||
          changed ||
          entry.requestedAfterTitleObservation <= entry.startedAfterTitleObservation
        ) {
          return changed
        }
      }
    })().finally(() => {
      if (this.refreshes.get(ptyId) === entry) {
        this.refreshes.delete(ptyId)
      }
    })
    this.refreshes.set(ptyId, entry)
    return entry.promise
  }

  identifyUnowned(ptyId: string, isCandidate: () => boolean) {
    return this.identification.identifyUnowned(ptyId, isCandidate)
  }

  getPending(ptyId: string, afterTitle: number): Promise<boolean> | undefined {
    return this.refreshes.has(ptyId) ? this.refresh(ptyId, afterTitle) : undefined
  }

  getReads(): ReadonlyMap<string, PtyForegroundProcessReadEntry> {
    return this.reads
  }

  delaySnapshot(ptyId: string, titleAt: number, refresh: Promise<boolean>): void {
    this.delayedTitles.set(ptyId, titleAt)
    void refresh.then((changed) => {
      if (this.delayedTitles.get(ptyId) !== titleAt) {
        return
      }
      this.delayedTitles.delete(ptyId)
      this.deps.finishDelayedSnapshot(ptyId, changed)
    })
  }

  hasDelayedSnapshot(ptyId: string): boolean {
    return this.delayedTitles.has(ptyId)
  }

  forget(ptyId: string): void {
    this.leases.get(ptyId)?.dispose()
    this.leases.delete(ptyId)
    this.reads.delete(ptyId)
    this.refreshes.delete(ptyId)
    this.sourceAdmissions.delete(ptyId)
    const pty = this.deps.getPty(ptyId)
    if (pty) {
      pty.presentation = undefined
    }
    this.inspections.delete(ptyId)
    this.delayedTitles.delete(ptyId)
    this.identification.forget(ptyId)
  }

  private deleteRead(ptyId: string, entry: PtyForegroundProcessReadEntry): void {
    if (this.reads.get(ptyId) === entry) {
      this.reads.delete(ptyId)
    }
  }
}
