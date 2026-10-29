import { afterEach, describe, expect, it } from 'vitest'
import {
  ignoreInheritedWslHostsGateState,
  isWslHostsServing,
  publishWslHostsGateState,
  WSL_HOSTS_GATE_STATE_ENV
} from './wsl-host-internal-gate'

describe('WSL hosts gate state inherited from main', () => {
  afterEach(() => {
    publishWslHostsGateState({}, null)
  })

  // A child of a blocked run inherits ORCA_INTERNAL_WSL_HOSTS=1 but must not serve WSL state.
  it('lets a child trust the state its parent published over the internal gate env', () => {
    const gate = { ORCA_INTERNAL_WSL_HOSTS: '1' }
    expect(isWslHostsServing({ ...gate, [WSL_HOSTS_GATE_STATE_ENV]: 'closed' })).toBe(false)
    expect(isWslHostsServing({ ...gate, [WSL_HOSTS_GATE_STATE_ENV]: 'open' })).toBe(true)
    expect(isWslHostsServing({ [WSL_HOSTS_GATE_STATE_ENV]: 'serve-only' })).toBe(true)
  })

  it('falls back to the internal gate env when nothing valid was published', () => {
    expect(isWslHostsServing({ ORCA_INTERNAL_WSL_HOSTS: '1' })).toBe(true)
    expect(isWslHostsServing({ [WSL_HOSTS_GATE_STATE_ENV]: 'bogus' })).toBe(false)
  })

  it('ignores an inherited state once this process resolved the gate itself', () => {
    const env: Record<string, string | undefined> = { [WSL_HOSTS_GATE_STATE_ENV]: 'open' }
    publishWslHostsGateState(env, 'closed')

    expect(env[WSL_HOSTS_GATE_STATE_ENV]).toBe('closed')
    expect(isWslHostsServing({ [WSL_HOSTS_GATE_STATE_ENV]: 'open' })).toBe(false)
  })

  it("ignores an inherited state from main's entry on, before the gate is configured", () => {
    ignoreInheritedWslHostsGateState()

    expect(isWslHostsServing({ [WSL_HOSTS_GATE_STATE_ENV]: 'open' })).toBe(false)
    expect(
      isWslHostsServing({ ORCA_INTERNAL_WSL_HOSTS: '1', [WSL_HOSTS_GATE_STATE_ENV]: 'closed' })
    ).toBe(true)
  })
})
