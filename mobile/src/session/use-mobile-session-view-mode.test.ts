import { createStableLogicalRpcClient } from '../transport/stable-logical-rpc-client'
import { scopeRpcClientToExecutionHost } from '../transport/execution-host-scoped-rpc-client'
import { MobileSessionTabsStreamHealth } from './mobile-session-tabs-stream-health'
import { createFakeRpcClient } from '../mobile-web-shell/bridge-host-test-fakes'
import { useMobileNativeChatActiveResolution } from './use-mobile-native-chat-active-resolution'
import {
  acceptMobilePresentationFrame,
  createMobilePresentationSource,
  retractMobilePresentations,
  readMobilePresentation
} from '../terminal/terminal-presentation'
import type { RpcClient } from '../transport/rpc-client'
import { createElement, useRef } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadDefaultSessionView,
  readSessionViewOverridesPreference,
  updateSessionViewOverride,
  type MobileSessionView
} from '../storage/session-view-preferences'
import {
  useMobileSessionViewMode,
  type MobileSessionViewModeController
} from './use-mobile-session-view-mode'

const focusEffectRuntime = vi.hoisted(() => ({
  callback: null as null | (() => undefined | (() => void))
}))

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

vi.mock('expo-router', async () => {
  const react = await import('react')
  return {
    useFocusEffect: (cb: () => undefined | (() => void)) => {
      focusEffectRuntime.callback = cb
      react.useEffect(() => cb(), [cb])
    }
  }
})

vi.mock('react-native', () => ({ AppState: { addEventListener: () => ({ remove: vi.fn() }) } }))

vi.mock('../storage/session-view-preferences', () => ({
  loadDefaultSessionView: vi.fn(),
  readSessionViewOverridesPreference: vi.fn(),
  updateSessionViewOverride: vi.fn()
}))

