import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getAppAttemptSettlement } from '../orchestration/db/app-attempt-settlement'
import { seedRoutedTask } from '../orchestration/db/app-attempt-routing.test-fixture'
import {
  FIXTURE_OBJECTIVE,
  createAppRunHarness,
  type AppRunHarness
} from '../orchestration/db/app-attempt.test-fixture'
import { FIXTURE_HASH_B, fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import type { TaskRouteInput } from '../orchestration/db/task-route-store'
import type { JsonObject } from '../orchestration/db/autopilot-json-column'
import { createAttemptReader, type ValidationRootsPort } from './attempt-evidence'

const EXITED = { verdict: 'exited', method: 'windows_descendant_snapshot' } as const
const APP_DATA = join('C:', 'app-data')

const TASK_WORKTREE = {
  worktreeId: 'fixture-repo::/fixture/workspaces/nash-task-1',
  branch: 'nash-task-1',
  path: join('C:', 'fixture', 'workspaces', 'nash-task-1'),
  baseCommit: '0123456789abcdef0123456789abcdef01234567'
}

const roots: ValidationRootsPort = {
  resolveWorkspace: async (workspaceId) =>
    workspaceId === 'fixture-repo::/fixture/repo'
      ? { path: join('C:', 'fixture', 'repo'), kind: 'git' }
      : workspaceId === TASK_WORKTREE.worktreeId
        ? { path: TASK_WORKTREE.path, kind: 'git' }
        : null,
  resolveRunDirectory: (relative) => join(APP_DATA, relative)
}

describe('attempt evidence', () => {
  let harness: AppRunHarness
  beforeEach(() => {
    harness = createAppRunHarness()
  })
  afterEach(() => harness.owner.close())

  function claim(
    executor: 'codex_cli' | 'in_session',
    route: Partial<TaskRouteInput> = {},
    executableEvidence: JsonObject = { executable: 'codex' }
  ) {
    const seeded = seedRoutedTask(harness, { route })
    const settlement = getAppAttemptSettlement(harness.owner)
    const { dispatchId } = settlement.start({
      taskId: seeded.taskId,
      routeId: seeded.routeId,
      executor,
      creator: { kind: 'system' },
      maxDepth: Number.MAX_SAFE_INTEGER,
      timestamp: fixtureTime(5)
    })
    const process = executor === 'codex_cli'
    settlement.markRunning({
      dispatchId,
      ...(process ? { executableEvidence } : {}),
      timestamp: fixtureTime(6)
    })
    settlement.settleClaim({
      dispatchId,
      ...(process
        ? {
            exitCode: 0,
            tree: EXITED,
            lastMessage: { sha256: FIXTURE_HASH_B, bytes: 5, secretLike: false }
          }
        : {}),
      timestamp: fixtureTime(7)
    })
    const entry = settlement
      .listAwaitingValidation(10)
      .find((item) => item.dispatchId === dispatchId)
    if (!entry) {
      throw new Error('fixture attempt is not awaiting validation')
    }
    return entry
  }

  it('gathers a process attempt: spec, objective, executor, route model, workspace and run directory', async () => {
    const entry = claim('codex_cli')
    const facts = await createAttemptReader(harness.owner, roots).read(entry)
    expect(facts).toMatchObject({
      objective: FIXTURE_OBJECTIVE,
      workModel: 'gpt-6.1-sol',
      workspaceId: 'fixture-repo::/fixture/repo',
      spec: {
        taskId: entry.taskId,
        machineChecks: [{ kind: 'artifact_exists', path: 'report.md' }]
      },
      evidence: {
        taskId: entry.taskId,
        runId: harness.runId,
        dispatchId: entry.dispatchId,
        executor: { executorKind: 'codex_cli', state: 'completed' },
        workspace: { path: join('C:', 'fixture', 'repo'), kind: 'git' }
      }
    })
    expect(facts?.evidence.runDirectory).toBe(
      join(APP_DATA, `autopilot-runs/${harness.runId}/${entry.dispatchId}`)
    )
    expect(facts?.evidence.startedAtMs).toBe(Date.parse(facts?.evidence.executor?.startedAt ?? ''))
  })

  it('reads the workspace of an attempt without its own worktree from the run, as before D-025', async () => {
    const facts = await createAttemptReader(harness.owner, roots).read(claim('codex_cli'))
    expect(facts?.evidence.placement).toBeNull()
    expect(facts?.evidence.workspace).toEqual({ path: join('C:', 'fixture', 'repo'), kind: 'git' })
  })

  it('validates a write attempt in the worktree it wrote in, recorded in its evidence (D-025)', async () => {
    const entry = claim(
      'codex_cli',
      {},
      { executable: 'codex', attemptWorkspace: { mode: 'own_worktree', ...TASK_WORKTREE } }
    )
    const facts = await createAttemptReader(harness.owner, roots).read(entry)
    expect(facts?.evidence.workspace).toEqual({ path: TASK_WORKTREE.path, kind: 'git' })
    expect(facts?.evidence.placement).toEqual({ mode: 'own_worktree', worktree: TASK_WORKTREE })
    // The run worktree stays the workspace the routes and the reviewer are checked for.
    expect(facts?.workspaceId).toBe('fixture-repo::/fixture/repo')
  })

  it('never falls back to the run worktree when the attempt worktree is gone', async () => {
    const entry = claim(
      'codex_cli',
      {},
      {
        executable: 'codex',
        attemptWorkspace: {
          mode: 'own_worktree',
          ...TASK_WORKTREE,
          worktreeId: 'fixture-repo::/fixture/workspaces/removed'
        }
      }
    )
    const facts = await createAttemptReader(harness.owner, roots).read(entry)
    expect(facts?.evidence.workspace).toBeNull()
  })

  it('records a folder write attempt and validates it in the run workspace', async () => {
    const entry = claim(
      'codex_cli',
      {},
      { executable: 'codex', attemptWorkspace: { mode: 'folder' } }
    )
    const facts = await createAttemptReader(harness.owner, roots).read(entry)
    expect(facts?.evidence.placement).toEqual({ mode: 'folder' })
    expect(facts?.evidence.workspace).toEqual({ path: join('C:', 'fixture', 'repo'), kind: 'git' })
  })

  it('gives an in-session attempt that inherits the coordinator its model and a dated start', async () => {
    const entry = claim('in_session', {
      target: 'claude_workflow',
      model: null,
      policyLevel: 'inherit'
    })
    const facts = await createAttemptReader(harness.owner, roots).read(entry)
    expect(facts).toMatchObject({
      workModel: 'claude-opus-5-5',
      evidence: { executor: null, runDirectory: null, placement: null }
    })
    expect(facts?.evidence.startedAtMs).toEqual(expect.any(Number))
  })

  it('returns null for an attempt it cannot find', async () => {
    const reader = createAttemptReader(harness.owner, roots)
    expect(
      await reader.read({
        taskId: 'task_missing',
        runId: harness.runId,
        dispatchId: 'ctx_missing',
        stage: 'validation_pending',
        validationId: null,
        verdict: null
      })
    ).toBeNull()
  })
})
