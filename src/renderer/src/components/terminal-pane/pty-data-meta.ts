export type PtyDataMeta = {
  seq?: number
  rawLength?: number
  transformed?: boolean
  background?: boolean
  /** Main dropped this PTY's buffered output at the pending cap; repaint from the main-owned snapshot, not the live stream. */
  droppedOutput?: boolean
  /** Escape main's dropped bytes left open where this chunk begins; only an abandoned restore uses it. */
  gapEscapeState?: string
}

export function ptyDataMeta(payload: {
  id: string
  data: string
  seq?: number
  rawLength?: number
  transformed?: boolean
  background?: boolean
  droppedOutput?: boolean
  gapEscapeState?: string
}): PtyDataMeta | undefined {
  let meta: PtyDataMeta | undefined
  if (typeof payload.seq === 'number') {
    meta ??= {}
    meta.seq = payload.seq
  }
  if (typeof payload.rawLength === 'number') {
    meta ??= {}
    meta.rawLength = payload.rawLength
  }
  if (payload.transformed === true) {
    meta ??= {}
    meta.transformed = true
  }
  if (payload.background === true) {
    meta ??= {}
    meta.background = true
  }
  if (payload.droppedOutput === true) {
    meta ??= {}
    meta.droppedOutput = true
  }
  if (typeof payload.gapEscapeState === 'string' && payload.gapEscapeState.length > 0) {
    meta ??= {}
    meta.gapEscapeState = payload.gapEscapeState
  }
  return meta
}
