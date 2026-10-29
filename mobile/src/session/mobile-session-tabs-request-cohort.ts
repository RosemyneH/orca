import type { RequestCohort } from './mobile-session-tabs-stream-contract'

export function startSessionTabsRequestCohort(
  inFlight: Map<string, RequestCohort>,
  key: string,
  retry: boolean,
  runRequest: () => Promise<boolean>,
  needsDrain: () => boolean
): Promise<void> {
  const shared = inFlight.get(key)
  if (shared) {
    return shared.promise
  }
  let resolveRequest!: () => void
  const promise = new Promise<void>((resolve) => {
    resolveRequest = resolve
  })
  const cohort = { promise, resolve: resolveRequest, retry }
  inFlight.set(key, cohort)
  const run = (): void => {
    const finish = (canDrain: boolean): void => {
      if (canDrain && inFlight.get(key) === cohort && needsDrain()) {
        run()
        return
      }
      if (inFlight.get(key) === cohort) {
        inFlight.delete(key)
      }
      cohort.resolve()
    }
    void runRequest().then(finish, () => finish(false))
  }
  run()
  return promise
}
