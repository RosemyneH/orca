import {
  beginDesktopPresentationInspection,
  desktopPresentationSnapshot
} from './terminal-foreground-presentation'
import type { RuntimeTerminalSend } from '../../../shared/runtime-types'
import { isTerminalInputTooLargeWithDeferredMeasurement } from '../../../shared/terminal-input'
import { recordRuntimeTerminalInputForPtyId } from './runtime-terminal-input-recording'
import { callRuntimeRpc, runtimeEnvironmentSupportsCapability } from './runtime-rpc-client'
import { ensureLocalRuntimeCapabilities } from './local-runtime-capabilities'
import { TERMINAL_FOREGROUND_PRESENTATION_CAPABILITY } from '../../../shared/terminal-runtime-capabilities'
import {
  getRemoteRuntimePtyEnvironmentId,
  getRemoteRuntimePtyOwner
} from './runtime-terminal-stream'
import { parseAppSshPtyId } from '../../../shared/ssh-pty-id'
import { isRemoteRuntimePtyId } from '../../../shared/remote-runtime/remote-runtime-pty-id'
import {
  classifyTerminalProcessInspectionFailure,
  clientOnlyUnverifiableInspection,
  isClientOnlyUnverifiableInspection,
  type TerminalProcessInspection
} from '../../../shared/terminal-process-inspection'
import type { TerminalInputKind } from '../../../shared/terminal-input-kind'

export type RuntimeTerminalProcessInspection = TerminalProcessInspection

const DESKTOP_RUNTIME_CLIENT = { id: 'orca-desktop', type: 'desktop' } as const
function isRuntimePtyInputTooLarge(data: string): boolean | Promise<boolean> {
  return isTerminalInputTooLargeWithDeferredMeasurement(data)
}

function isRemoteInspectionPtyId(ptyId: string): boolean {
  return getRemoteRuntimePtyEnvironmentId(ptyId) !== null || parseAppSshPtyId(ptyId) !== null
}

function normalizeInspectionResult(
  result: TerminalProcessInspection,
  remote: boolean
): RuntimeTerminalProcessInspection {
  if (typeof result !== 'object' || result === null) {
    return clientOnlyUnverifiableInspection(remote ? 'old_host' : 'terminal_gone')
  }
  // A client-only result may have crossed a mixed-version preload/runtime boundary.
  if (isClientOnlyUnverifiableInspection(result)) {
    return clientOnlyUnverifiableInspection(
      typeof result.reason === 'string' ? result.reason : 'transport_loss'
    )
  }
  // Old-host compatibility process names are not observed evidence; exclude them from remote identity.
  if (remote && result.foregroundProcessEvidence === undefined) {
    return clientOnlyUnverifiableInspection('old_host')
  }
  // Normalize removed booleans from older main/preload pairs during upgrades.
  if (
    result &&
    typeof result === 'object' &&
    'unavailable' in result &&
    (result as { unavailable?: unknown }).unavailable === true
  ) {
    return clientOnlyUnverifiableInspection('terminal_gone')
  }
  return result
}

export async function inspectRuntimeTerminalProcess(
  ptyId: string,
  options?: { expectedIncarnationId?: string; scanChildProcesses?: boolean; steadyState?: boolean },
  delivery = beginDesktopPresentationInspection(ptyId)
): Promise<RuntimeTerminalProcessInspection> {
  const startedAt = performance.now()
  const expectedIncarnationId =
    options?.expectedIncarnationId ?? desktopPresentationSnapshot(ptyId)?.incarnationId ?? null
  const accept = (result: RuntimeTerminalProcessInspection): RuntimeTerminalProcessInspection => {
    const shape = normalizeInspectionResult(result, false)
    delivery.deliver(isClientOnlyUnverifiableInspection(shape) ? shape : result, {
      remote,
      expectedIncarnationId,
      startedAt
    })
    return normalizeInspectionResult(result, remote)
  }

  const owner = getRemoteRuntimePtyOwner(ptyId)
  const remote = isRemoteInspectionPtyId(ptyId)
  if (!owner) {
    try {
      const result = await (options
        ? window.api.pty.inspectProcess(ptyId, options)
        : window.api.pty.inspectProcess(ptyId))
      return accept(result)
    } catch (error) {
      delivery.fail()
      const reason = classifyTerminalProcessInspectionFailure(error)
      if (reason) {
        return accept(clientOnlyUnverifiableInspection(reason))
      }
      throw error
    }
  }

  try {
    const result = await callRuntimeRpc<{ process: RuntimeTerminalProcessInspection }>(
      owner.target,
      'terminal.inspectProcess',
      {
        terminal: owner.terminal,
        ...(options?.expectedIncarnationId
          ? { expectedIncarnationId: options.expectedIncarnationId }
          : {}),
        // Close guards request real process scans; dropping this causes unverifiable and confirmation on every idle remote Windows close.
        ...(options?.scanChildProcesses === true ? { scanChildProcesses: true } : {}),
        ...(options?.steadyState === true ? { steadyState: true } : {})
      },
      {
        timeoutMs: 15_000,
        expectedEnvironmentPairingRevision: delivery.owner?.contact.revision,
        expectedEnvironmentRuntimeId: delivery.owner?.contact.runtimeId
      }
    )
    return accept(result.process)
  } catch (error) {
    delivery.fail()
    const reason = classifyTerminalProcessInspectionFailure(error)
    if (reason) {
      return accept(clientOnlyUnverifiableInspection(reason))
    }
    throw error
  }
}

