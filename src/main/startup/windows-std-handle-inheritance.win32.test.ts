import { once } from 'node:events'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { spawnProcess } from '@orca/process-host'

const describeOnWindows = process.platform === 'win32' ? describe : describe.skip
const ADDON_DIR = resolve(__dirname, '..', '..', '..', 'native', 'windows-security')

/** A child that optionally clears its std handles, writes through a stdio:'inherit' grandchild,
 * then leaves a detached stdio:'ignore' holder behind, like the WSL holder or the daemon. */
const CHILD = `
const security = require(${JSON.stringify(join(ADDON_DIR, 'index.js'))})
const [, mode, holderMs] = process.argv
if (mode === 'clear') {
  const failures = security.clearStdHandleInheritance()
  if (failures.length > 0) { process.stderr.write(JSON.stringify(failures)); process.exit(3) }
}
const { spawn, spawnSync } = require('node:child_process')
spawnSync(process.execPath, ['-e', 'process.stdout.write("inherited-output\\\\n")'], { stdio: 'inherit', windowsHide: true })
const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, ' + holderMs + ')'], { stdio: 'ignore', detached: true, windowsHide: true })
holder.unref()
process.stdout.write('holder ' + holder.pid + '\\n')
`

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Runs CHILD and reports its output and whether its holder outlived the pipe's close. */
async function runChild(mode: 'clear' | 'keep', holderMs: number) {
  const child = spawnProcess({
    program: process.execPath,
    args: ['-e', CHILD, mode, String(holderMs)],
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk) => (stdout += chunk))
  child.stderr?.on('data', (chunk) => (stderr += chunk))
  const [code] = await once(child, 'close', { signal: AbortSignal.timeout(holderMs + 10_000) })
  const holderPid = Number(/holder (\d+)/.exec(stdout)?.[1])
  const holderAliveAtClose = isAlive(holderPid)
  if (holderAliveAtClose) {
    process.kill(holderPid)
  }
  return { code, stdout, stderr, holderAliveAtClose }
}

describeOnWindows('clearing std handle inheritance', () => {
  it('keeps stdio inherit output and frees the pipe while a detached holder lives', async () => {
    const run = await runChild('clear', 60_000)

    expect(run.stderr).toBe('')
    expect(run.code).toBe(0)
    expect(run.stdout).toContain('inherited-output')
    expect(run.holderAliveAtClose).toBe(true)
  })

  it('without it, the holder keeps the pipe open until it exits (control)', async () => {
    const run = await runChild('keep', 3_000)

    expect(run.code).toBe(0)
    expect(run.stdout).toContain('inherited-output')
    expect(run.holderAliveAtClose).toBe(false)
  })
})
