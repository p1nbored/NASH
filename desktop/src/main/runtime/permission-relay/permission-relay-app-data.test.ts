import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFakeAppEnvironment } from '../../../../config/scripts/vitest-host-ports-setup'
import { relayAppDataDirectories } from './permission-relay-registry'
import {
  FIXTURE_EVIDENCE,
  FIXTURE_START_MS,
  createRelayHarness,
  relayRequest,
  type RelayHarness
} from './permission-relay.test-fixture'

// FIXTURE_ONLY: the data folder below is synthetic; nothing under it is read.
const USER_DATA = 'C:\\fixture\\AppData\\Roaming\\nash'

describe("permission relay: the app's own data folder stays on the desktop (M3)", () => {
  let harness: RelayHarness

  beforeEach(() => {
    vi.useFakeTimers({ now: FIXTURE_START_MS })
    harness = createRelayHarness({ appDataDirectories: [USER_DATA] })
  })
  afterEach(() => {
    harness.service.dispose()
    harness.owner.close()
    vi.useRealTimers()
  })

  it('requires the user for an app-data prompt and offers its redacted summary to dot', () => {
    const result = harness.service.request(
      FIXTURE_EVIDENCE,
      relayRequest({ toolName: 'Read', toolInput: { file_path: `${USER_DATA}\\orchestration.db` } })
    )
    expect(result.outcome).toBe('relayed')
    const id = result.outcome === 'relayed' ? result.decisionId : 'missing'
    expect(harness.store.get(id)?.summary.startsWith('Desktop only. ')).toBe(true)
    expect(
      harness.service.listForDot('run_fixture01', { limit: 10 }).map((record) => record.decisionId)
    ).toEqual([id])
    expect(() => harness.service.answerFromDot({ decisionId: id, decision: 'allow' })).toThrow()
  })

  it('reads the data folder from the app environment for the production wiring', () => {
    installFakeAppEnvironment({
      getPath: (name) => (name === 'userData' ? USER_DATA : `C:\\fixture\\${name}`)
    })
    expect(relayAppDataDirectories()).toEqual([USER_DATA])
  })
})
