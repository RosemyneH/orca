import {
  installInputMarkerLayoutFixture,
  installSshPresentationInspectionFixture,
  INSPECTION_LEAF_ID as LEAF_ID,
  INSPECTION_PANE_KEY as PANE_KEY,
  makeByteOversizedTerminalInput,
  createRuntimeTerminalInspectionFixtures,
  liveEvidence
} from './runtime-terminal-inspection-test-fixtures'
import {
  publicRuntimeEnvironment,
  connectedRuntimeStatus
} from './paired-runtime-environment-test-fixture'
// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import {
  inspectDesktopShownTerminal,
  inspectRuntimeTerminalProcess,
  sendRuntimePtyInput
} from './runtime-terminal-inspection'
import { clearRuntimeCompatibilityCacheForTests } from './runtime-rpc-client'
import { desktopPresentationSnapshot } from './terminal-foreground-presentation'
import { recordRuntimeTerminalInputForPtyId } from './runtime-terminal-input-recording'
import { sendRuntimePtyInputVerified } from './runtime-terminal-verified-input'
import { CLIPBOARD_TEXT_MEASURE_YIELD_CODE_UNITS } from '../../../shared/clipboard-text'
import {
  createCompatibleRuntimeStatusResponseIfNeeded,
  type RuntimeEnvironmentCallRequest
} from './runtime-compatibility-test-fixture'
import { TERMINAL_INPUT_MAX_BYTES } from '../../../shared/terminal-input'
import { useAppStore } from '../store'
import {
  clientOnlyUnverifiableInspection,
  type ClientOnlyUnverifiableInspection
} from '../../../shared/terminal-process-inspection'

