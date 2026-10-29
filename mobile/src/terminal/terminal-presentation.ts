import { isTerminalPresentationObservation } from '../../../src/shared/terminal-foreground-presentation'
import type { RpcResponse } from '../transport/types'
import {
  clients,
  cacheFor,
  notify,
  retire,
  releaseOwner,
  releaseCache,
  current,
  supplier,
  ownerFor,
  accept,
  reset,
  type Client,
  type Owner,
  type MobilePresentationSource
} from './mobile-presentation-cache'
export type {
  MobilePresentationDelivery,
  MobilePresentationSource
} from './mobile-presentation-cache'
export { readMobilePresentation } from './mobile-presentation-read'
export function mobilePresentationEntry(client: Client, terminal: string) {
  return clients.get(client)?.owners.get(terminal) ?? { value: undefined }
}
export function mobilePresentationSnapshot(client: Client, terminal: string) {
  const owner = clients.get(client)?.owners.get(terminal)
  return owner?.active && owner.sources.size ? owner.value : undefined
}
export function subscribeMobilePresentation(
  client: Client,
  terminal: string,
  listener: () => void
) {
  const cache = cacheFor(client)
  const slot = cache.listeners.get(terminal) ?? new Set<() => void>()
  cache.listeners.set(terminal, slot)
  slot.add(listener)
  return () => {
    slot.delete(listener)
    if (!slot.size && cache.listeners.get(terminal) === slot) {
      cache.listeners.delete(terminal)
      const owner = cache.owners.get(terminal)
      if (owner) {
        releaseOwner(cache, terminal, owner)
      }
    }
    releaseCache(client, cache)
  }
}
export function createMobilePresentationSource(
  client: Client,
  scope: string
): MobilePresentationSource {
  clients.get(client)?.sources.get(scope)?.dispose()
  const cache = cacheFor(client)
  const replacement = cache.sources.get(scope)
  if (replacement) {
    if (replacement.current()) {
      return replacement
    }
    replacement.dispose()
    return createMobilePresentationSource(client, scope)
  }
  const contact = cache.contact
  let active = true
  type Member = { owner: Owner; retire: () => void }
  const members = new Map<string, Member>()
  const pending = new Set<() => void>()
  const source: MobilePresentationSource = {
    current: () => active && cache.sources.get(scope) === source && current(client, cache, contact),
    own(terminal, owner) {
      owner.members.add(source)
      let member = members.get(terminal)
      if (member?.owner !== owner) {
        const acquired: Member = {
          owner,
          retire: () => {
            if (members.get(terminal) === acquired) {
              members.delete(terminal)
            }
          }
        }
        owner.dispose.add(acquired.retire)
        member = acquired
      }
      members.set(terminal, member)
    },
    capture() {
      const captured = new Map(cache.owners)
      let live = true
      const dispose = () => {
        live = false
        captured.clear()
        pending.delete(dispose)
      }
      pending.add(dispose)
      return {
        dispose,
        apply: (tabs, metadata) => {
          if (live) {
            apply(tabs, metadata, captured)
          }
        }
      }
    },
    dispose() {
      if (!active) {
        return
      }
      active = false
      const disposers = [...pending]
      for (const dispose of disposers) {
        dispose()
      }
      if (cache.sources.get(scope) === source) {
        cache.sources.delete(scope)
      }
      for (const [terminal, member] of members) {
        const owner = member.owner
        owner.dispose.delete(member.retire)
        owner.sources.delete(source)
        owner.members.delete(source)
        if (owner.active && !owner.sources.size) {
          owner.value = undefined
          notify(cache, terminal)
        }
        if (owner.active) {
          releaseOwner(cache, terminal, owner)
        }
      }
      members.clear()
      releaseCache(client, cache)
    },
    apply: (tabs, metadata) => apply(tabs, metadata)
  }
  function apply(
    tabs: readonly unknown[],
    metadata?: RpcResponse['_meta'],
    captured?: ReadonlyMap<string, Owner>
  ) {
    if (!source.current()) {
      return
    }
    const retired = new Set<string>()
    for (const [terminal, owner] of captured ?? []) {
      if (!owner.active) {
        retired.add(terminal)
      }
    }
    if (!supplier(cache, metadata) || !source.current()) {
      return
    }
    const seen = new Set<string>()
    for (const tab of tabs) {
      if (!source.current()) {
        return
      }
      if (
        !tab ||
        typeof tab !== 'object' ||
        !('terminal' in tab) ||
        typeof tab.terminal !== 'string'
      ) {
        continue
      }
      const terminal = tab.terminal
      seen.add(terminal)
      if (retired.has(terminal)) {
        continue
      }
      const incarnation =
        'incarnationId' in tab && typeof tab.incarnationId === 'string' ? tab.incarnationId : null
      const value =
        'presentation' in tab &&
        isTerminalPresentationObservation(tab.presentation) &&
        tab.presentation.incarnationId === incarnation
          ? tab.presentation
          : undefined
      let owner = cache.owners.get(terminal)
      if (
        owner &&
        ((owner.incarnation && owner.incarnation !== incarnation) || (!value && cache.modern))
      ) {
        retire(cache, terminal, owner)
        if (!source.current()) {
          return
        }
        if (cache.owners.has(terminal)) {
          continue
        }
        owner = undefined
      }
      owner ??= ownerFor(cache, terminal)
      owner.incarnation = incarnation
      source.own(terminal, owner)
      if (value) {
        accept(cache, terminal, owner, value, source)
      } else {
        owner.sources.delete(source)
      }
    }
    for (const [terminal, member] of members) {
      if (!source.current()) {
        return
      } else if (!seen.has(terminal) && !retired.has(terminal)) {
        const owner = member.owner
        members.delete(terminal)
        owner.dispose.delete(member.retire)
        const visible = owner.value !== undefined && owner.sources.size > 0
        owner.sources.delete(source)
        owner.members.delete(source)
        if (owner.active && !owner.sources.size) {
          owner.value = undefined
          if (visible) {
            notify(cache, terminal)
          }
        }
        if (owner.active) {
          releaseOwner(cache, terminal, owner)
        }
      }
    }
  }
  cache.sources.set(scope, source)
  return source
}
export function acceptMobilePresentationFrame(
  client: Client,
  tabs: readonly unknown[],
  scope: string,
  metadata?: RpcResponse['_meta']
) {
  const source =
    clients.get(client)?.sources.get(scope) ?? createMobilePresentationSource(client, scope)
  source.apply(tabs, metadata)
}
export function retractMobilePresentations(client: Client, scope?: string) {
  const cache = clients.get(client)
  if (!cache) {
    return
  }
  if (scope === undefined) {
    cache.contact = null
    cache.runtimeId = undefined
    cache.modern = false
    cache.retired.clear()
    const sources = [...cache.sources.values()]
    reset(cache)
    for (const source of sources) {
      source.dispose()
    }
  } else {
    cache.sources.get(scope)?.dispose()
  }
  releaseCache(client, cache)
}
