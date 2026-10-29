import type { RpcFailure, RpcResponse } from '../transport/types'
import type { MobilePresentationDelivery } from '../terminal/terminal-presentation'
import { sessionTabsListRead } from './mobile-session-read-operations'
import type {
  RequestOwner,
  ControllerOptions,
  SessionTabsApplyOutcome
} from './mobile-session-tabs-stream-contract'

type ListRequestApplication<Result, Tab> = {
  isCurrentGeneration: (generation: number) => boolean
  barrier: () => number
  readApplicationRevision: () => number
  applyCurrent: (
    result: Result,
    source: 'list',
    delivery: MobilePresentationDelivery,
    metadata?: RpcResponse['_meta']
  ) => SessionTabsApplyOutcome<Tab>
  accept: (requirement: number) => void
}
export async function runSessionTabsListRequest<Result, Tab>(
  owner: RequestOwner,
  options: ControllerOptions<Result, Tab>,
  presentationSource: MobilePresentationDelivery,
  application: ListRequestApplication<Result, Tab>
): Promise<boolean> {
  try {
    options.onFetchStarted?.()
    const response = await sessionTabsListRead.request(options.client, {
      worktree: options.scope
    })
    if (!application.isCurrentGeneration(owner.generation)) {
      return false
    }
    if (!response.ok) {
      if (owner.barrier === application.barrier()) {
        options.onFetchFailed?.(response as RpcFailure)
      }
      return false
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the snapshot's shape is the owner's type parameter, which no module-level reader can name.
    const result = sessionTabsListRead.interpret(response) as Result
    if (owner.barrier !== application.barrier()) {
      return false
    }
    if (owner.applicationRevision !== application.readApplicationRevision()) {
      return false
    }
    options.onFetchSucceeded?.(result)
    const outcome = application.applyCurrent(result, 'list', presentationSource, response._meta)
    if (!outcome.accepted || !application.isCurrentGeneration(owner.generation)) {
      return false
    }
    application.accept(owner.requirement)
    return true
  } catch (error) {
    if (
      application.isCurrentGeneration(owner.generation) &&
      owner.barrier === application.barrier()
    ) {
      options.onFetchErrored?.(error)
    }
    return false
  } finally {
    presentationSource.dispose()
  }
}
