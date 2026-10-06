import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutopilotTaskSpecSchema } from '../../../../shared/rpc-contract/orchestration-autopilot-params'
import {
  FIXTURE_OBJECTIVE,
  createAppRunHarness,
  specInput,
  type AppRunHarness
} from './app-attempt.test-fixture'
import { TaskProposalInputSchema } from './task-spec-record'
import { getTaskSpecStore, type TaskProposalInput } from './task-spec-store'

// Each sample is one TaskSpec change; the wire and the store must agree on every one (M6).
const SAMPLES: readonly [
  string,
  { wire: Record<string, unknown>; store: Partial<TaskProposalInput> }
][] = [
  [
    'a CRLF objective',
    { wire: { objective: 'One.\r\nTwo.' }, store: { objective: 'One.\r\nTwo.' } }
  ],
  [
    'a lone CR in a list',
    { wire: { constraints: ['One.\rTwo.'] }, store: { constraints: ['One.\rTwo.'] } }
  ],
  [
    'tab and newline',
    { wire: { objective: 'One.\n\tTwo.' }, store: { objective: 'One.\n\tTwo.' } }
  ],
  [
    'an escape character',
    { wire: { objective: 'One.\u001b[2J' }, store: { objective: 'One.\u001b[2J' } }
  ],
  [
    'a NUL in a list',
    { wire: { expectedOutputs: ['a\u0000b'] }, store: { expectedOutputs: ['a\u0000b'] } }
  ],
  [
    'a C1 control',
    { wire: { acceptanceCriteria: ['a\u0085b'] }, store: { acceptanceCriteria: ['a\u0085b'] } }
  ],
  ['a newline in the title', { wire: { title: 'One\nTwo' }, store: { taskTitle: 'One\nTwo' } }],
  ['a tab in the title', { wire: { title: 'One\tTwo' }, store: { taskTitle: 'One\tTwo' } }],
  [
    'a CRLF check parameter',
    {
      wire: { machineChecks: [{ kind: 'artifact_exists', path: 'a\r\nb' }] },
      store: { machineChecks: [{ kind: 'artifact_exists', path: 'a\r\nb' }] }
    }
  ],
  [
    'a control character in a check parameter',
    {
      wire: { machineChecks: [{ kind: 'artifact_exists', path: 'a\u0007b' }] },
      store: { machineChecks: [{ kind: 'artifact_exists', path: 'a\u0007b' }] }
    }
  ],
  [
    'a check with eight fields',
    {
      wire: { machineChecks: [{ kind: 'k', a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 }] },
      store: { machineChecks: [{ kind: 'k', a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 }] }
    }
  ],
  [
    'a check with seven fields',
    {
      wire: { machineChecks: [{ kind: 'k', a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }] },
      store: { machineChecks: [{ kind: 'k', a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 }] }
    }
  ],
  [
    'a check field name in capitals',
    {
      wire: { machineChecks: [{ kind: 'k', Path: 'a' }] },
      store: { machineChecks: [{ kind: 'k', Path: 'a' }] }
    }
  ]
]

describe('TaskSpec text: one definition for the wire and the store (M6)', () => {
  let harness: AppRunHarness
  beforeEach(() => {
    harness = createAppRunHarness()
  })
  afterEach(() => harness.owner.close())

  const proposal = (overrides: Partial<TaskProposalInput> = {}): TaskProposalInput => {
    const { taskId: _taskId, ...spec } = specInput('unused', harness.runId)
    return { ...spec, objective: FIXTURE_OBJECTIVE, ...overrides }
  }

  it.each(SAMPLES)('agrees on %s', (_name, sample) => {
    const wire = AutopilotTaskSpecSchema.safeParse({ objective: FIXTURE_OBJECTIVE, ...sample.wire })
    const store = TaskProposalInputSchema.safeParse(proposal(sample.store))
    expect(wire.success).toBe(store.success)
  })

  it('turns CRLF and a lone CR into LF before the control-character rule, on both sides', () => {
    expect(AutopilotTaskSpecSchema.parse({ objective: 'One.\r\nTwo.\rThree.' }).objective).toBe(
      'One.\nTwo.\nThree.'
    )
    const { taskId, record } = getTaskSpecStore(harness.owner).propose(
      proposal({
        objective: 'One.\r\nTwo.\rThree.',
        acceptanceCriteria: ['A\r\nB'],
        machineChecks: [{ kind: 'artifact_exists', path: 'report.md', note: 'x\r\ny' }]
      })
    )
    expect(harness.owner.getTask(taskId)?.spec).toBe('One.\nTwo.\nThree.')
    expect(record.acceptanceCriteria).toEqual(['A\nB'])
    expect(record.machineChecks).toEqual([
      { kind: 'artifact_exists', path: 'report.md', note: 'x\ny' }
    ])
  })
})
