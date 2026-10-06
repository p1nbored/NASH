import { describe, expect, it } from 'vitest'
import {
  ATTEMPT_TRANSCRIPT_READ_MAX_BYTES,
  WorkbenchAttemptTranscriptReadParams,
  WorkbenchAttemptTranscriptReadResultSchema,
  WorkbenchRunTasksParams,
  WorkbenchRunTasksResultSchema
} from './workbench-task-window-params'

const READ = { dispatchId: 'ctx_0123456789ab', fromByteOffset: 0, maxBytes: 65_536 }

describe('workbench.runs.tasks params', () => {
  it('takes one run id and nothing else', () => {
    expect(WorkbenchRunTasksParams.parse({ runId: 'run_fixture01' })).toEqual({
      runId: 'run_fixture01'
    })
    expect(WorkbenchRunTasksParams.safeParse({ runId: 'run with spaces' }).success).toBe(false)
    expect(WorkbenchRunTasksParams.safeParse({ runId: 'run_fixture01', all: true }).success).toBe(
      false
    )
    expect(WorkbenchRunTasksParams.safeParse({}).success).toBe(false)
  })
})

describe('workbench.attempts.transcript.read params', () => {
  it('accepts an attempt id, a byte offset and a bounded chunk size', () => {
    expect(WorkbenchAttemptTranscriptReadParams.parse(READ)).toEqual(READ)
    expect(
      WorkbenchAttemptTranscriptReadParams.parse({
        ...READ,
        maxBytes: ATTEMPT_TRANSCRIPT_READ_MAX_BYTES
      }).maxBytes
    ).toBe(262_144)
  })

  it.each([
    ['a chunk above 256 KiB', { ...READ, maxBytes: 262_145 }],
    ['an empty chunk', { ...READ, maxBytes: 0 }],
    ['a negative offset', { ...READ, fromByteOffset: -1 }],
    ['a fractional offset', { ...READ, fromByteOffset: 1.5 }],
    ['an unsafe offset', { ...READ, fromByteOffset: Number.MAX_SAFE_INTEGER + 2 }],
    ['an attempt id with a path in it', { ...READ, dispatchId: '../../etc/passwd' }],
    ['an attempt id with a separator', { ...READ, dispatchId: 'ctx\\one' }],
    ['a missing offset', { dispatchId: READ.dispatchId, maxBytes: 10 }]
  ])('refuses %s', (_name, params) => {
    expect(WorkbenchAttemptTranscriptReadParams.safeParse(params).success).toBe(false)
  })

  it('lets no caller name a file, a path or a run directory', () => {
    for (const extra of [
      { path: 'C:/Users/me/.ssh/id_rsa' },
      { filePath: '/etc/passwd' },
      { runDirectory: 'autopilot-runs/run/ctx' },
      { expectedIdentity: 'x' }
    ]) {
      expect(WorkbenchAttemptTranscriptReadParams.safeParse({ ...READ, ...extra }).success).toBe(
        false
      )
    }
  })
})

describe('task window results', () => {
  it('keeps an executor kind or state it does not know, so a newer host never breaks the list', () => {
    const parsed = WorkbenchRunTasksResultSchema.parse({
      tasks: [
        {
          taskId: 'task_0123456789ab',
          title: null,
          executorKind: 'future_executor',
          attempts: [
            {
              dispatchId: 'ctx_0123456789ab',
              state: 'future_state',
              startedAt: '2026-10-05T18:00:00.000Z',
              settledAt: null,
              hasTranscript: false,
              worktree: null
            }
          ]
        }
      ]
    })
    expect(parsed.tasks[0].executorKind).toBe('future_executor')
    expect(parsed.tasks[0].attempts[0].state).toBe('future_state')
  })

  it('drops a field the contract does not name instead of passing it on', () => {
    const parsed = WorkbenchAttemptTranscriptReadResultSchema.parse({
      chunk: '{"v":1}\n',
      nextByteOffset: 8,
      fileIdentity: 'abc',
      reset: false,
      truncated: false,
      live: true,
      ended: false,
      path: 'C:/Users/me/AppData/Roaming/NASH/autopilot-runs/run/ctx/transcript.jsonl'
    })
    expect(Object.keys(parsed).sort()).toEqual([
      'chunk',
      'ended',
      'fileIdentity',
      'live',
      'nextByteOffset',
      'reset',
      'truncated'
    ])
  })
})
