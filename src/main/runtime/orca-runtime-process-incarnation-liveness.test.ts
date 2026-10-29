import { publishPtyEndpointLoss } from './terminal/pty-endpoint-loss-signal'
import type { PtyProcessInspection } from '../providers/pty-process-inspection'
import { hostTestState } from '../native-chat/agent-session-wire/structured-agent-session-host-test-harness'
import {
  agentSessionLeaseFixture,
  agentSessionRecordFixture
} from '../../shared/agent-session-record.test-fixture'
import { agentSessionConversationView } from '../../shared/agent-session-conversation-view'
import type { AgentSessionLease } from '../../shared/agent-session-record'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PtyProcessInfo } from '../providers/pty-process-info'
import { setStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import { OrcaRuntimeService } from './orca-runtime'
import { structuredWorkerIdentities } from './structured-worker-identity'

const SSH_SCOPE = JSON.stringify({ kind: 'ssh', targetId: 'ssh-1' })
const PROCESS_INCARNATION = 'remote:ssh-1:pty-1:inc-1'
const shellInspection = {
  foregroundProcess: 'zsh',
  hasChildProcesses: true,
  foregroundPresentationSupported: true,
  foregroundPresentation: 'not-in-front'
} satisfies PtyProcessInspection

function runtimeWithInventory(
  listProcesses: (hostId?: string) => Promise<PtyProcessInfo[]>
): OrcaRuntimeService {
  const runtime = new OrcaRuntimeService()
  runtime.setPtyController({
    write: () => true,
    kill: () => true,
    getForegroundProcess: async () => null,
    listProcesses
  })
  return runtime
}

describe('terminal process incarnation liveness', () => {
  it('classifies only an exact incarnation as live on its owning provider', async () => {
    const listProcesses = vi.fn().mockResolvedValue([
      {
        id: 'remote:ssh-1:pty-1',
        incarnationId: 'inc-1',
        cwd: '',
        title: 'worker'
      }
    ])
    const runtime = runtimeWithInventory(listProcesses)

    await expect(
      runtime.inspectTerminalProcessIncarnationLiveness(PROCESS_INCARNATION, SSH_SCOPE)
    ).resolves.toBe('live')
    await expect(
      runtime.inspectTerminalProcessIncarnationLiveness('remote:ssh-1:pty-1:inc-old', SSH_SCOPE)
    ).resolves.toBe('exited')
    expect(listProcesses).toHaveBeenNthCalledWith(1, 'ssh:ssh-1')
    expect(listProcesses).toHaveBeenNthCalledWith(2, 'ssh:ssh-1')
  })

  it('keeps missing or malformed identity and unavailable inventory unverifiable', async () => {
    const listProcesses = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'remote:ssh-1:pty-1', cwd: '', title: 'worker' }])
      .mockResolvedValueOnce([
        { id: 'remote:ssh-1:pty-1', incarnationId: ' inc-1 ', cwd: '', title: 'worker' }
      ])
      .mockRejectedValueOnce(new Error('provider unavailable'))
    const runtime = runtimeWithInventory(listProcesses)

    await expect(
      runtime.inspectTerminalProcessIncarnationLiveness(PROCESS_INCARNATION, SSH_SCOPE)
    ).resolves.toBe('unverifiable')
    await expect(
      runtime.inspectTerminalProcessIncarnationLiveness(PROCESS_INCARNATION, SSH_SCOPE)
    ).resolves.toBe('unverifiable')
    await expect(
      runtime.inspectTerminalProcessIncarnationLiveness(PROCESS_INCARNATION, SSH_SCOPE)
    ).resolves.toBe('unverifiable')
  })

  it('does not inspect an unproven host scope', async () => {
    const listProcesses = vi.fn().mockResolvedValue([])
    const runtime = runtimeWithInventory(listProcesses)

    await expect(
      runtime.inspectTerminalProcessIncarnationLiveness(PROCESS_INCARNATION, null)
    ).resolves.toBe('unverifiable')
    await expect(
      runtime.inspectTerminalProcessIncarnationLiveness(PROCESS_INCARNATION, '{"kind":"ssh"}')
    ).resolves.toBe('unverifiable')
    expect(listProcesses).not.toHaveBeenCalled()
  })

  it.each([
    [{ kind: 'local', hostId: 'local' }, 'local'],
    [{ kind: 'wsl', hostId: 'local', distro: 'Ubuntu' }, 'local']
  ] as const)('uses the local provider inventory for %s scope', async (scope, hostId) => {
    const listProcesses = vi.fn().mockResolvedValue([])
    const runtime = runtimeWithInventory(listProcesses)

    await expect(
      runtime.inspectTerminalProcessIncarnationLiveness('local-pty:inc-1', JSON.stringify(scope))
    ).resolves.toBe('exited')
    expect(listProcesses).toHaveBeenCalledWith(hostId)
  })
})

