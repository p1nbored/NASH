// FIXTURE_ONLY: one accepted conformance vector per read tool; reads come from what NASH reported.
import { createHash } from 'node:crypto'
import { DOT_REMOTE_CONTRACT_VERSION } from './dot-remote-limits'
import { buildDotMcpToolManifest } from './dot-remote-manifest'
import {
  LEASED_SUBMIT_1,
  QUEUED_1,
  SUBMIT_1,
  acceptedSubmit,
  admittedSubmitSteps,
  eventsStep,
  projection
} from './dot-remote-vector-flows.test-fixture'
import {
  ackStep,
  at,
  decisionView,
  dot,
  event,
  itemId,
  leaseStep,
  leased,
  makeVector,
  nash,
  ok,
  payloadOf,
  receipt,
  requestId,
  statusEvent,
  submitArgs,
  PUBLISHED_WORKSPACES,
  type DotRemoteVector,
  type DotRemoteVectorStep
} from './dot-remote-vector-kit.test-fixture'

function vector(
  tool: string,
  description: string,
  generated: { items: number; nonces: number },
  steps: DotRemoteVectorStep[]
): DotRemoteVector {
  return makeVector(`accepted.${tool}`, tool, description, generated, steps)
}

const NONE = { items: 0, nonces: 0 }
const ONE = { items: 1, nonces: 1 }
const STATUS = (online: boolean) => ({
  status: {
    paired: true,
    online,
    lastSeenAt: at(0),
    appVersion: '1.4.0',
    contractVersion: DOT_REMOTE_CONTRACT_VERSION,
    onlineWindowSeconds: 90,
    manifestSha256: buildDotMcpToolManifest().manifestSha256
  }
})
const REPORT_SHA256 = createHash('sha256').update('FIXTURE_ONLY report bytes').digest('hex')
const SUBMIT_2 = payloadOf('submit', submitArgs(2))
const submit2 = (state: string, updated: number) =>
  receipt({ item: 2, kind: 'submit', state, created: 1, updated, payload: SUBMIT_2 })
const READ_OPENED = event(
  1,
  'permission_prompt_opened',
  1,
  4,
  decisionView('Read', 'Read: docs/README.md', 4, true)
)
const VALIDATION = event(3, 'validation_result', 3, 3, {
  verdict: 'pass',
  line: '3 checks: 3 passed, 0 failed, 0 undecided.'
})
const DELIVERABLE = event(4, 'deliverable_summary', 4, 3, {
  summary: 'The report lists four open issues; two of them need a reviewer.',
  artifacts: [
    { artifactId: 'art_0123456789abcdef01234567', sizeBytes: 2048, sha256: REPORT_SHA256 }
  ]
})
const COMPLETED = statusEvent(5, 5, 3, 'completed')
const accept1 = (seconds: number) =>
  ackStep(seconds, 1, 1, SUBMIT_1, { outcome: 'accepted', dotRequestId: requestId(1) }, 'accepted')

export const DOT_REMOTE_READ_TOOL_VECTORS: DotRemoteVector[] = [
  vector(
    'nash_status',
    'A heartbeat makes NASH online for 90 seconds; after that dot sees it offline with the last-seen time.',
    NONE,
    [
      nash(
        0,
        'heartbeat.post',
        {
          generation: 1,
          appVersion: '1.4.0',
          contractVersion: DOT_REMOTE_CONTRACT_VERSION,
          sentAt: at(0)
        },
        ok({ serverTime: at(0) })
      ),
      dot(10, 'nash_status', {}, ok(STATUS(true))),
      dot(100, 'nash_status', {}, ok(STATUS(false)))
    ]
  ),
  vector(
    'nash_list_workspaces',
    'dot reads the workspace list NASH last published: opaque refs, display names and the access maximum of each workspace.',
    NONE,
    [
      nash(
        0,
        'workspaces.put',
        { generation: 1, publishedAt: at(0), workspaces: PUBLISHED_WORKSPACES },
        ok({ storedAt: at(0) })
      ),
      dot(
        5,
        'nash_list_workspaces',
        {},
        ok({ workspaces: PUBLISHED_WORKSPACES, publishedAt: at(0) })
      )
    ]
  ),
  vector(
    'nash_get_receipt',
    'The receipt moves from queued to claimed when NASH leases the item and to accepted with its ack.',
    ONE,
    [
      dot(0, 'nash_submit_task', submitArgs(1), ok({ receipt: QUEUED_1 })),
      dot(1, 'nash_get_receipt', { itemId: itemId(1) }, ok({ receipt: QUEUED_1 })),
      leaseStep(2, [LEASED_SUBMIT_1(2)]),
      dot(
        3,
        'nash_get_receipt',
        { itemId: itemId(1) },
        ok({ receipt: { ...QUEUED_1, state: 'claimed', updatedAt: at(2) } })
      ),
      accept1(4),
      dot(5, 'nash_get_receipt', { itemId: itemId(1) }, ok({ receipt: acceptedSubmit(4) }))
    ]
  ),
  vector(
    'nash_get_request',
    'dot reads the fold of what NASH reported: newest status, validation results and the deliverable summary.',
    ONE,
    [
      ...admittedSubmitSteps(),
      eventsStep(
        3,
        [
          statusEvent(1, 1, 2, 'launching'),
          statusEvent(2, 2, 3, 'active'),
          VALIDATION,
          DELIVERABLE,
          COMPLETED
        ],
        5
      ),
      dot(
        10,
        'nash_get_request',
        { dotRequestId: requestId(1) },
        ok(
          projection(5, {
            status: COMPLETED,
            validationResults: [VALIDATION],
            deliverable: DELIVERABLE
          })
        )
      )
    ]
  ),
  vector(
    'nash_list_requests',
    'Requests are listed newest first, each with its submit receipt and the status NASH last reported.',
    { items: 2, nonces: 2 },
    [
      dot(0, 'nash_submit_task', submitArgs(1), ok({ receipt: QUEUED_1 })),
      dot(1, 'nash_submit_task', submitArgs(2), ok({ receipt: submit2('queued', 1) })),
      leaseStep(2, [
        LEASED_SUBMIT_1(2),
        leased({ item: 2, kind: 'submit', payload: SUBMIT_2, created: 1, leased: 2, nonce: 2 })
      ]),
      accept1(3),
      eventsStep(4, [statusEvent(1, 1, 3, 'launching')], 1),
      dot(
        5,
        'nash_list_requests',
        {},
        ok({
          requests: [
            { receipt: submit2('claimed', 2), status: null },
            { receipt: acceptedSubmit(3), status: statusEvent(1, 1, 3, 'launching') }
          ],
          nextCursor: null
        })
      )
    ]
  ),
  vector(
    'nash_list_permission_prompts',
    'dot lists the prompts NASH reported as open: tool name and masked summary only.',
    ONE,
    [
      ...admittedSubmitSteps(),
      eventsStep(5, [READ_OPENED], 1),
      dot(6, 'nash_list_permission_prompts', {}, ok({ decisions: [READ_OPENED.data] }))
    ]
  )
]