describe('runtime terminal owner routing', () => {
  const {
    runtimeCall,
    runtimeTransportCall,
    localWrite,
    localWriteAccepted,
    localForeground,
    localHasChildren,
    localInspect
  } = createRuntimeTerminalInspectionFixtures()
  it('records runtime input markers even before hibernation is enabled', () => {
    installInputMarkerLayoutFixture()

    recordRuntimeTerminalInputForPtyId('local-pty', 123)

    expect(useAppStore.getState().lastTerminalInputAtByPaneKey[PANE_KEY]).toBe(123)
  })

  it('sends input through the PTY owning environment instead of the active one', async () => {
    expect(sendRuntimePtyInput('remote:env-1@@terminal-1', 'x', 'driving')).toBe(true)

    await vi.waitFor(() => {
      expect(runtimeCall).toHaveBeenCalledWith({
        selector: 'env-1',
        method: 'terminal.send',
        params: {
          terminal: 'terminal-1',
          text: 'x',
          client: { id: 'orca-desktop', type: 'desktop' }
        },
        timeoutMs: 15_000
      })
    })
    expect(localWrite).not.toHaveBeenCalled()
  })

  it('inspects the PTY owning environment instead of the active one', async () => {
    await expect(inspectRuntimeTerminalProcess('remote:env-1@@terminal-1')).resolves.toMatchObject({
      foregroundProcess: 'bash',
      hasChildProcesses: true
    })

    expect(runtimeCall).toHaveBeenCalledWith({
      selector: 'env-1',
      method: 'terminal.inspectProcess',
      params: { terminal: 'terminal-1' },
      timeoutMs: 15_000
    })
    expect(localForeground).not.toHaveBeenCalled()
    expect(localHasChildren).not.toHaveBeenCalled()
  })

  // Forward close guards’ real-process-read option or hosts return unverifiable and confirm every idle remote Windows close (#18591).
  it('forwards scanChildProcesses to the PTY owning environment', async () => {
    await inspectRuntimeTerminalProcess('remote:env-1@@terminal-1', { scanChildProcesses: true })

    expect(runtimeCall).toHaveBeenCalledWith({
      selector: 'env-1',
      method: 'terminal.inspectProcess',
      params: { terminal: 'terminal-1', scanChildProcesses: true },
      timeoutMs: 15_000
    })
  })

  it('forwards scanChildProcesses alongside the incarnation fence', async () => {
    await inspectRuntimeTerminalProcess('remote:env-1@@terminal-1', {
      expectedIncarnationId: 'incarnation-1',
      scanChildProcesses: true
    })

    expect(runtimeCall).toHaveBeenCalledWith({
      selector: 'env-1',
      method: 'terminal.inspectProcess',
      params: {
        terminal: 'terminal-1',
        expectedIncarnationId: 'incarnation-1',
        scanChildProcesses: true
      },
      timeoutMs: 15_000
    })
  })

  it('omits scanChildProcesses when the caller is only polling', async () => {
    await inspectRuntimeTerminalProcess('remote:env-1@@terminal-1')

    expect(runtimeCall).toHaveBeenCalledWith({
      selector: 'env-1',
      method: 'terminal.inspectProcess',
      params: { terminal: 'terminal-1' },
      timeoutMs: 15_000
    })
  })

  it.each([true, false])(
    'qualified shown read consumes owning host capability=%s without POSIX evidence',
    async (supported) => {
      const id = `remote:env-show-${supported}@@terminal-shown`
      runtimeTransportCall.mockImplementation((args: RuntimeEnvironmentCallRequest) => {
        const status = createCompatibleRuntimeStatusResponseIfNeeded(args)
        if (status && status.ok) {
          status.result.capabilities = status.result.capabilities?.filter(
            (value) => supported || value !== 'terminal.foreground-presentation.v1'
          )
          return status
        }
        return runtimeCall(args)
      })
      runtimeCall.mockResolvedValue({
        ok: true,
        result: {
          process: {
            foregroundProcess: 'bash',
            hasChildProcesses: true,
            presentation: {
              support: 'supported',
              incarnationId: 'incarnation-1',
              version: 1,
              state: 'not-in-front'
            }
          }
        }
      })
      useAppStore.setState({
        ptyIdsByTabId: { shown: [id] },
        runtimeEnvironments: [publicRuntimeEnvironment({ id: `env-show-${supported}` })],
        runtimeStatusByEnvironmentId: new Map([
          [`env-show-${supported}`, connectedRuntimeStatus('remote-runtime', 0)]
        ])
      })
      const first = inspectDesktopShownTerminal(id)
      expect(inspectDesktopShownTerminal(id)).toBe(first)
      await first
      expect(runtimeCall).toHaveBeenCalledTimes(supported ? 1 : 0)
      expect(localInspect).not.toHaveBeenCalled()
      if (supported) {
        clearRuntimeCompatibilityCacheForTests()
        let releaseCapability!: () => void
        runtimeTransportCall.mockImplementation((args: RuntimeEnvironmentCallRequest) => {
          const status = createCompatibleRuntimeStatusResponseIfNeeded(args)
          return status
            ? new Promise((resolve) => {
                releaseCapability = () => resolve(status)
              })
            : runtimeCall(args)
        })
        const old = inspectDesktopShownTerminal(id)
        useAppStore
          .getState()
          .setRuntimeEnvironmentStatus('env-show-true', { status: null, checkedAt: 2 })
        useAppStore.setState({
          runtimeStatusByEnvironmentId: new Map([
            ['env-show-true', connectedRuntimeStatus('remote-runtime', 0)]
          ])
        })
        const current = inspectDesktopShownTerminal(id)
        expect(current).not.toBe(old)
        let releaseInspection!: () => void
        runtimeCall.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releaseInspection = () =>
                resolve({
                  ok: true,
                  result: {
                    process: {
                      foregroundProcess: 'codex',
                      hasChildProcesses: true,
                      presentation: {
                        support: 'supported',
                        incarnationId: 'incarnation-1',
                        version: 1,
                        state: 'agent-in-front'
                      }
                    }
                  }
                })
            })
        )
        releaseCapability()
        await old
        await vi.waitFor(() => expect(runtimeCall).toHaveBeenCalledTimes(2))
        expect(inspectDesktopShownTerminal(id)).toBe(current)
        releaseInspection()
        await current
        expect(desktopPresentationSnapshot(id)?.state).toBe('agent-in-front')
      }
    }
  )

  it.each(['local-null', 'paired-null', 'native-windows'])(
    'preserves compatibility before presentation delivery: %s',
    async (flow) => {
      const remote = flow !== 'local-null'
      const id = remote ? `remote:compat-${flow}@@terminal` : 'compat-null'
      useAppStore.setState({
        ptyIdsByTabId: { compatibility: [id] },
        runtimeEnvironments: [publicRuntimeEnvironment({ id: `compat-${flow}` })],
        runtimeStatusByEnvironmentId: new Map([
          [`compat-${flow}`, connectedRuntimeStatus('remote-runtime', 0)]
        ])
      })
      const presentation = {
        support: 'supported',
        incarnationId: 'inc',
        version: 1,
        state: 'not-in-front'
      } as const
      localInspect.mockResolvedValue(null)
      runtimeCall.mockResolvedValue({
        ok: true,
        result: {
          process:
            flow === 'paired-null'
              ? null
              : {
                  foregroundProcess: 'powershell',
                  hasChildProcesses: false,
                  presentation
                }
        }
      })
      await expect(inspectRuntimeTerminalProcess(id)).resolves.toMatchObject({
        verdict: 'unverifiable',
        reason: remote ? 'old_host' : 'terminal_gone'
      })
      expect(desktopPresentationSnapshot(id)).toEqual(
        flow === 'native-windows' ? presentation : undefined
      )
    }
  )

  it('maps an old host inspection to client-only unverifiable', async () => {
    runtimeCall.mockResolvedValue({
      ok: true,
      result: {
        process: { foregroundProcess: 'codex', hasChildProcesses: true }
      },
      _meta: { runtimeId: 'runtime-1' }
    })

    await expect(inspectRuntimeTerminalProcess('remote:env-1@@terminal-1')).resolves.toEqual({
      foregroundProcess: null,
      hasChildProcesses: false,
      verdict: 'unverifiable',
      reason: 'old_host'
    })
  })

  it('uses strict main-process inspection for a direct SSH PTY', async () => {
    const { id, presentation, authorityB } = installSshPresentationInspectionFixture()
    localInspect.mockResolvedValue({
      presentation,
      foregroundProcess: 'codex',
      hasChildProcesses: true,
      foregroundProcessEvidence: liveEvidence('pty-1', 'codex')
    })

    await expect(
      inspectRuntimeTerminalProcess(id, { expectedIncarnationId: 'incarnation-1' })
    ).resolves.toMatchObject({
      foregroundProcess: 'codex',
      hasChildProcesses: true
    })
    expect(localInspect).toHaveBeenCalledExactlyOnceWith(id, {
      expectedIncarnationId: 'incarnation-1'
    })
    expect(localForeground).not.toHaveBeenCalled()
    expect(localHasChildren).not.toHaveBeenCalled()
    expect(desktopPresentationSnapshot(id)).toEqual(presentation)
    let finish!: () => void
    const now = vi.spyOn(performance, 'now').mockReturnValue(1_000)
    localInspect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              foregroundProcess: 'zsh',
              hasChildProcesses: true,
              presentation: { ...presentation, version: 2, state: 'not-in-front' },
              foregroundProcessEvidence: { ...liveEvidence('pty-1'), observationEpoch: 2 }
            })
        })
    )
    const delayed = inspectRuntimeTerminalProcess(id, { expectedIncarnationId: 'incarnation-1' })
    now.mockReturnValue(4_001)
    finish()
    await delayed
    now.mockRestore()
    expect(desktopPresentationSnapshot(id)).toEqual(presentation)
    const stale = inspectRuntimeTerminalProcess(id, { expectedIncarnationId: 'incarnation-1' })
    useAppStore.setState({
      sshConnectionStates: new Map([['host', authorityB]])
    })
    await stale
    expect(desktopPresentationSnapshot(id)).toBeUndefined()
    await inspectRuntimeTerminalProcess(id, { expectedIncarnationId: 'incarnation-1' })
    expect(desktopPresentationSnapshot(id)).toEqual(presentation)
    useAppStore.setState({ sshTargetGenerations: new Map() })
    expect(desktopPresentationSnapshot(id)).toBeUndefined()
  })

  it('maps an old direct SSH host to client-only unverifiable', async () => {
    localInspect.mockResolvedValue({
      foregroundProcess: null,
      hasChildProcesses: true
    })

    await expect(inspectRuntimeTerminalProcess('ssh:host@@pty-1')).resolves.toEqual({
      foregroundProcess: null,
      hasChildProcesses: false,
      verdict: 'unverifiable',
      reason: 'old_host'
    })
  })

  it.each(['no_connected_pty', 'terminal_handle_stale', 'terminal_gone'])(
    'reports %s remote process inspection as client-only unverifiable',
    async (code) => {
      runtimeCall.mockResolvedValue({
        ok: false,
        error: { code, message: code }
      })

      await expect(inspectRuntimeTerminalProcess('remote:env-1@@terminal-stale')).resolves.toEqual({
        foregroundProcess: null,
        hasChildProcesses: false,
        verdict: 'unverifiable',
        reason: 'terminal_gone'
      })
    }
  )

  it('maps lost contact and timeout to client-only unverifiable results', async () => {
    runtimeCall.mockRejectedValueOnce(new Error('SSH connection lost, reconnecting...'))
    await expect(
      inspectRuntimeTerminalProcess('remote:env-1@@terminal-transport')
    ).resolves.toEqual({
      foregroundProcess: null,
      hasChildProcesses: false,
      verdict: 'unverifiable',
      reason: 'transport_loss'
    })

    runtimeCall.mockRejectedValueOnce(new Error('Request timed out before completion'))
    await expect(
      inspectRuntimeTerminalProcess('remote:env-1@@terminal-timeout')
    ).resolves.toMatchObject({ verdict: 'unverifiable', reason: 'timeout' })
  })

  it('keeps client-only unverifiable free of host metadata', () => {
    type HostFieldsCannotBeConstructed = ClientOnlyUnverifiableInspection extends {
      authorityGeneration?: never
      observationEpoch?: never
      capturedAgeMs?: never
      ptyId?: never
      ptyIncarnationId?: never
    }
      ? true
      : false
    const typeProof: HostFieldsCannotBeConstructed = true
    expect(typeProof).toBe(true)
    const result = clientOnlyUnverifiableInspection('transport_loss')
    expect(result).not.toHaveProperty('authorityGeneration')
    expect(result).not.toHaveProperty('foregroundProcessEvidence')
  })

  it('still throws an unclassified programming error and withdraws its current authority', async () => {
    const id = 'remote:env-1@@terminal-bug'
    useAppStore.setState({
      ptyIdsByTabId: { bug: [id] },
      runtimeEnvironments: [publicRuntimeEnvironment({ id: 'env-1' })],
      runtimeStatusByEnvironmentId: new Map([['env-1', connectedRuntimeStatus('runtime-1', 0)]])
    })
    runtimeCall.mockResolvedValueOnce({
      ok: true,
      result: {
        process: {
          foregroundProcess: 'powershell',
          hasChildProcesses: false,
          presentation: {
            support: 'supported',
            incarnationId: 'inc',
            version: 1,
            state: 'not-in-front'
          }
        }
      }
    })
    await inspectRuntimeTerminalProcess(id)
    expect(desktopPresentationSnapshot(id)?.state).toBe('not-in-front')
    runtimeCall.mockRejectedValueOnce(new Error('inspection invariant violated'))
    await expect(inspectRuntimeTerminalProcess('remote:env-1@@terminal-bug')).rejects.toThrow(
      'inspection invariant violated'
    )
    expect(desktopPresentationSnapshot(id)).toBeUndefined()
  })

  it('attributes a delayed runtime acknowledgement to the current layout owner', async () => {
    const pendingSend = Promise.withResolvers<{
      ok: true
      result: { send: { handle: string; accepted: true; bytesWritten: number } }
      _meta: { runtimeId: string }
    }>()
    runtimeCall.mockReturnValue(pendingSend.promise)
    useAppStore.setState({
      terminalLayoutsByTabId: {
        'tab-1': {
          root: { type: 'leaf', leafId: LEAF_ID },
          activeLeafId: LEAF_ID,
          expandedLeafId: null,
          ptyIdsByLeafId: { [LEAF_ID]: 'remote:env-1@@terminal-1' }
        }
      }
    })
    recordRuntimeTerminalInputForPtyId('remote:env-1@@terminal-1', 123)
    useAppStore.setState({ lastTerminalInputAtByPaneKey: {} })

    expect(sendRuntimePtyInput('remote:env-1@@terminal-1', 'x', 'driving')).toBe(true)
    const nextLeafId = '22222222-2222-4222-8222-222222222222'
    useAppStore.setState({
      terminalLayoutsByTabId: {
        'tab-2': {
          root: { type: 'leaf', leafId: nextLeafId },
          activeLeafId: nextLeafId,
          expandedLeafId: null,
          ptyIdsByLeafId: { [nextLeafId]: 'remote:env-1@@terminal-1' }
        }
      }
    })
    pendingSend.resolve({
      ok: true,
      result: { send: { handle: 'terminal-1', accepted: true, bytesWritten: 1 } },
      _meta: { runtimeId: 'runtime-1' }
    })

    await vi.waitFor(() => {
      expect(useAppStore.getState().lastTerminalInputAtByPaneKey).toEqual({
        [`tab-2:${nextLeafId}`]: expect.any(Number)
      })
    })
  })

  it('rejects oversized fire-and-forget local input before IPC writes', () => {
    const text = 'x'.repeat(TERMINAL_INPUT_MAX_BYTES + 1)

    expect(sendRuntimePtyInput('local-pty', text, 'driving')).toBe(false)

    expect(localWrite).not.toHaveBeenCalled()
    expect(localWriteAccepted).not.toHaveBeenCalled()
  })

  it('yields while validating large fire-and-forget local input before IPC writes', async () => {
    vi.useFakeTimers()
    try {
      const text = 'x'.repeat(CLIPBOARD_TEXT_MEASURE_YIELD_CODE_UNITS + 1)

      expect(sendRuntimePtyInput('local-pty', text, 'driving')).toBe(true)
      expect(localWrite).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(0)

      expect(localWrite).toHaveBeenCalledWith('local-pty', text, 'driving')
      expect(localWriteAccepted).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops byte-oversized fire-and-forget input after deferred validation', async () => {
    vi.useFakeTimers()
    try {
      const text = makeByteOversizedTerminalInput()

      expect(sendRuntimePtyInput('local-pty', text, 'driving')).toBe(true)

      await vi.runAllTimersAsync()

      expect(localWrite).not.toHaveBeenCalled()
      expect(runtimeTransportCall).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects oversized verified input before fallback fire-and-forget writes', async () => {
    const text = 'x'.repeat(TERMINAL_INPUT_MAX_BYTES + 1)

    await expect(sendRuntimePtyInputVerified('local-pty', text, 'driving')).resolves.toBe(false)

    expect(localWriteAccepted).not.toHaveBeenCalled()
    expect(localWrite).not.toHaveBeenCalled()
  })

  it('yields while validating large verified local input before IPC writes', async () => {
    vi.useFakeTimers()
    localWriteAccepted.mockResolvedValue(true)
    try {
      const text = 'x'.repeat(CLIPBOARD_TEXT_MEASURE_YIELD_CODE_UNITS + 1)
      const accepted = sendRuntimePtyInputVerified('local-pty', text, 'driving')

      expect(localWriteAccepted).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(0)

      await expect(accepted).resolves.toBe(true)
      expect(localWriteAccepted).toHaveBeenCalledWith('local-pty', text, 'driving')
      expect(localWrite).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects byte-oversized verified input after deferred validation', async () => {
    vi.useFakeTimers()
    try {
      const text = makeByteOversizedTerminalInput()
      const accepted = sendRuntimePtyInputVerified('local-pty', text, 'driving')

      await vi.runAllTimersAsync()

      await expect(accepted).resolves.toBe(false)
      expect(localWriteAccepted).not.toHaveBeenCalled()
      expect(localWrite).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('records accepted runtime input against the owning pane key', async () => {
    runtimeCall.mockResolvedValue({
      ok: true,
      result: { send: { handle: 'terminal-1', accepted: true, bytesWritten: 1 } },
      _meta: { runtimeId: 'runtime-1' }
    })
    useAppStore.setState({
      settings: { experimentalAgentHibernation: true } as never,
      terminalLayoutsByTabId: {
        'tab-1': {
          root: { type: 'leaf', leafId: LEAF_ID },
          activeLeafId: LEAF_ID,
          expandedLeafId: null,
          ptyIdsByLeafId: { [LEAF_ID]: 'remote:env-1@@terminal-1' }
        }
      }
    })

    await expect(
      sendRuntimePtyInputVerified('remote:env-1@@terminal-1', 'x', 'driving')
    ).resolves.toBe(true)

    expect(useAppStore.getState().lastTerminalInputAtByPaneKey[PANE_KEY]).toEqual(
      expect.any(Number)
    )
  })

  it('does not record rejected runtime input against the owning pane key', async () => {
    runtimeCall.mockResolvedValue({
      ok: true,
      result: { send: { handle: 'terminal-1', accepted: false, bytesWritten: 0 } },
      _meta: { runtimeId: 'runtime-1' }
    })
    useAppStore.setState({
      settings: { experimentalAgentHibernation: true } as never,
      terminalLayoutsByTabId: {
        'tab-1': {
          root: { type: 'leaf', leafId: LEAF_ID },
          activeLeafId: LEAF_ID,
          expandedLeafId: null,
          ptyIdsByLeafId: { [LEAF_ID]: 'remote:env-1@@terminal-1' }
        }
      }
    })

    await expect(
      sendRuntimePtyInputVerified('remote:env-1@@terminal-1', 'x', 'driving')
    ).resolves.toBe(false)

    expect(useAppStore.getState().lastTerminalInputAtByPaneKey[PANE_KEY]).toBeUndefined()
  })

  it('indexes a stable layout identity once across repeated terminal input', () => {
    const layoutCount = 500
    let layoutEnumerations = 0
    let leafEnumerations = 0
    const layouts = Object.fromEntries(
      Array.from({ length: layoutCount }, (_, index) => {
        const leafId = `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`
        const ptyIdsByLeafId = new Proxy(
          { [leafId]: `pty-${index}` },
          {
            ownKeys: (target) => {
              leafEnumerations += 1
              return Reflect.ownKeys(target)
            }
          }
        )
        return [
          `tab-${index}`,
          {
            root: { type: 'leaf' as const, leafId },
            activeLeafId: leafId,
            expandedLeafId: null,
            ptyIdsByLeafId
          }
        ]
      })
    )
    const observedLayouts = new Proxy(layouts, {
      ownKeys: (target) => {
        layoutEnumerations += 1
        return Reflect.ownKeys(target)
      }
    })
    useAppStore.setState({ terminalLayoutsByTabId: observedLayouts })

    recordRuntimeTerminalInputForPtyId('pty-0', 10_000)
    expect({ layoutEnumerations, leafEnumerations }).toEqual({
      layoutEnumerations: 1,
      leafEnumerations: 1
    })
    layoutEnumerations = 0
    leafEnumerations = 0

    for (let timestamp = 1; timestamp <= 100; timestamp += 1) {
      recordRuntimeTerminalInputForPtyId(`pty-${layoutCount - 1}`, timestamp * 10_000)
    }

    expect({ layoutEnumerations, leafEnumerations }).toEqual({
      layoutEnumerations: 1,
      leafEnumerations: layoutCount
    })
    expect(
      useAppStore.getState().lastTerminalInputAtByPaneKey[
        `tab-${layoutCount - 1}:00000000-0000-4000-8000-${(layoutCount - 1)
          .toString(16)
          .padStart(12, '0')}`
      ]
    ).toBe(1_000_000)
  })
})
