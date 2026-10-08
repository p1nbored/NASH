import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isEnglishText } from '../../../shared/english-text'
import { seedRoutedTask } from '../orchestration/db/app-attempt-routing.test-fixture'
import type { MachineCheck } from '../orchestration/db/task-spec-record'
import { createRunnerWorld, type RunnerWorld } from './validation-runner.test-fixture'

const MACHINE_CHECKS: MachineCheck[] = [
  { kind: 'artifact_exists', path: 'report.md' },
  { kind: 'secret_scan_clean' }
]

describe('validation runner: machine checks', () => {
  let world: RunnerWorld
  beforeEach(() => {
    world = createRunnerWorld()
  })
  afterEach(() => world.cleanup())

  it('completes a task whose machine checks pass, and so promotes its dependents', async () => {
    const task = world.claimedTask({ spec: { machineChecks: MACHINE_CHECKS } })
    const dependent = seedRoutedTask(world.harness, { deps: [task.taskId] })
    expect(world.taskStatus(dependent.taskId)).toBe('pending')
    expect(world.taskStatus(task.taskId)).toBe('blocked')

    const reports = await world.runner.validatePending()
    expect(reports).toContainEqual(
      expect.objectContaining({ dispatchId: task.dispatchId, outcome: 'settled', verdict: 'pass' })
    )
    expect(world.taskStatus(task.taskId)).toBe('completed')
    expect(world.port.hasPassingValidation(task.taskId)).toBe(true)
    expect(world.taskStatus(dependent.taskId)).toBe('ready')

    const validation = world.port
      .listAwaiting(10)
      .find((entry) => entry.dispatchId === task.dispatchId)
    expect(validation).toBeUndefined()
    const [artifact] = world.port.listArtifacts(task.dispatchId)
    expect(artifact).toMatchObject({ relativePath: 'report.md', root: 'worktree' })
  })

  it('fails a task whose machine check fails', async () => {
    const task = world.claimedTask({
      spec: { machineChecks: [{ kind: 'artifact_exists', path: 'missing.md' }] }
    })
    expect(await world.runner.validateAttempt(task.dispatchId)).toMatchObject({
      outcome: 'settled',
      verdict: 'fail'
    })
    expect(world.taskStatus(task.taskId)).toBe('failed')
  })

  it('leaves an inconclusive result to the user or dot, and never decides it again itself', async () => {
    world.state.workspaceKind = 'folder'
    const task = world.claimedTask({ spec: { machineChecks: [{ kind: 'no_workspace_writes' }] } })
    expect(await world.runner.validateAttempt(task.dispatchId)).toMatchObject({
      verdict: 'inconclusive'
    })
    expect(world.taskStatus(task.taskId)).toBe('blocked')
    const [pending] = world.decisions.listPendingDecisions(10)
    expect(pending).toMatchObject({ dispatchId: task.dispatchId, verdict: 'inconclusive' })

    world.state.workspaceKind = 'git'
    expect(await world.runner.validateAttempt(task.dispatchId)).toEqual({
      dispatchId: task.dispatchId,
      outcome: 'skipped',
      reason: 'awaiting_decision'
    })
    expect(world.decisions.listPendingDecisions(10)).toHaveLength(1)
    expect(Object.keys(world.runner).sort()).toEqual(['validateAttempt', 'validatePending'])
  })

  it('writes every record as one English line', async () => {
    const task = world.claimedTask({
      spec: { machineChecks: [...MACHINE_CHECKS, { kind: 'unit_tests_pass' }] }
    })
    const report = await world.runner.validateAttempt(task.dispatchId)
    expect(report).toMatchObject({ verdict: 'inconclusive' })
    const validation =
      report.outcome === 'settled' ? world.port.getValidation(report.validationId) : null
    expect(validation?.checks.map((check) => check.kind)).toEqual([
      'artifact_exists',
      'secret_scan_clean',
      'unit_tests_pass'
    ])
    for (const check of validation?.checks ?? []) {
      expect(isEnglishText(check.note ?? '')).toBe(true)
      expect(/\p{Cc}/u.test(check.note ?? '')).toBe(false)
    }
  })

  it('records nothing when cancelled before the verdict', async () => {
    const task = world.claimedTask({ spec: { machineChecks: MACHINE_CHECKS } })
    const controller = new AbortController()
    controller.abort()
    expect(await world.runner.validateAttempt(task.dispatchId, controller.signal)).toEqual({
      dispatchId: task.dispatchId,
      outcome: 'skipped',
      reason: 'cancelled'
    })
    expect(world.taskStatus(task.taskId)).toBe('blocked')
  })

  it('needs a check that shows the work was done, not only checks that nothing went wrong', async () => {
    const task = world.claimedTask({
      spec: { machineChecks: [{ kind: 'no_workspace_writes' }, { kind: 'secret_scan_clean' }] }
    })
    const report = await world.runner.validateAttempt(task.dispatchId)
    expect(report).toMatchObject({ outcome: 'settled', verdict: 'inconclusive' })
    const validation =
      report.outcome === 'settled' ? world.port.getValidation(report.validationId) : null
    expect(validation?.checks.at(-1)).toMatchObject({
      kind: 'work_evidence',
      status: 'inconclusive'
    })
    expect(world.taskStatus(task.taskId)).toBe('blocked')
  })

  it('validates newer attempts while older ones wait for a decision', async () => {
    world.state.workspaceKind = 'folder'
    for (let index = 0; index < 2; index += 1) {
      const older = world.claimedTask({
        spec: { machineChecks: [{ kind: 'no_workspace_writes' }] }
      })
      await world.runner.validateAttempt(older.dispatchId)
    }
    world.state.workspaceKind = 'git'
    const newer = world.claimedTask({ spec: { machineChecks: MACHINE_CHECKS } })
    expect(await world.runner.validatePending({ limit: 1 })).toEqual([
      expect.objectContaining({ dispatchId: newer.dispatchId, verdict: 'pass' })
    ])
  })

  it('skips an attempt that is not waiting for validation', async () => {
    expect(await world.runner.validateAttempt('ctx_unknown')).toEqual({
      dispatchId: 'ctx_unknown',
      outcome: 'skipped',
      reason: 'not_awaiting'
    })
  })
})

