import {
  useLayoutEffect,
  useRef,
  useCallback,
  useEffect,
  useSyncExternalStore,
  type MutableRefObject
} from 'react'
import { useFocusEffect } from 'expo-router'
import { AppState } from 'react-native'
import type { RpcClient } from '../transport/rpc-client'
import type { ConnectionState } from '../transport/types'
import { decideTerminalForegroundPresentation } from '../../../src/shared/terminal-foreground-presentation'
import {
  mobilePresentationSnapshot,
  subscribeMobilePresentation,
  readMobilePresentation
} from '../terminal/terminal-presentation'
import { encodeNativeChatTranscriptIdentity } from '../../../src/shared/native-chat/transcript/native-chat-transcript-retention'
import {
  resolveMobileNativeChat,
  type MobileNativeChatTab
} from './native-chat/mobile-native-chat-eligibility'
import {
  useMobileSessionViewMode,
  type MobileSessionViewModeController
} from './use-mobile-session-view-mode'

export function useMobileNativeChatActiveResolution(args: {
  client?: RpcClient | null
  connState?: ConnectionState
  hostId: string
  worktreeId: string
  activeSessionTab: MobileNativeChatTab | null
  activeSessionTabId: string | null
  activeHandleRef: MutableRefObject<string | null>
  nativeChatTranscriptIsLocalReadable: boolean
}): {
  sessionViewReady: boolean
  isTabChatView: (tabId: string) => boolean
  setTabView: MobileSessionViewModeController['setTabView']
  toggleTabChatView: (tabId: string) => void
  showNativeChat: boolean
  showNativeChatRef: MutableRefObject<boolean>
  activeChatAgent: string | null
  /** False when only memory names the agent; chat writes stay locked. */
  activeChatAgentConfirmed: boolean
  activeChatAgentRef: MutableRefObject<string | null>
  activeChatSessionId: string | null
  activeChatStructured: boolean
  activeChatResolution: ReturnType<typeof resolveMobileNativeChat>
  nativeChatStatus: MobileNativeChatTab['agentStatus'] | null
  sourceIdentity: string
  streamIdentity: string
} {
  const {
    activeHandleRef,
    activeSessionTab,
    activeSessionTabId,
    hostId,
    nativeChatTranscriptIsLocalReadable,
    worktreeId
  } = args
  const {
    ready: sessionViewReady,
    isTabChatView,
    setTabView: setTabViewBase,
    toggleTabChatView: toggleTabChatViewBase
  } = useMobileSessionViewMode({ hostId, worktreeId })
  const client = args.client ?? null
  const terminal =
    activeSessionTab?.type === 'terminal'
      ? (activeSessionTab.terminal ?? activeHandleRef.current)
      : null
  const subscribe = useCallback(
    (listener: () => void) =>
      client && terminal ? subscribeMobilePresentation(client, terminal, listener) : () => {},
    [client, terminal]
  )
  const snapshot = useCallback(
    () => (client && terminal ? mobilePresentationSnapshot(client, terminal) : undefined),
    [client, terminal]
  )
  const presentation = useSyncExternalStore(subscribe, snapshot, snapshot)
  const sampleShown = useCallback(() => {
    if (client && terminal && (args.connState === undefined || args.connState === 'connected')) {
      void readMobilePresentation(client, terminal, activeSessionTab?.incarnationId)
    }
  }, [client, terminal, args.connState, activeSessionTab?.incarnationId])
  useFocusEffect(
    useCallback(() => {
      sampleShown()
    }, [sampleShown])
  )
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        sampleShown()
      }
    })
    return () => subscription.remove()
  }, [sampleShown])
  const setTabView = setTabViewBase
  const toggleTabChatView = toggleTabChatViewBase
  const tabWantsChat =
    activeSessionTab?.type === 'agent-session' ||
    (activeSessionTabId ? isTabChatView(activeSessionTabId) : false)
  const release =
    decideTerminalForegroundPresentation({
      accepted: presentation?.state,
      currentBinding:
        Boolean(terminal) &&
        (!activeSessionTab?.incarnationId ||
          presentation?.incarnationId === activeSessionTab.incarnationId),
      member: activeSessionTab?.type === 'terminal',
      wantsChat: tabWantsChat
    }) === 'release'
  useLayoutEffect(() => {
    if (release && activeSessionTabId) {
      setTabViewBase(activeSessionTabId, 'terminal')
    }
  }, [release, activeSessionTabId, setTabViewBase])
  const activeChatResolution =
    activeSessionTab && activeSessionTabId && tabWantsChat && !release
      ? resolveMobileNativeChat(activeSessionTab, nativeChatTranscriptIsLocalReadable)
      : null
  const showNativeChat = activeChatResolution != null
  const showNativeChatRef = useRef(showNativeChat)
  const activeChatAgent = activeChatResolution?.agent ?? null
  const activeChatAgentRef = useRef<string | null>(activeChatAgent)

  useLayoutEffect(() => {
    showNativeChatRef.current = showNativeChat
    activeChatAgentRef.current = activeChatAgent
  }, [activeChatAgent, showNativeChat])

  const activeChatSessionId = activeChatResolution?.sessionId ?? null
  const activeChatStructured =
    activeChatResolution != null && activeSessionTab?.type === 'agent-session'
  const activeTabStatus = activeSessionTab?.agentStatus
  const nativeChatStatus = activeChatResolution && !activeChatStructured ? activeTabStatus : null
  const routeKey = `${hostId}\0${worktreeId}\0${activeSessionTabId ?? ''}`
  const streamIdentity = `${routeKey}\0${activeChatSessionId ?? ''}\0${activeHandleRef.current ?? ''}`

  return {
    sessionViewReady,
    isTabChatView,
    setTabView,
    toggleTabChatView,
    showNativeChat,
    showNativeChatRef,
    activeChatAgent,
    activeChatAgentConfirmed: activeChatResolution?.agentConfirmed !== false,
    activeChatAgentRef,
    activeChatSessionId,
    activeChatStructured,
    activeChatResolution,
    nativeChatStatus,
    sourceIdentity: encodeNativeChatTranscriptIdentity([hostId, worktreeId]),
    streamIdentity
  }
}
