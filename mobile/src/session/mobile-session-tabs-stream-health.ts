import { runSessionTabsListRequest } from './mobile-session-tabs-list-request'
import { startSessionTabsRequestCohort } from './mobile-session-tabs-request-cohort'
import type { RpcResponse } from '../transport/types'
import {
  createMobilePresentationSource,
  type MobilePresentationSource
} from '../terminal/terminal-presentation'

export type {
  SessionTabsApplyOutcome,
  SessionTabsStreamSource
} from './mobile-session-tabs-stream-contract'
import type {
  SessionTabsApplyOutcome,
  SessionTabsStreamSource,
  StreamHealth,
  RequestOwner,
  RequestCohort,
  ControllerOptions,
  StreamSubscription
} from './mobile-session-tabs-stream-contract'

export class MobileSessionTabsStreamHealth<Result, Tab> {
  private readonly inFlight = new Map<string, RequestCohort>()
  private generation: number
  private barrier = 0
  private subscriptionEpoch = 0
  private requirementRevision = 0
  private satisfiedRevision = 0
  private applicationRevision = 0
  private health: StreamHealth = 'probing'
  private snapshotSeen = false
  private reconciliationActive = false
  private disposed = false
  private presentationSource: MobilePresentationSource
  private readonly stopPresentationContact: () => void

  constructor(private readonly options: ControllerOptions<Result, Tab>) {
    this.generation = this.readGeneration()
    this.applicationRevision = this.readApplicationRevision()
    this.presentationSource = createMobilePresentationSource(options.client, options.scope)
    this.stopPresentationContact = options.client.onStateChange(() => {
      if (this.disposed) {
        return
      }
      if (options.client.getState() !== 'connected') {
        this.presentationSource.dispose()
        this.invalidateStream('probing')
      } else {
        this.syncGeneration()
      }
    })
  }

  requestReconciliation(): Promise<void> {
    this.syncGeneration()
    this.requirementRevision += 1
    return this.startCurrentRequest()
  }

  ensureReconciliation(): Promise<void> {
    this.syncGeneration()
    if (this.requirementRevision <= this.satisfiedRevision) {
      this.requirementRevision += 1
    }
    return this.startCurrentRequest()
  }

  requestPendingRecovery(): Promise<void> {
    if (!this.options.hasRecoveryNeed()) {
      return Promise.resolve()
    }
    return this.requestReconciliation()
  }

  retryReconciliation(): Promise<void> {
    this.syncGeneration()
    const currentRequest = this.inFlight.get(`${this.generation}:${this.barrier}`)
    if (currentRequest?.retry) {
      return currentRequest.promise
    }
    this.requirementRevision += 1
    this.barrier += currentRequest ? 1 : 0
    return this.startCurrentRequest(true)
  }

  poll(): Promise<void> | null {
    this.syncGeneration()
    if (!this.reconciliationActive) {
      return null
    }
    const recoveryNeeded = this.options.hasRecoveryNeed()
    if (this.health === 'live') {
      if (!recoveryNeeded && this.requirementRevision <= this.satisfiedRevision) {
        return null
      }
      const currentRequest = this.inFlight.get(`${this.generation}:${this.barrier}`)
      if (currentRequest) {
        return currentRequest.promise
      }
      if (recoveryNeeded && this.options.allowRecoveryPoll?.() === false) {
        return null
      }
    }
    return this.ensureReconciliation()
  }

  setReconciliationActive(active: boolean): void {
    this.reconciliationActive = active
  }

  beginSubscription(): StreamSubscription {
    this.syncGeneration()
    const epoch = ++this.subscriptionEpoch
    this.presentationSource.dispose()
    this.presentationSource = createMobilePresentationSource(
      this.options.client,
      this.options.scope
    )
    this.invalidateStream('probing')
    return {
      listener: (payload, metadata) => {
        if (this.disposed || epoch !== this.subscriptionEpoch) {
          return
        }
        this.handleStreamPayload(payload, epoch, metadata)
      },
      cancel: () => {
        if (epoch === this.subscriptionEpoch) {
          this.subscriptionEpoch += 1
          this.invalidateStream('degraded')
        }
      }
    }
  }

  isCertified(): boolean {
    this.syncGeneration()
    return this.health === 'live'
  }

  dispose(): void {
    this.disposed = true
    this.subscriptionEpoch += 1
    this.stopPresentationContact()
    this.presentationSource.dispose()
  }