describe('validation runner: reads of the waiting list', () => {
  it('lists waiting attempts once per batch and re-reads each attempt alone by its Dispatch', async () => {
    let listed = 0
    const looked: string[] = []
    const world = createRunnerWorld({
      wrapPort: (port) => ({
        ...port,
        listAwaiting: (limit) => {
          listed += 1
          return port.listAwaiting(limit)
        },
        getAwaiting: (dispatchId) => {
          looked.push(dispatchId)
          return port.getAwaiting(dispatchId)
        }
      })
    })
    try {
      const tasks = [0, 1, 2].map(() =>
        world.claimedTask({ spec: { machineChecks: MACHINE_CHECKS } })
      )
      const reports = await world.runner.validatePending()
      expect(reports.map((report) => report.outcome)).toEqual(['settled', 'settled', 'settled'])
      expect(listed).toBe(1)
      expect(looked).toEqual(tasks.map((task) => task.dispatchId))

      expect(await world.runner.validateAttempt('ctx_unknown')).toMatchObject({
        reason: 'not_awaiting'
      })
      expect(listed).toBe(1)
    } finally {
      world.cleanup()
    }
  })
})

describe('validation runner: a validation settled elsewhere', () => {
  it('does not decide again a validation that was settled after this runner looked', async () => {
    const world = createRunnerWorld({
      wrapPort: (port) => ({
        ...port,
        open: (input) => {
          const opened = port.open(input)
          port.recordVerdict({
            validationId: opened.record.validationId,
            verdict: 'inconclusive',
            checks: [{ kind: 'work_evidence', status: 'inconclusive', note: 'Settled elsewhere.' }],
            evidenceRefs: [],
            timestamp: '2026-10-05T03:00:00.000Z'
          })
          const settled = port.getValidation(opened.record.validationId)
          if (!settled) {
            throw new Error('fixture validation vanished')
          }
          return { duplicate: true, record: settled }
        }
      })
    })
    try {
      const task = world.claimedTask({ spec: { machineChecks: MACHINE_CHECKS } })
      expect(await world.runner.validateAttempt(task.dispatchId)).toEqual({
        dispatchId: task.dispatchId,
        outcome: 'skipped',
        reason: 'already_decided'
      })
      expect(world.decisions.listPendingDecisions(10)).toHaveLength(1)
    } finally {
      world.cleanup()
    }
  })
})