describe('useMobileSessionViewMode', () => {
  let renderer: ReactTestRenderer | null = null
  let controller: MobileSessionViewModeController | null = null

  beforeEach(() => {
    vi.mocked(loadDefaultSessionView).mockReset().mockResolvedValue('terminal')
    vi.mocked(readSessionViewOverridesPreference)
      .mockReset()
      .mockResolvedValue({ overrides: new Map(), loaded: true })
    vi.mocked(updateSessionViewOverride).mockReset().mockResolvedValue(undefined)
    focusEffectRuntime.callback = null
  })

  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    controller = null
  })

  async function mount(args: {
    defaultView: MobileSessionView
    overrides?: Map<string, MobileSessionView>
  }): Promise<void> {
    vi.mocked(loadDefaultSessionView).mockResolvedValue(args.defaultView)
    vi.mocked(readSessionViewOverridesPreference).mockResolvedValue({
      overrides: args.overrides ?? new Map(),
      loaded: true
    })
    function Harness(): null {
      controller = useMobileSessionViewMode({ hostId: 'h', worktreeId: 'w' })
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it.each(['snapshot', 'authenticated-read'])(
    'applies %s quit to real preferences and keeps current manual choices',
    async (source) => {
      vi.mocked(loadDefaultSessionView).mockResolvedValue('chat')
      let generation = 1
      const physical = createFakeRpcClient({ getGeneration: () => generation })
      const client: RpcClient = {
        ...physical,
        sendRequest: vi.fn<RpcClient['sendRequest']>(async () => ({
          id: 'inspect',
          ok: true,
          result: { process: { presentation: negative } }
        }))
      }
      const negative = {
        support: 'supported' as const,
        incarnationId: 'inc',
        version: 1,
        state: 'not-in-front' as const
      }
      const tab = {
        id: 'quit',
        type: 'terminal',
        terminal: 'term-quit',
        incarnationId: 'inc',
        launchAgent: 'codex',
        presentation: source === 'snapshot' ? negative : undefined
      }
      const active: { current?: ReturnType<typeof useMobileNativeChatActiveResolution> } = {}
      let renders = 0
      function Harness(): null {
        renders++
        active.current = useMobileNativeChatActiveResolution({
          client,
          connState: 'connected',
          hostId: 'h',
          worktreeId: 'w',
          activeSessionTab: tab,
          activeSessionTabId: tab.id,
          activeHandleRef: useRef(tab.terminal),
          nativeChatTranscriptIsLocalReadable: true
        })
        return null
      }
      acceptMobilePresentationFrame(client, [tab], 'w')
      if (source === 'authenticated-read') {
        await readMobilePresentation(client, tab.terminal, tab.incarnationId)
      }
      await act(async () => {
        renderer = create(createElement(Harness))
      })
      const settled = renders
      for (const otherClient of [client, createFakeRpcClient()]) {
        await act(async () => {
          acceptMobilePresentationFrame(
            otherClient,
            [{ ...tab, terminal: 'unrelated', presentation: negative }],
            'other-workspace'
          )
        })
        expect(renders).toBe(settled)
      }
      expect(active.current?.showNativeChat).toBe(false)
      expect(updateSessionViewOverride).toHaveBeenLastCalledWith('h', 'w', 'quit', 'terminal')
      const writes = vi.mocked(updateSessionViewOverride).mock.calls.length
      await act(async () => {
        acceptMobilePresentationFrame(client, [tab], 'w')
        acceptMobilePresentationFrame(
          client,
          [{ ...tab, presentation: { ...negative, version: 2, state: 'agent-in-front' } }],
          'w'
        )
      })
      expect(active.current?.showNativeChat).toBe(false)
      expect(updateSessionViewOverride).toHaveBeenCalledTimes(writes)
      await act(async () => {
        active.current!.setTabView('quit', 'chat')
      })
      expect(active.current?.showNativeChat).toBe(true)
      await act(async () => {
        retractMobilePresentations(client)
      })
      // The still-rendered tab carries version-one shell; it cannot revive a retracted release.
      expect(active.current?.showNativeChat).toBe(true)
      expect(updateSessionViewOverride).toHaveBeenCalledTimes(writes + 1)
      await act(async () => {
        acceptMobilePresentationFrame(
          client,
          [{ ...tab, presentation: { ...negative, version: 3 } }],
          'w'
        )
      })
      expect(active.current?.showNativeChat).toBe(false)
      expect(updateSessionViewOverride).toHaveBeenLastCalledWith('h', 'w', 'quit', 'terminal')
      for (const state of ['agent-in-front', 'not-in-front'] as const) {
        await act(async () => {
          createMobilePresentationSource(client, 'w').apply([{ ...tab, presentation: undefined }])
        })
        await act(async () => {
          active.current!.setTabView('quit', 'chat')
        })
        let finish!: (value: Awaited<ReturnType<RpcClient['sendRequest']>>) => void
        vi.mocked(client.sendRequest).mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve
            })
        )
        const stale = readMobilePresentation(client, tab.terminal, 'inc')
        await act(async () => {
          physical.pushState('reconnecting')
          generation++
          physical.pushState('connected')
        })
        expect(active.current?.showNativeChat).toBe(true)
        vi.mocked(client.sendRequest).mockResolvedValueOnce({
          id: 'new',
          ok: true,
          _meta: { runtimeId: `runtime-${generation}` },
          result: { process: { presentation: { ...negative, state } } }
        })
        await act(async () => {
          await readMobilePresentation(client, tab.terminal, 'inc')
          finish({
            id: 'old',
            ok: true,
            result: {
              process: { presentation: { ...negative, version: 99, state: 'not-in-front' } }
            }
          })
          await stale
        })
        expect(active.current?.showNativeChat).toBe(state === 'agent-in-front')
        const feed = createMobilePresentationSource(client, 'w')
        await act(async () => {
          feed.apply([{ ...tab, presentation: undefined }])
        })
        await act(async () => {
          active.current!.setTabView('quit', 'chat')
        })
        expect(active.current?.showNativeChat).toBe(true)
        vi.mocked(client.sendRequest).mockResolvedValueOnce({
          id: 'none',
          ok: true,
          result: { process: {} }
        })
        await act(async () => {
          await readMobilePresentation(client, tab.terminal, 'inc')
        })
        expect(active.current?.showNativeChat).toBe(true)
        feed.dispose()
      }
      act(() => renderer?.unmount())
      renderer = null
      retractMobilePresentations(client)
    }
  )

  it.each(['feed', 'direct'])(
    'persists current logical handoff and dormant %s re-entry without a React reconnect',
    async (channel) => {
      vi.mocked(loadDefaultSessionView).mockResolvedValue('chat')
      const first = createFakeRpcClient()
      const logical = createStableLogicalRpcClient(first, 'relay')
      const client = scopeRpcClientToExecutionHost(logical, 'runtime:host')
      const negative = {
        support: 'supported' as const,
        incarnationId: 'inc',
        version: 1,
        state: 'not-in-front' as const
      }
      const tab = {
        id: 'quit',
        type: 'terminal',
        terminal: 'term',
        incarnationId: 'inc',
        launchAgent: 'codex'
      }
      let active: ReturnType<typeof useMobileNativeChatActiveResolution> | undefined
      function Harness() {
        active = useMobileNativeChatActiveResolution({
          client,
          connState: 'connected',
          hostId: 'h',
          worktreeId: 'w',
          activeSessionTab: tab,
          activeSessionTabId: tab.id,
          activeHandleRef: useRef(tab.terminal),
          nativeChatTranscriptIsLocalReadable: true
        })
        return null
      }
      const makeController = () =>
        new MobileSessionTabsStreamHealth<{ tabs: unknown[] }, unknown>({
          client,
          scope: 'w',
          apply: (result) => ({ accepted: true, effectiveTabs: result.tabs }),
          consumeAccepted: vi.fn(),
          hasRecoveryNeed: () => false
        })
      let feed = makeController()
      let sub = feed.beginSubscription()
      let stop = client.subscribe('session.tabs.subscribe', {}, sub.listener)
      await act(async () => {
        renderer = create(createElement(Harness))
      })
      const second = createFakeRpcClient()
      await act(async () => {
        await logical.migrateTo(second, 'lan')
      })
      feed.setReconciliationActive(true)
      await act(async () => {
        second.streams[0]!.emit(
          {
            type: 'snapshot',
            tabs: [{ ...tab, presentation: { ...negative, state: 'agent-in-front' } }]
          },
          { runtimeId: 'two' }
        )
        second.requests
          .find((r) => r.method === 'session.tabs.list')!
          .resolve({
            id: 'list',
            ok: true,
            result: { tabs: [{ ...tab, presentation: { ...negative, state: 'agent-in-front' } }] },
            _meta: { runtimeId: 'two' }
          })
      })
      await act(async () => {
        second.streams[0]!.emit(
          { type: 'updated', tabs: [{ ...tab, presentation: { ...negative, version: 2 } }] },
          { runtimeId: 'two' }
        )
      })
      expect(active?.showNativeChat).toBe(false)
      expect(updateSessionViewOverride).toHaveBeenLastCalledWith('h', 'w', tab.id, 'terminal')
      const requests = second.requests.length
      expect(feed.poll()).toBeNull()
      expect(second.requests).toHaveLength(requests)
      await act(async () => {
        second.streams[0]!.emit({
          type: 'updated',
          tabs: [{ ...tab, presentation: { ...negative, version: 3, state: 'agent-in-front' } }]
        })
      })
      expect(active?.showNativeChat).toBe(false) // Positive does not select Chat.
      await act(async () => {
        active!.setTabView(tab.id, 'chat')
      })
      expect(active?.showNativeChat).toBe(true)
      await act(async () => {
        first.streams[0]!.emit(
          { type: 'updated', tabs: [{ ...tab, presentation: { ...negative, version: 99 } }] },
          { runtimeId: 'one' }
        )
      })
      expect(active?.showNativeChat).toBe(true)
      for (const state of ['not-in-front', 'agent-in-front'] as const) {
        await act(async () => {
          second.streams[0]!.emit(
            { type: 'updated', tabs: [{ ...tab, presentation: { ...negative, state } }] },
            { runtimeId: `replacement-${state}` }
          )
        })
        if (state === 'not-in-front') {
          expect(active?.showNativeChat).toBe(false)
        }
        await act(async () => {
          active!.setTabView(tab.id, 'chat')
        })
        expect(active?.showNativeChat).toBe(state === 'agent-in-front')
      }
      await act(async () => {
        second.streams[0]!.emit({ type: 'updated', tabs: [tab] })
      })
      expect(active?.showNativeChat).toBe(true)
      await act(async () => {
        renderer?.unmount()
        renderer = null
        feed.dispose()
        stop()
        retractMobilePresentations(client)
      })
      const third = createFakeRpcClient()
      await logical.migrateTo(third, 'relay')
      expect(scopeRpcClientToExecutionHost(logical, 'runtime:host')).toBe(client)
      feed = makeController()
      sub = feed.beginSubscription()
      stop = client.subscribe('session.tabs.subscribe', {}, sub.listener)
      await act(async () => {
        renderer = create(createElement(Harness))
      })
      await act(async () => {
        if (channel === 'feed') {
          third.streams[0]!.emit({ type: 'updated', tabs: [{ ...tab, presentation: negative }] })
        } else {
          const read = readMobilePresentation(client, tab.terminal, 'inc')
          third.requests
            .at(-1)!
            .resolve({ id: 'direct', ok: true, result: { process: { presentation: negative } } })
          await read
        }
      })
      expect(active?.showNativeChat).toBe(false)
      expect(updateSessionViewOverride).toHaveBeenLastCalledWith('h', 'w', tab.id, 'terminal')
      await act(async () => {
        renderer?.unmount()
        renderer = null
        feed.dispose()
        stop()
        retractMobilePresentations(client)
      })
      logical.close()
      expect(third.stateListeners()).toBe(0)
    }
  )

  it('follows the default when a tab has no override', async () => {
    await mount({ defaultView: 'terminal' })
    expect(controller?.isTabChatView('t1')).toBe(false)

    act(() => renderer?.unmount())
    renderer = null
    await mount({ defaultView: 'chat' })
    expect(controller?.isTabChatView('t1')).toBe(true)
  })

  it('withholds the initial surface until both the default and this workspace overrides settle', async () => {
    const defaultRead = deferred<MobileSessionView>()
    const overridesRead = deferred<{ overrides: Map<string, MobileSessionView>; loaded: boolean }>()
    vi.mocked(loadDefaultSessionView).mockReturnValue(defaultRead.promise)
    vi.mocked(readSessionViewOverridesPreference).mockReturnValue(overridesRead.promise)
    function Harness(): null {
      controller = useMobileSessionViewMode({ hostId: 'h', worktreeId: 'w' })
      return null
    }
    act(() => {
      renderer = create(createElement(Harness))
    })
    expect(controller?.ready).toBe(false)
    await act(async () => {
      defaultRead.resolve('chat')
      await defaultRead.promise
    })
    expect(controller?.ready).toBe(false)
    await act(async () => {
      overridesRead.resolve({ overrides: new Map([['t1', 'terminal']]), loaded: true })
      await overridesRead.promise
    })
    expect(controller?.ready).toBe(true)
    expect(controller?.isTabChatView('t1')).toBe(false)
    expect(controller?.isTabChatView('t2')).toBe(true)
  })

  it('lets a per-tab override win over the default', async () => {
    await mount({
      defaultView: 'chat',
      overrides: new Map<string, MobileSessionView>([['t1', 'terminal']])
    })
    expect(controller?.isTabChatView('t1')).toBe(false)
    expect(controller?.isTabChatView('t2')).toBe(true)
  })

  it('reloads the default on refocus after Settings changes it', async () => {
    await mount({ defaultView: 'terminal' })
    expect(controller?.isTabChatView('t1')).toBe(false)
    expect(controller?.ready).toBe(true)
    vi.mocked(loadDefaultSessionView).mockResolvedValue('chat')

    await act(async () => {
      focusEffectRuntime.callback?.()
      await Promise.resolve()
    })

    expect(controller?.isTabChatView('t1')).toBe(true)
    expect(controller?.ready).toBe(true)
  })

  it('toggles from the effective view and persists the override', async () => {
    await mount({ defaultView: 'chat' })

    await act(async () => {
      controller?.toggleTabChatView('t1')
      await Promise.resolve()
    })

    expect(updateSessionViewOverride).toHaveBeenLastCalledWith('h', 'w', 't1', 'terminal')
    expect(controller?.isTabChatView('t1')).toBe(false)
    expect(readSessionViewOverridesPreference).toHaveBeenCalledTimes(1)
  })

  it('toggles a terminal-default tab into chat', async () => {
    await mount({ defaultView: 'terminal' })

    await act(async () => {
      controller?.toggleTabChatView('t1')
      await Promise.resolve()
    })

    expect(updateSessionViewOverride).toHaveBeenLastCalledWith('h', 'w', 't1', 'chat')
    expect(controller?.isTabChatView('t1')).toBe(true)
  })

  it('does not expose overrides from the previous host while the next scope loads', async () => {
    const nextScopeLoad = deferred<Map<string, MobileSessionView>>()
    vi.mocked(readSessionViewOverridesPreference).mockImplementation((hostId) =>
      hostId === 'h1'
        ? Promise.resolve({
            overrides: new Map([['same-tab-id', 'chat' as const]]),
            loaded: true
          })
        : nextScopeLoad.promise.then((overrides) => ({ overrides, loaded: true }))
    )
    function Harness(props: { hostId: string; worktreeId: string }): null {
      controller = useMobileSessionViewMode(props)
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness, { hostId: 'h1', worktreeId: 'w1' }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(controller?.isTabChatView('same-tab-id')).toBe(true)
    expect(controller?.ready).toBe(true)

    await act(async () => {
      renderer?.update(createElement(Harness, { hostId: 'h2', worktreeId: 'w2' }))
      await Promise.resolve()
    })
    expect(controller?.isTabChatView('same-tab-id')).toBe(false)
    expect(controller?.ready).toBe(false)

    await act(async () => {
      nextScopeLoad.resolve(new Map())
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(controller?.ready).toBe(true)
  })

  it('waits for a fresh read when returning A to B to A before B settles', async () => {
    const pendingB = deferred<{ overrides: Map<string, MobileSessionView>; loaded: boolean }>()
    const returningA = deferred<{ overrides: Map<string, MobileSessionView>; loaded: boolean }>()
    vi.mocked(readSessionViewOverridesPreference)
      .mockResolvedValueOnce({ overrides: new Map([['t1', 'chat']]), loaded: true })
      .mockReturnValueOnce(pendingB.promise)
      .mockReturnValueOnce(returningA.promise)
    function Harness(props: { hostId: string }) {
      controller = useMobileSessionViewMode({ ...props, worktreeId: 'folder:/project' })
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness, { hostId: 'A' }))
    })
    expect(controller?.ready).toBe(true)
    act(() => renderer?.update(createElement(Harness, { hostId: 'B' })))
    act(() => renderer?.update(createElement(Harness, { hostId: 'A' })))
    expect(controller?.ready).toBe(false)
    await act(async () => pendingB.resolve({ overrides: new Map([['t1', 'chat']]), loaded: true }))
    expect(controller?.ready).toBe(false)
    await act(async () =>
      returningA.resolve({ overrides: new Map([['t1', 'terminal']]), loaded: true })
    )
    expect(controller?.ready).toBe(true)
    expect(controller?.isTabChatView('t1')).toBe(false)
  })

  it('merges an explicit terminal choice made during load with the other persisted overrides', async () => {
    vi.mocked(loadDefaultSessionView).mockResolvedValue('chat')
    const overridesLoad = deferred<Map<string, MobileSessionView>>()
    vi.mocked(readSessionViewOverridesPreference).mockReturnValue(
      overridesLoad.promise.then((overrides) => ({ overrides, loaded: true }))
    )
    function Harness(): null {
      controller = useMobileSessionViewMode({ hostId: 'h', worktreeId: 'w' })
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
      await Promise.resolve()
    })

    act(() => controller?.setTabView('new-tab', 'terminal'))
    expect(controller?.isTabChatView('new-tab')).toBe(false)
    expect(updateSessionViewOverride).toHaveBeenCalledWith('h', 'w', 'new-tab', 'terminal')

    await act(async () => {
      overridesLoad.resolve(new Map([['saved-tab', 'chat']]))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(controller?.isTabChatView('saved-tab')).toBe(true)
    expect(controller?.isTabChatView('new-tab')).toBe(false)
  })

  it('toggles from the fail-closed view while overrides load under a chat default', async () => {
    const overridesLoad = deferred<Map<string, MobileSessionView>>()
    vi.mocked(loadDefaultSessionView).mockResolvedValue('chat')
    vi.mocked(readSessionViewOverridesPreference).mockReturnValue(
      overridesLoad.promise.then((overrides) => ({ overrides, loaded: true }))
    )
    function Harness(): null {
      controller = useMobileSessionViewMode({ hostId: 'h', worktreeId: 'w' })
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(controller?.isTabChatView('new-tab')).toBe(false)
    act(() => controller?.toggleTabChatView('new-tab'))

    expect(updateSessionViewOverride).toHaveBeenCalledWith('h', 'w', 'new-tab', 'chat')
    expect(controller?.isTabChatView('new-tab')).toBe(true)

    await act(async () => {
      overridesLoad.resolve(new Map())
      await overridesLoad.promise
      await Promise.resolve()
    })
  })

  it('submits rapid mutations in event order', async () => {
    await mount({ defaultView: 'terminal' })
    act(() => controller?.toggleTabChatView('t1'))
    act(() => controller?.toggleTabChatView('t2'))

    expect(updateSessionViewOverride).toHaveBeenNthCalledWith(1, 'h', 'w', 't1', 'chat')
    expect(updateSessionViewOverride).toHaveBeenNthCalledWith(2, 'h', 'w', 't2', 'chat')
  })

  it('reconciles the latest optimistic override when persistence fails', async () => {
    vi.mocked(updateSessionViewOverride).mockRejectedValue(new Error('storage unavailable'))
    vi.mocked(readSessionViewOverridesPreference)
      .mockResolvedValueOnce({
        overrides: new Map<string, MobileSessionView>([['t1', 'terminal']]),
        loaded: true
      })
      .mockResolvedValueOnce({
        overrides: new Map<string, MobileSessionView>([['t1', 'terminal']]),
        loaded: true
      })
    await mount({
      defaultView: 'terminal',
      overrides: new Map<string, MobileSessionView>([['t1', 'terminal']])
    })

    await act(async () => {
      controller?.toggleTabChatView('t1')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(controller?.isTabChatView('t1')).toBe(false)
    expect(readSessionViewOverridesPreference).toHaveBeenCalledTimes(2)
  })

  it('does not let an older failed override roll back a newer choice', async () => {
    const recoveryLoad = deferred<Map<string, MobileSessionView>>()
    vi.mocked(updateSessionViewOverride)
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(undefined)
    await mount({ defaultView: 'terminal' })
    vi.mocked(readSessionViewOverridesPreference).mockReturnValueOnce(
      recoveryLoad.promise.then((overrides) => ({ overrides, loaded: true }))
    )

    await act(async () => {
      controller?.toggleTabChatView('t1')
      await Promise.resolve()
    })
    act(() => controller?.toggleTabChatView('t1'))

    await act(async () => {
      recoveryLoad.resolve(new Map([['t1', 'chat']]))
      await recoveryLoad.promise
      await Promise.resolve()
    })

    expect(controller?.isTabChatView('t1')).toBe(false)
    expect(updateSessionViewOverride).toHaveBeenNthCalledWith(2, 'h', 'w', 't1', 'terminal')
  })

  it('fails closed when both an override write and its recovery read fail', async () => {
    vi.mocked(loadDefaultSessionView).mockResolvedValue('chat')
    vi.mocked(updateSessionViewOverride).mockRejectedValue(new Error('storage unavailable'))
    vi.mocked(readSessionViewOverridesPreference)
      .mockResolvedValueOnce({
        overrides: new Map<string, MobileSessionView>([['t1', 'terminal']]),
        loaded: true
      })
      .mockResolvedValueOnce({ overrides: new Map(), loaded: false })
    await mount({
      defaultView: 'chat',
      overrides: new Map<string, MobileSessionView>([['t1', 'terminal']])
    })

    await act(async () => {
      controller?.toggleTabChatView('t1')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(controller?.isTabChatView('t1')).toBe(false)
    expect(readSessionViewOverridesPreference).toHaveBeenCalledTimes(2)
  })

  it('does not reload a failed override after the route unmounts', async () => {
    const failedWrite = deferred<void>()
    vi.mocked(updateSessionViewOverride).mockReturnValue(failedWrite.promise)
    await mount({ defaultView: 'terminal' })

    act(() => controller?.toggleTabChatView('t1'))
    act(() => renderer?.unmount())
    renderer = null
    await act(async () => {
      failedWrite.reject(new Error('storage unavailable'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(readSessionViewOverridesPreference).toHaveBeenCalledTimes(1)
  })

  it('fails closed to terminal when overrides cannot be read under a chat default', async () => {
    vi.mocked(loadDefaultSessionView).mockResolvedValue('chat')
    vi.mocked(readSessionViewOverridesPreference).mockResolvedValue({
      overrides: new Map(),
      loaded: false
    })

    function Harness(): null {
      controller = useMobileSessionViewMode({ hostId: 'h', worktreeId: 'w' })
      return null
    }
    await act(async () => {
      renderer = create(createElement(Harness))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(controller?.isTabChatView('t1')).toBe(false)
  })
})
