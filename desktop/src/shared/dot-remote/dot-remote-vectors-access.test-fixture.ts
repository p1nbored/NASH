// FIXTURE_ONLY: remote access (D-034). dot may ask for workspace_write; each workspace's maximum,
// which NASH publishes and enforces, is the limit. The Site never compares the two itself.
import { dotRemoteNashRefusal } from './dot-remote-errors'
import {
  PUBLISHED_WORKSPACES,
  READ_ONLY_WORKSPACE,
  ackStep,
  at,
  dot,
  fail,
  itemId,
  leaseStep,
  leased,
  makeVector,
  nash,
  ok,
  payloadOf,
  receipt,
  requestId,
  submitArgs,
  type DotRemoteVector
} from './dot-remote-vector-kit.test-fixture'

const WRITE = { requestedAccess: 'workspace_write' }
const WRITE_ARGS = submitArgs(1, WRITE)
const WRITE_PAYLOAD = payloadOf('submit', WRITE_ARGS)
const ABOVE_ARGS = submitArgs(2, { ...WRITE, workspaceRef: READ_ONLY_WORKSPACE })
const ABOVE_PAYLOAD = payloadOf('submit', ABOVE_ARGS)
const ABOVE_MAXIMUM = dotRemoteNashRefusal('dot_access_above_maximum')

const queued = (item: number, created: number, payload: Record<string, unknown>) =>
  receipt({ item, kind: 'submit', state: 'queued', created, updated: created, payload })

const leasedAt = (item: number, created: number, payload: Record<string, unknown>) =>
  leased({ item, kind: 'submit', payload, created, leased: 3, nonce: item })

export const DOT_REMOTE_ACCESS_VECTORS: DotRemoteVector[] = [
  makeVector(
    'error.access_above_workspace_maximum',
    'workspace write up to each workspace maximum',
    'NASH publishes the maximum of each workspace. dot asks for workspace_write in both; the Site queues both unchanged. NASH accepts the task in the workspace whose maximum is workspace_write and refuses the other with dot_access_above_maximum, which the Site records as the refusal of NASH.',
    { items: 2, nonces: 2 },
    [
      nash(
        0,
        'workspaces.put',
        { generation: 1, publishedAt: at(0), workspaces: PUBLISHED_WORKSPACES },
        ok({ storedAt: at(0) })
      ),
      dot(1, 'nash_submit_task', WRITE_ARGS, ok({ receipt: queued(1, 1, WRITE_PAYLOAD) })),
      dot(2, 'nash_submit_task', ABOVE_ARGS, ok({ receipt: queued(2, 2, ABOVE_PAYLOAD) })),
      leaseStep(3, [leasedAt(1, 1, WRITE_PAYLOAD), leasedAt(2, 2, ABOVE_PAYLOAD)]),
      ackStep(
        4,
        1,
        1,
        WRITE_PAYLOAD,
        { outcome: 'accepted', dotRequestId: requestId(1) },
        'accepted'
      ),
      ackStep(
        5,
        2,
        2,
        ABOVE_PAYLOAD,
        { outcome: 'refused', dotRequestId: null, refusal: ABOVE_MAXIMUM },
        'refused'
      ),
      dot(
        6,
        'nash_get_receipt',
        { itemId: itemId(2) },
        ok({
          receipt: {
            ...queued(2, 2, ABOVE_PAYLOAD),
            state: 'refused',
            updatedAt: at(5),
            refusal: ABOVE_MAXIMUM
          }
        })
      )
    ]
  ),
  makeVector(
    'error.tool_input_outside_contract',
    'injected contract version and unknown access level',
    'A tool input never carries contractVersion, which the MCP layer injects, and requestedAccess is only read_only or workspace_write; either input fails its schema with payload_invalid and stores nothing.',
    { items: 0, nonces: 0 },
    [
      dot(0, 'nash_submit_task', { ...submitArgs(1), contractVersion: 3 }, fail('payload_invalid')),
      dot(
        1,
        'nash_submit_task',
        submitArgs(1, { requestedAccess: 'full_access' }),
        fail('payload_invalid')
      )
    ]
  )
]