  private handleStreamPayload(
    payload: unknown,
    epoch: number,
    metadata?: RpcResponse['_meta']
  ): void {
    this.syncGeneration()
    const child = this.presentationSource
    const generation = this.generation
    const admitted = () =>
      epoch === this.subscriptionEpoch &&
      this.isCurrentGeneration(generation) &&
      this.presentationSource === child &&
      child.current()
    if (!admitted()) {
      return
    }
    if (!payload || typeof payload !== 'object') {
      return
    }
    const event = payload as Result & { type?: string }
    if (event.type === 'snapshot') {
      this.invalidateStream('probing')
      this.snapshotSeen = true
      const outcome = this.applyCurrent(event, 'stream', child, metadata, admitted)
      if (outcome.accepted && admitted()) {
        this.startCurrentRequest()
      }
      return
    }
    if (event.type === 'updated') {
      const capturedRequirement = this.requirementRevision
      const ownerGeneration = this.generation
      const outcome = this.applyCurrent(event, 'stream', child, metadata, admitted)
      if (!outcome.accepted || !this.isCurrentGeneration(ownerGeneration) || !admitted()) {
        return
      }
      this.health = 'live'
      this.satisfiedRevision = Math.max(this.satisfiedRevision, capturedRequirement)
      this.startTrailingRequest()
      return
    }
    if (event.type === 'error' || event.type === 'end') {
      this.invalidateStream('degraded')
      this.startCurrentRequest()
    }
  }

  private applyCurrent(
    result: Result,
    source: SessionTabsStreamSource,
    presentationSource: Pick<MobilePresentationSource, 'apply'>,
    metadata?: RpcResponse['_meta'],
    admitted = () => true
  ): SessionTabsApplyOutcome<Tab> {
    const generation = this.generation
    const outcome = this.options.apply(result)
    if (!outcome.accepted || !this.isCurrentGeneration(generation) || !admitted()) {
      return { accepted: false }
    }
    this.applicationRevision =
      outcome.applicationRevision === undefined
        ? this.applicationRevision + 1
        : Math.max(this.applicationRevision, outcome.applicationRevision)
    presentationSource.apply(outcome.effectiveTabs, metadata)
    if (!admitted()) {
      return { accepted: false }
    }
    this.options.consumeAccepted(result, outcome.effectiveTabs, source)
    return admitted() ? outcome : { accepted: false }
  }

  private invalidateStream(health: Exclude<StreamHealth, 'live'>): void {
    if (health === 'degraded') {
      this.presentationSource.dispose()
      this.presentationSource = createMobilePresentationSource(
        this.options.client,
        this.options.scope
      )
    }
    this.barrier += 1
    this.health = health
    this.snapshotSeen = false
    this.requirementRevision += 1
  }

  private startCurrentRequest(retry = false): Promise<void> {
    if (this.disposed || !this.reconciliationActive) {
      return Promise.resolve()
    }
    const key = `${this.generation}:${this.barrier}`
    return startSessionTabsRequestCohort(
      this.inFlight,
      key,
      retry,
      () =>
        this.runRequest({
          generation: this.generation,
          barrier: this.barrier,
          requirement: this.requirementRevision,
          applicationRevision: this.readApplicationRevision()
        }),
      () =>
        key === `${this.generation}:${this.barrier}` &&
        this.reconciliationActive &&
        this.requirementRevision > this.satisfiedRevision
    )
  }

  private runRequest(owner: RequestOwner): Promise<boolean> {
    try {
      return runSessionTabsListRequest(owner, this.options, this.presentationSource.capture(), {
        isCurrentGeneration: (generation) => this.isCurrentGeneration(generation),
        barrier: () => this.barrier,
        readApplicationRevision: () => this.readApplicationRevision(),
        applyCurrent: (result, source, delivery, metadata) =>
          this.applyCurrent(result, source, delivery, metadata),
        accept: (requirement) => {
          this.satisfiedRevision = Math.max(this.satisfiedRevision, requirement)
          if (this.snapshotSeen) {
            this.health = 'live'
          }
        }
      })
    } catch (error) {
      return Promise.reject(error)
    }
  }

  private startTrailingRequest(): void {
    if (
      !this.disposed &&
      this.reconciliationActive &&
      this.requirementRevision > this.satisfiedRevision &&
      !this.inFlight.has(`${this.generation}:${this.barrier}`)
    ) {
      void this.startCurrentRequest()
    }
  }

  private syncGeneration(): void {
    if (this.disposed) {
      return
    }
    const generation = this.readGeneration()
    if (this.options.client.getState() !== 'connected') {
      return
    }
    if (generation === this.generation && this.presentationSource.current()) {
      return
    }
    this.generation = generation
    this.presentationSource.dispose()
    this.presentationSource = createMobilePresentationSource(
      this.options.client,
      this.options.scope
    )
    this.invalidateStream('probing')
  }

  private isCurrentGeneration(generation: number): boolean {
    return !this.disposed && generation === this.generation && generation === this.readGeneration()
  }

  private readGeneration(): number {
    return this.options.client.getGeneration?.() ?? 0
  }

  private readApplicationRevision(): number {
    return Math.max(this.applicationRevision, this.options.getApplicationRevision?.() ?? 0)
  }
}