describe('structured worker incarnation liveness', () => {
  const SESSION = '11111111-1111-4111-a111-111111111111'
  const INCARNATION = `structured:${SESSION}`
  const LOCAL_SCOPE = JSON.stringify({ kind: 'local', hostId: 'local' })

  function installHost(lease: Partial<AgentSessionLease>): void {
    const { host, store } = hostTestState()
    vi.spyOn(host, 'hasSession').mockReturnValue(false)
    vi.spyOn(store, 'getConversation').mockImplementation(() =>
      agentSessionConversationView(
        agentSessionRecordFixture(agentSessionLeaseFixture({ ...lease, sessionId: SESSION }))
      )
    )
    setStructuredAgentSessionHost(host)
  }

  afterEach(() => {
    setStructuredAgentSessionHost(null)
    structuredWorkerIdentities.clear()
  })

  it('settles a stopped worker as exited after its identity was forgotten', async () => {
    // Settlement forgets in-memory identity; durable session records must still reconcile retained workers.
    installHost({
      runtimeKind: 'native',
      claimStatus: 'released',
      deathEvidence: { kind: 'exit-observed', detail: 'closed', observedAt: 1 },
      runtimeFence: 2
    })
    const runtime = new OrcaRuntimeService()
    expect(structuredWorkerIdentities.getBySessionId(SESSION)).toBeNull()

    await expect(
      runtime.inspectTerminalProcessIncarnationLiveness(INCARNATION, LOCAL_SCOPE)
    ).resolves.toBe('exited')
  })

  it('never answers exited from a record that proves no death', async () => {
    installHost({
      runtimeKind: 'native',
      claimStatus: 'live',
      deathEvidence: null,
      runtimeFence: 2
    })
    const runtime = new OrcaRuntimeService()

    await expect(
      runtime.inspectTerminalProcessIncarnationLiveness(INCARNATION, LOCAL_SCOPE)
    ).resolves.toBe('unverifiable')
  })

  it('stays unverifiable when no structured host is installed to look with', async () => {
    const runtime = new OrcaRuntimeService()
    await expect(
      runtime.inspectTerminalProcessIncarnationLiveness(INCARNATION, LOCAL_SCOPE)
    ).resolves.toBe('unverifiable')
  })
})

