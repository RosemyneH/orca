import React, { useEffect, useMemo, useRef, useState } from 'react'
import { isPluginPanelTabKey } from '../../../../shared/plugins/manifest/plugin-manifest'
import { PLUGIN_PANEL_FRAME_NAME_PREFIX } from '../../../../shared/plugins/frames/plugin-frame-bridge'
import { fillPluginPanelShell } from './plugin-panel-design-token-css'
import { usePluginFrameHost } from './use-plugin-frame-host'
import { usePluginPanels, usePluginPanelsStore } from '@/store/plugin-panels'
import { translate } from '@/i18n/i18n'

type PluginPanelProps = {
  tabKey: string
}

type PluginPanelEntryState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'unresponsive' }
  | { status: 'ready'; shellHtml: string; documentRevision: number }

function PluginPanelMessage({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function PluginPanel({ tabKey }: PluginPanelProps): React.JSX.Element {
  const panels = usePluginPanels()
  const setPanelHealth = usePluginPanelsStore((state) => state.setPanelHealth)
  const panel = isPluginPanelTabKey(tabKey)
    ? (panels.find((entry) => entry.tabKey === tabKey) ?? null)
    : null
  const [entryState, setEntryState] = useState<PluginPanelEntryState>({ status: 'loading' })
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  const pluginKey = panel?.pluginKey ?? null
  const panelId = panel?.id ?? null
  const panelShell = entryState.status === 'ready' ? entryState.shellHtml : null
  // Why memoized: a new srcdoc reloads the frame; theme changes arrive as messages instead.
  const panelDocument = useMemo(
    () => (panelShell ? fillPluginPanelShell(panelShell) : null),
    [panelShell]
  )
  const panelFrameKey =
    entryState.status === 'ready' ? `${tabKey}:${entryState.documentRevision}` : null
  const { onFrameLoad } = usePluginFrameHost({
    surface: 'panel',
    iframeRef,
    frameKey: panelFrameKey,
    sessionToken,
    onUnresponsive: () => {
      setPanelHealth(tabKey, 'error')
      setEntryState({ status: 'unresponsive' })
    }
  })

  useEffect(() => {
    if (!pluginKey || !panelId) {
      return
    }
    let cancelled = false
    let currentHtml: string | null = null
    let documentRevision = 0
    setEntryState({ status: 'loading' })
    setSessionToken(null)
    const pluginsApi = window.api?.plugins
    if (!pluginsApi) {
      setPanelHealth(tabKey, 'error')
      setEntryState({ status: 'error' })
      return
    }
    let loadGeneration = 0
    const load = (): void => {
      const generation = ++loadGeneration
      pluginsApi
        .readPanelEntry({ pluginKey, panelId })
        .then((entry) => {
          if (cancelled || generation !== loadGeneration) {
            return
          }
          if (!entry) {
            currentHtml = null
            setSessionToken(null)
            setPanelHealth(tabKey, 'error')
            setEntryState({ status: 'error' })
            return
          }
          // Rotate authority without replacing unchanged content or restarting its watchdog.
          setSessionToken(entry.sessionToken)
          setPanelHealth(tabKey, 'healthy')
          if (entry.html !== currentHtml) {
            currentHtml = entry.html
            documentRevision += 1
            setPanelHealth(tabKey, 'healthy')
            setEntryState({
              status: 'ready',
              shellHtml: entry.html,
              documentRevision
            })
          }
        })
        .catch(() => {
          if (!cancelled && generation === loadGeneration) {
            currentHtml = null
            setSessionToken(null)
            setPanelHealth(tabKey, 'error')
            setEntryState({ status: 'error' })
          }
        })
    }
    load()
    const unsubscribe = pluginsApi.onChanged ? pluginsApi.onChanged(load) : null
    return () => {
      cancelled = true
      loadGeneration += 1
      unsubscribe?.()
    }
  }, [panelId, pluginKey, setPanelHealth, tabKey])

  // Persisted tabs can outlive an uninstalled or disabled plugin.
  if (!panel) {
    return (
      <PluginPanelMessage>
        {translate(
          'auto.components.right.sidebar.PluginPanel.unavailable',
          'This plugin panel is no longer available.'
        )}
      </PluginPanelMessage>
    )
  }

  if (entryState.status === 'loading') {
    return (
      <PluginPanelMessage>
        {translate('auto.components.right.sidebar.PluginPanel.loading', 'Loading plugin panel...')}
      </PluginPanelMessage>
    )
  }

  if (entryState.status === 'unresponsive') {
    return (
      <PluginPanelMessage>
        {translate(
          'auto.components.right.sidebar.PluginPanel.unresponsive',
          'This plugin panel stopped responding and was suspended.'
        )}
      </PluginPanelMessage>
    )
  }

  if (entryState.status === 'error') {
    return (
      <PluginPanelMessage>
        {translate(
          'auto.components.right.sidebar.PluginPanel.loadFailed',
          'The plugin panel could not be loaded.'
        )}
      </PluginPanelMessage>
    )
  }

  return (
    <iframe
      key={panelFrameKey}
      ref={iframeRef}
      // SECURITY: never add allow-same-origin — the srcdoc frame must stay an
      // opaque origin so plugin UI cannot reach the app DOM, storage, or IPC.
      // The srcdoc itself is the host CSP shell wrapped around plugin HTML.
      sandbox="allow-scripts"
      name={`${PLUGIN_PANEL_FRAME_NAME_PREFIX}${tabKey}`}
      srcDoc={panelDocument ?? ''}
      onLoad={onFrameLoad}
      title={panel.title}
      className="h-full w-full flex-1 border-0 bg-background"
    />
  )
}

export default PluginPanel
