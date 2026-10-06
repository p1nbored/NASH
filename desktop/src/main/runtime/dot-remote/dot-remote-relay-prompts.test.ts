import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../orca-runtime'
import { registerPermissionRelay } from '../permission-relay/permission-relay-registry'
import { createDotRemoteRelayPrompts } from './dot-remote-relay-prompts'

// L11: without a running relay the remote shows no prompts, as before, but the code is logged once
// per outage so an empty prompt list can be explained.

const OPTIONS = { statuses: ['pending'] as const, limit: 50 }
const UNAVAILABLE = {
  event: 'dot_remote_prompts_unavailable',
  code: 'autopilot_permission_relay_unavailable'
}

function fakeRuntime(): OrcaRuntimeService {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the relay registry keys by identity only.
  return {} as never
}

describe('dot remote relay prompts', () => {
  it('returns no prompts while no relay runs, and logs the code once per outage', () => {
    const log = vi.fn()
    const list = createDotRemoteRelayPrompts(fakeRuntime(), log)
    expect(list('run_1', OPTIONS)).toEqual([])
    expect(list('run_2', OPTIONS)).toEqual([])
    expect(log.mock.calls).toEqual([[UNAVAILABLE]])
  })

  it('reads the relay once it runs, and logs a later outage again', () => {
    const runtime = fakeRuntime()
    const log = vi.fn()
    const list = createDotRemoteRelayPrompts(runtime, log)
    list('run_1', OPTIONS)
    const record = { decisionId: 'pd_fixture_1' }
    const listForDot = vi.fn(() => [record])
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the reader calls only listForDot.
    const unregister = registerPermissionRelay(runtime, { listForDot } as never)
    expect(list('run_1', OPTIONS)).toEqual([record])
    expect(listForDot).toHaveBeenCalledWith('run_1', OPTIONS)
    unregister()
    expect(list('run_1', OPTIONS)).toEqual([])
    expect(log.mock.calls).toEqual([[UNAVAILABLE], [UNAVAILABLE]])
  })

  it('logs a failing relay read by code, never by its message', () => {
    const runtime = fakeRuntime()
    const log = vi.fn()
    const listForDot = vi.fn(() => {
      throw Object.assign(new Error('Fixture: C:\\private\\nash.db is locked'), {
        code: 'SQLITE_BUSY'
      })
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the reader calls only listForDot.
    const unregister = registerPermissionRelay(runtime, { listForDot } as never)
    try {
      expect(createDotRemoteRelayPrompts(runtime, log)('run_1', OPTIONS)).toEqual([])
      expect(log.mock.calls).toEqual([
        [{ event: 'dot_remote_prompts_unavailable', code: 'SQLITE_BUSY' }]
      ])
    } finally {
      unregister()
    }
  })
})
