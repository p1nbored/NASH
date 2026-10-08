import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PermissionRequestParams,
  PermissionWaitParams
} from '../../../../../../shared/rpc-contract/permission-relay-params'
import { OrcaRuntimeService } from '../../../../orca-runtime'
import { PERMISSION_RELAY_ERROR_CODES } from '../../../../permission-relay/permission-relay-caller'
import { registerPermissionRelay } from '../../../../permission-relay/permission-relay-registry'
import {
  FIXTURE_EVIDENCE,
  FIXTURE_START_MS,
  createRelayHarness,
  relayRequest,
  type RelayHarness
} from '../../../../permission-relay/permission-relay.test-fixture'
import type { RpcContext } from '../../../core'
import {
  ORCHESTRATION_PERMISSION_METHODS,
  PERMISSION_REQUEST_METHOD,
  PERMISSION_WAIT_METHOD
} from './permission-methods'

describe('orchestration permission methods', () => {
  let harness: RelayHarness
  let runtime: OrcaRuntimeService
  let unregister: () => void

  beforeEach(() => {
    vi.useFakeTimers({ now: FIXTURE_START_MS })
    harness = createRelayHarness()
    runtime = new OrcaRuntimeService()
    unregister = registerPermissionRelay(runtime, harness.service)
  })
  afterEach(() => {
    unregister()
    harness.service.dispose()
    harness.owner.close()
    vi.useRealTimers()
  })

  it('declares the hidden request and wait methods with the shared strict params', () => {
    expect(ORCHESTRATION_PERMISSION_METHODS.map((entry) => entry.name)).toEqual([
      'orchestration.permissionRequest',
      'orchestration.permissionWait',
      'orchestration.permissionList',
      'orchestration.permissionAnswer'
    ])
    expect(PERMISSION_REQUEST_METHOD.params).toBe(PermissionRequestParams)
    expect(PERMISSION_WAIT_METHOD.params).toBe(PermissionWaitParams)
  })

  it('takes the caller from the attested request evidence, never from params', async () => {
    const context: RpcContext = { runtime, orchestrationCompatibilityEvidence: FIXTURE_EVIDENCE }
    const created = await PERMISSION_REQUEST_METHOD.handler(relayRequest(), context)
    expect(created).toMatchObject({ outcome: 'relayed' })
    await expect(
      Promise.resolve().then(() => PERMISSION_REQUEST_METHOD.handler(relayRequest(), { runtime }))
    ).rejects.toMatchObject({ code: PERMISSION_RELAY_ERROR_CODES.callerRefused })
  })

  it('waits in a slice and ends early when the client disconnects', async () => {
    const context: RpcContext = { runtime, orchestrationCompatibilityEvidence: FIXTURE_EVIDENCE }
    const created = harness.service.request(FIXTURE_EVIDENCE, relayRequest())
    const decisionId = created.outcome === 'relayed' ? created.decisionId : ''
    const abort = new AbortController()
    const waiting = PERMISSION_WAIT_METHOD.handler(
      { decisionId, waitMs: 20_000 },
      { ...context, signal: abort.signal }
    )
    abort.abort()
    await expect(waiting).resolves.toEqual({ state: 'pending' })
  })

  it('refuses every call while no relay is installed for the runtime', async () => {
    unregister()
    await expect(
      Promise.resolve().then(() =>
        PERMISSION_REQUEST_METHOD.handler(relayRequest(), {
          runtime,
          orchestrationCompatibilityEvidence: FIXTURE_EVIDENCE
        })
      )
    ).rejects.toMatchObject({ code: PERMISSION_RELAY_ERROR_CODES.unavailable })
  })
})