const shownReads = new Map<
  string,
  { delivery: ReturnType<typeof beginDesktopPresentationInspection>; promise: Promise<void> }
>()
export function inspectDesktopShownTerminal(
  ptyId: string,
  options?: { expectedIncarnationId?: string }
): Promise<void> {
  const delivery = beginDesktopPresentationInspection(ptyId)
  const prior = shownReads.get(ptyId)
  if (prior && prior.delivery.owner === delivery.owner && prior.delivery.current()) {
    return prior.promise
  }
  const retire = () => {
    if (shownReads.get(ptyId)?.delivery === delivery) {
      shownReads.delete(ptyId)
    }
  }
  const request = (async () => {
    const owner = getRemoteRuntimePtyOwner(ptyId)
    const supported = owner
      ? await runtimeEnvironmentSupportsCapability(
          owner.target.environmentId,
          TERMINAL_FOREGROUND_PRESENTATION_CAPABILITY
        )
      : (await ensureLocalRuntimeCapabilities())?.includes(
          TERMINAL_FOREGROUND_PRESENTATION_CAPABILITY
        )
    if (supported && delivery.current()) {
      await inspectRuntimeTerminalProcess(ptyId, options, delivery)
    }
  })().finally(() => {
    delivery.owner?.dispose.delete(retire)
    if (shownReads.get(ptyId)?.promise === request) {
      shownReads.delete(ptyId)
    }
  })
  shownReads.set(ptyId, { delivery, promise: request })
  delivery.owner?.dispose.add(retire)
  return request
}

/**
 * Forces a fresh, uncached foreground scan for a pane whose cached inspection
 * is suspect (issue #11064: the cached read can flap to the shell for a live
 * agent). Local/daemon panes only — runtime environments expose no fresh-scan
 * RPC, and an SSH provider without confirm support answers null, which callers
 * must read as "no new evidence", never as a shell confirmation.
 */
export async function confirmRuntimeTerminalForegroundProcess(
  ptyId: string
): Promise<string | null> {
  // Why any remote id: an id without an owner segment still runs off this host, never locally.
  if (isRemoteRuntimePtyId(ptyId)) {
    return null
  }
  const confirmForegroundProcess = window.api.pty.confirmForegroundProcess
  // Why the shape check: a preload older than this handler has no such method.
  if (typeof confirmForegroundProcess !== 'function') {
    return null
  }
  const startedAt = performance.now()
  const expectedIncarnationId = desktopPresentationSnapshot(ptyId)?.incarnationId ?? null
  const deliver = beginDesktopPresentationInspection(ptyId)
  try {
    const result = await confirmForegroundProcess(ptyId, { includePresentation: true })
    const inspection =
      result !== null && typeof result === 'object' ? result : { foregroundProcess: result }
    if (result === null) {
      deliver.deliver(clientOnlyUnverifiableInspection('transport_loss'), {
        remote: isRemoteInspectionPtyId(ptyId),
        expectedIncarnationId,
        startedAt
      })
      return null
    }
    deliver.deliver(
      { ...inspection, hasChildProcesses: true },
      {
        remote: isRemoteInspectionPtyId(ptyId),
        expectedIncarnationId,
        startedAt,
        legacy: typeof result === 'string'
      }
    )
    return inspection.foregroundProcess
  } catch {
    deliver.deliver(clientOnlyUnverifiableInspection('transport_loss'), {
      remote: isRemoteInspectionPtyId(ptyId),
      expectedIncarnationId,
      startedAt
    })
    return null
  }
}

export function sendRuntimePtyInput(
  ptyId: string,
  data: string,
  inputKind: TerminalInputKind
): boolean {
  const tooLarge = isRuntimePtyInputTooLarge(data)
  if (tooLarge === true) {
    return false
  }
  if (tooLarge !== false) {
    // Yield before validating/dispatching fire-and-forget paste-sized input to avoid blocking renderer.
    void tooLarge
      .then((resolvedTooLarge) => {
        if (!resolvedTooLarge) {
          sendRuntimePtyInputWithinLimit(ptyId, data, inputKind)
        }
      })
      .catch(() => {})
    return true
  }
  return sendRuntimePtyInputWithinLimit(ptyId, data, inputKind)
}

// Only local writes accept launch kind; terminal.send’s query-reply kind is mobile-only, so host classifies desktop remote writes by bytes.
function sendRuntimePtyInputWithinLimit(
  ptyId: string,
  data: string,
  inputKind: TerminalInputKind
): boolean {
  const owner = getRemoteRuntimePtyOwner(ptyId)
  if (!owner) {
    window.api.pty.write(ptyId, data, inputKind)
    recordRuntimeTerminalInputForPtyId(ptyId)
    return true
  }

  void callRuntimeRpc<{ send: RuntimeTerminalSend }>(
    owner.target,
    'terminal.send',
    { terminal: owner.terminal, text: data, client: DESKTOP_RUNTIME_CLIENT },
    { timeoutMs: 15_000 }
  )
    .then((result) => {
      if (result.send.accepted === true) {
        recordRuntimeTerminalInputForPtyId(ptyId)
      }
    })
    .catch(() => {
      // Mirror can retire handles while xterm flushes final input; next host snapshot reattaches.
    })
  return true
}
