import { recognizeAgentProcess } from '../../shared/agent-process-recognition'
import type { TerminalAgent } from '../../shared/terminal-agent'
import { withTimeoutResult } from './runtime-async-boundaries'
import { TERMINAL_INTERACTIVE_WAIT_PROBE_TIMEOUT_MS } from './orca-runtime-core'
import type { RuntimePtyController } from './runtime-pty-controller-contract'
import type { ForegroundPresentationDependencies } from './runtime-pty-foreground-presentation'
import type { PtyForegroundProcessRead } from './runtime-terminal-contracts'

const NATIVE_CLAUDE_VERSION_NAME = /^\d+\.\d+\.\d+$/
export class RuntimePtyAgentIdentification {
  private readonly identifies = new Map<string, Promise<TerminalAgent | null>>()
  // A scan's recognized agent for a version name holds while that name stays in the foreground.
  private readonly confirmedByPtyId = new Map<
    string,
    { foregroundName: string; agent: TerminalAgent }
  >()

  constructor(
    private readonly deps: ForegroundPresentationDependencies,
    private readonly read: (
      ptyId: string,
      afterTitle?: number
    ) => Promise<PtyForegroundProcessRead> | null
  ) {}
  /**
   * Null when launch, foreground, or command evidence owns the pane, or `isCandidate` declines; resolves undefined only on timeout.
   * Not stored on the pty: a dialog declined before any title would leave no title transition to clear it.
   */
  identifyUnowned(
    ptyId: string,
    isCandidate: () => boolean
  ): Promise<TerminalAgent | null | undefined> | null {
    const pty = this.deps.getPty(ptyId)
    if (
      !pty ||
      (pty.launchAgent ?? pty.foregroundAgent ?? pty.launchCommandAgent) ||
      !isCandidate()
    ) {
      return null
    }
    let pending = this.identifies.get(ptyId)
    if (!pending) {
      pending = this.identify(ptyId).finally(() => this.identifies.delete(ptyId))
      this.identifies.set(ptyId, pending)
    }
    return withTimeoutResult(pending, TERMINAL_INTERACTIVE_WAIT_PROBE_TIMEOUT_MS).then((result) =>
      result.ok ? result.value : undefined
    )
  }

  forget(ptyId: string): void {
    this.confirmedByPtyId.delete(ptyId)
  }
  private async identify(ptyId: string): Promise<TerminalAgent | null> {
    const controller = this.deps.getController()
    const pty = this.deps.getPty(ptyId)
    if (!controller || !pty?.connected) {
      return null
    }
    const result = await this.read(ptyId)
    if (!result || result.controller !== this.deps.getController() || !result.available) {
      return null
    }
    const foregroundName = result.process
    const agent = recognizeAgentProcess(foregroundName)?.agent ?? null
    // Native Claude's p_comm is its versions/<semver> binary; only a process-table scan reads its argv.
    if (agent || !foregroundName || !NATIVE_CLAUDE_VERSION_NAME.test(foregroundName)) {
      this.confirmedByPtyId.delete(ptyId)
      return agent
    }
    const confirmed = this.confirmedByPtyId.get(ptyId)
    if (confirmed?.foregroundName === foregroundName) {
      return confirmed.agent
    }
    // Windows native Claude is claude.exe (recognized by name), and confirm there forces a full scan.
    if (process.platform === 'win32') {
      return null
    }
    const confirmedAgent =
      recognizeAgentProcess(await this.confirm(result.controller, ptyId))?.agent ?? null
    if (result.controller !== this.deps.getController()) {
      return null
    }
    // Only a recognized agent is kept, so a "not an agent" verdict is rescanned on the next dialog.
    if (confirmedAgent) {
      this.confirmedByPtyId.set(ptyId, { foregroundName, agent: confirmedAgent })
    }
    return confirmedAgent
  }

  private async confirm(controller: RuntimePtyController, ptyId: string): Promise<string | null> {
    try {
      return (await controller.confirmForegroundProcess?.(ptyId)) ?? null
    } catch {
      return null
    }
  }
  async load(ptyId: string, afterTitle: number): Promise<boolean> {
    const controller = this.deps.getController()
    const pty = this.deps.getPty(ptyId)
    if (!controller || !pty?.connected) {
      return false
    }
    const presentation = pty.presentation
    const result = await this.read(ptyId, afterTitle)
    if (!result || result.controller !== this.deps.getController() || !result.available) {
      return false
    }
    const agent = pty.launchAgent
      ? pty.foregroundAgent
      : result.process
        ? (recognizeAgentProcess(result.process)?.agent ?? null)
        : null
    const changed = pty.foregroundAgent !== agent || pty.presentation !== presentation
    pty.foregroundAgent = agent
    if (changed) {
      this.deps.touchSnapshot(ptyId)
    }
    return changed
  }
}