describe('accepted terminal presentation', () => {
  it('uses each paid verdict once without launch masking and preserves rows', async () => {
    const runtime = new OrcaRuntimeService()
    let result: PtyProcessInspection = shellInspection
    let finish!: (value: PtyProcessInspection) => void
    const inspectProcess = vi.fn(
      () =>
        new Promise<PtyProcessInspection>((done) => {
          finish = done
        })
    )
    const getForegroundProcess = vi.fn(async () => 'zsh')
    const confirmForegroundProcess = vi.fn(
      async (_id: string, accept?: (value: 'not-in-front') => void) => {
        accept?.('not-in-front')
        return 'zsh'
      }
    )
    runtime.setPtyController({
      write: () => true,
      kill: () => true,
      getForegroundProcess,
      inspectProcess,
      confirmForegroundProcess
    })
    runtime.registerPty('presentation-pty', '/repo', null, {
      tabId: 'tab',
      leafId: '11111111-1111-4111-8111-111111111111',
      incarnationId: 'inc-1'
    })
    const pty = runtime['ptysById'].get('presentation-pty')!
    const row = pty.lastAgentStatus
    const first = runtime.inspectPtyForegroundProcess('presentation-pty')
    expect(runtime.inspectPtyForegroundProcess('presentation-pty')).toBe(first)
    runtime.terminalRunFacts.recordInput('presentation-pty', 'launch', 'codex\r')
    finish(result)
    expect((await first).presentation).toMatchObject({
      support: 'supported',
      state: 'not-in-front'
    })
    expect(inspectProcess).toHaveBeenCalledTimes(1)
    result = { ...result, foregroundProcess: 'codex', foregroundPresentation: 'agent-in-front' }
    const started = runtime.inspectPtyForegroundProcess('presentation-pty')
    finish(result)
    expect((await started).presentation?.state).toBe('agent-in-front')
    result = { ...result, foregroundProcess: 'zsh', foregroundPresentation: 'not-in-front' }
    const quit = runtime.inspectPtyForegroundProcess('presentation-pty')
    finish(result)
    expect((await quit).presentation?.state).toBe('not-in-front')
    const fact = pty.presentation
    pty.launchAgent = 'codex'
    await runtime['ptyForegroundAgent'].refresh('presentation-pty')
    expect(getForegroundProcess).toHaveBeenCalledTimes(1)
    expect(pty.foregroundAgent).toBeNull()
    runtime.terminalRunFacts.recordInput('presentation-pty', 'driving', 'fg\r')
    expect(pty.presentation).toBe(fact)
    const duplicate = runtime.inspectPtyForegroundProcess('presentation-pty')
    finish(result)
    await duplicate
    expect(pty.presentation).toBe(fact)
    expect(pty.lastAgentStatus).toBe(row)
    const confirmed = await runtime.confirmPtyForegroundPresentation('presentation-pty')
    expect(confirmed.foregroundProcess).toBe('zsh')
    expect(confirmed.presentation).toBe(fact)
    expect(confirmForegroundProcess).toHaveBeenCalledTimes(1)
    const stale = runtime.inspectPtyForegroundProcess('presentation-pty')
    runtime.registerPty('presentation-pty', '/repo', null, {
      tabId: 'tab',
      leafId: '11111111-1111-4111-8111-111111111111',
      incarnationId: 'inc-2'
    })
    finish(result)
    expect((await stale).presentation).toBeUndefined()
  })
  it.each(['inspect', 'read', 'confirm'] as const)(
    'fences pending %s across same-record forget and keeps the runtime clock',
    async (path) => {
      const runtime = new OrcaRuntimeService()
      const finishes: ((state: 'not-in-front' | 'agent-in-front') => void)[] = []
      const inspectProcess = vi.fn(
        () =>
          new Promise<PtyProcessInspection>((resolve) => {
            finishes.push((state) => resolve({ ...shellInspection, foregroundPresentation: state }))
          })
      )
      const scalar = vi.fn(
        (_id: string, accept?: (value: 'not-in-front' | 'agent-in-front') => void) =>
          new Promise<string>((resolve) =>
            finishes.push((state) => {
              accept?.(state)
              resolve(state === 'agent-in-front' ? 'codex' : 'zsh')
            })
          )
      )
      runtime.setPtyController({
        write: () => true,
        kill: () => true,
        inspectProcess,
        getForegroundProcess: scalar,
        confirmForegroundProcess: scalar
      })
      const id = `clock-${path}`
      runtime.registerPty(id, '/repo', null, {
        tabId: 'tab',
        leafId: '11111111-1111-4111-8111-111111111111',
        incarnationId: 'same-I'
      })
      const owner = runtime['ptyForegroundAgent']
      const record = runtime['ptysById'].get(id)!
      const read = () =>
        path === 'inspect'
          ? owner.inspect(id)
          : path === 'read'
            ? owner.read(id)!
            : owner.confirmPresentation(id)
      const initial = read()
      finishes.shift()!('not-in-front')
      await initial
      const first = record.presentation!
      const stale = read()
      const finishStale = finishes.shift()!
      owner.forget(id)
      const next = read()
      expect(path === 'inspect' ? inspectProcess : scalar).toHaveBeenCalledTimes(3)
      finishes.shift()!('agent-in-front')
      await next
      expect(record.presentation?.state).toBe('agent-in-front')
      expect(record.presentation!.version).toBeGreaterThan(first.version)
      const current = record.presentation
      finishStale('not-in-front')
      await stale
      expect(record.presentation).toBe(current)
      const lost = read()
      const finishLost = finishes.shift()!
      publishPtyEndpointLoss(id)
      expect(record.presentation).toBeUndefined()
      finishLost('not-in-front')
      await lost
      expect(record.presentation).toBeUndefined()
      runtime.registerPty(id, '/repo', null, {
        tabId: 'tab',
        leafId: '11111111-1111-4111-8111-111111111111',
        incarnationId: 'same-I'
      })
      const recreated = read()
      finishes.shift()!('not-in-front')
      await recreated
      expect(runtime['ptysById'].get(id)?.presentation?.version).toBeGreaterThan(current!.version)
      owner.forget(id)
    }
  )

  it('distinguishes successful legacy, modern unknown and errors without new reads on failure settlement', async () => {
    const runtime = new OrcaRuntimeService()
    const inspectProcess = vi.fn(async (): Promise<PtyProcessInspection> => ({
      foregroundProcess: 'zsh',
      hasChildProcesses: true
    }))
    runtime.setPtyController({
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null,
      inspectProcess
    })
    runtime.registerPty('legacy-pty', '/repo', null, {
      tabId: 'pending',
      leafId: '11111111-1111-4111-8111-111111111111',
      incarnationId: 'inc'
    })
    expect((await runtime.inspectPtyForegroundProcess('legacy-pty')).presentation?.support).toBe(
      'legacy'
    )
    inspectProcess.mockResolvedValue({
      foregroundProcess: null,
      hasChildProcesses: true,
      foregroundPresentationSupported: true
    })
    expect((await runtime.inspectPtyForegroundProcess('legacy-pty')).presentation).toMatchObject({
      support: 'supported',
      state: undefined
    })
    inspectProcess.mockRejectedValueOnce(new Error('transport lost'))
    await expect(runtime.inspectPtyForegroundProcess('legacy-pty')).rejects.toThrow(
      'transport lost'
    )
    inspectProcess.mockResolvedValue(shellInspection)
    expect((await runtime.inspectPtyForegroundProcess('legacy-pty')).presentation?.state).toBe(
      'not-in-front'
    )
    const pty = runtime['ptysById'].get('legacy-pty')!
    runtime['setPtyConnected'](pty, false)
    expect(pty.presentation).toBeUndefined()
  })
})

