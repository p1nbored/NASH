import { describe, expect, it } from 'vitest'
import { DotRemoteInboxItemSchema } from '../../../shared/dot-remote/dot-remote-inbox'
import {
  leased,
  payloadOf,
  requestId,
  submitArgs
} from '../../../shared/dot-remote/dot-remote-vector-kit.test-fixture'
import { submittedView } from './dot-remote-agent.test-fixture'
import { dispatchLeasedItem, DOT_REMOTE_LONG_DISPATCH_TIMEOUT_MS } from './dot-remote-item-dispatch'
import { fakeLocalEndpoint } from './dot-remote.test-fixture'

describe('remote submit dispatch', () => {
  it.each([
    { extra: {}, method: 'dotIngress.requests.submit' },
    { extra: { coordinatorRunId: 'run_fixture01' }, method: 'dotIngress.requests.attach' }
  ])('selects $method without losing the original payload', async ({ extra, method }) => {
    const payload = payloadOf('submit', submitArgs(1, extra))
    const item = DotRemoteInboxItemSchema.parse(
      leased({
        item: 1,
        kind: 'submit',
        payload,
        created: 0,
        leased: 1,
        nonce: 1
      })
    )
    const local = fakeLocalEndpoint({
      [method]: () => ({
        ok: true,
        result: { contractVersion: 3, request: submittedView(), duplicate: false }
      })
    })
    const outcome = await dispatchLeasedItem(item, {
      endpoint: local.endpoint,
      requestOfItem: () => null
    })
    expect(local.calls).toEqual([
      { method, params: payload, timeoutMs: DOT_REMOTE_LONG_DISPATCH_TIMEOUT_MS }
    ])
    expect(outcome).toEqual({
      kind: 'decided',
      outcome: { outcome: 'accepted', dotRequestId: requestId(1) },
      messageOutcome: null
    })
  })
})