describe('paid host fact publication work', () => {
  it.each([10, 100])(
    'measures actual %s-member scans and full projections at L0/1/2',
    async (n) => {
      for (const listeners of [0, 1, 2]) {
        const runtime = new OrcaRuntimeService()
        const inspectProcess = vi.fn(
          async (): Promise<
            PtyProcessInspection & {
              foregroundPresentation: 'agent-in-front' | 'not-in-front'
            }
          > => shellInspection
        )
        runtime.setPtyController({
          write: () => true,
          kill: () => true,
          getForegroundProcess: async (_id, accept) => {
            const result = await inspectProcess()
            accept?.(result.foregroundPresentation)
            return result.foregroundProcess
          },
          inspectProcess
        })
        const leafId = '11111111-1111-4111-8111-111111111111'
        const tabs = Array.from({ length: n }, (_, i) => {
          runtime.registerPty(`cost-${i}`, 'cost-wt', null, {
            tabId: `cost-tab-${i}`,
            leafId,
            incarnationId: 'inc'
          })
          return {
            type: 'terminal' as const,
            id: `cost-tab-${i}::${leafId}`,
            parentTabId: `cost-tab-${i}`,
            leafId,
            title: 'Terminal',
            ptyId: `cost-${i}`,
            isActive: i === 0
          }
        })
        // SAFETY: this is the existing internal terminal snapshot shape; all rows are registered above.
        runtime['mobileSessionTabsByWorktree'].set('cost-wt', {
          worktree: 'cost-wt',
          publicationEpoch: 'headless:cost',
          snapshotVersion: 1,
          activeGroupId: null,
          activeTabId: null,
          activeTabType: null,
          tabs
        })
        let predicates = 0
        const some = tabs.some.bind(tabs)
        vi.spyOn(tabs, 'some').mockImplementation((predicate) =>
          some((tab, i, rows) => {
            predicates++
            return predicate(tab, i, rows)
          })
        )
        let sourceRows = 0
        let projectedRows = 0
        const project = runtime['toMobileSessionTabsResult'].bind(runtime)
        const perClient = runtime['projectMobileSessionTabsForClient'].bind(runtime)
        type ProjectionOwner = {
          toMobileSessionTabsResult: typeof project
          projectMobileSessionTabsForClient: typeof perClient
        }
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: both private methods exist on this instance; ProjectionOwner uses their exact bracket-accessed signatures.
        const projectionOwner = runtime as unknown as ProjectionOwner
        vi.spyOn(projectionOwner, 'toMobileSessionTabsResult').mockImplementation((snapshot) => {
          sourceRows += snapshot.tabs.length
          return project(snapshot)
        })
        vi.spyOn(projectionOwner, 'projectMobileSessionTabsForClient').mockImplementation(
          (snapshot, id) => {
            projectedRows += snapshot.tabs.length
            return perClient(snapshot, id)
          }
        )
        const callbacks = Array.from({ length: listeners }, () => vi.fn())
        const stops = callbacks.map((callback) => runtime.onMobileSessionTabsChanged(callback))
        for (let i = 0; i < n; i++) {
          await runtime['ptyForegroundAgent'].refresh(`cost-${n - 1}`)
          runtime['flushScheduledMobileSessionTabsChanged']('cost-wt')
          inspectProcess.mockResolvedValue({
            foregroundProcess: i % 2 ? 'zsh' : 'codex',
            hasChildProcesses: true,
            foregroundPresentationSupported: true,
            foregroundPresentation: i % 2 ? 'not-in-front' : 'agent-in-front'
          })
        }
        expect(predicates).toBe(n * n)
        expect(sourceRows).toBe(listeners ? n * n : 0)
        expect(projectedRows).toBe(listeners * n * n)
        callbacks.forEach((callback) => expect(callback).toHaveBeenCalledTimes(n))
        const prior = predicates
        await runtime.inspectPtyForegroundProcess(`cost-${n - 1}`)
        await runtime.inspectPtyForegroundProcess(`cost-${n - 1}`)
        expect(predicates - prior).toBe(n)
        stops.forEach((stop) => stop())
        console.info(
          'PRESENTATION_HOST_COST',
          JSON.stringify({ n, listeners, predicates: prior, sourceRows, projectedRows })
        )
      }
    }
  )
})
