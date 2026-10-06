// FIXTURE_ONLY: every id, hash, path and model below is synthetic and describes no real run.
import { createHash } from 'node:crypto'
import type { ExecutorProcessRecord } from '../orchestration/db/executor-process-record'
import type { AttemptEvidence } from './validation-context'

export const FIXTURE_STARTED_AT = '2026-10-05T01:00:00.000Z'
export const FIXTURE_STARTED_MS = Date.parse(FIXTURE_STARTED_AT)

export function sha256Of(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function fakeExecutor(
  overrides: Partial<ExecutorProcessRecord> = {}
): ExecutorProcessRecord {
  return {
    dispatchId: 'ctx_fixture',
    runId: 'run_fixture',
    taskId: 'task_fixture',
    executorKind: 'codex_cli',
    routeId: 'route_fixture',
    state: 'completed',
    executableEvidence: { executable: 'codex' },
    runDirectory: 'autopilot-runs/run_fixture/ctx_fixture',
    threadId: 'thread_fixture',
    treeVerdict: 'exited',
    treeMethod: 'windows_descendant_snapshot',
    stopVerdict: null,
    exitCode: 0,
    verdict: { status: 'completed' },
    lastMessage: { sha256: sha256Of('Done.'), bytes: 5, secretLike: false },
    usage: null,
    startedAt: FIXTURE_STARTED_AT,
    settledAt: '2026-10-05T01:05:00.000Z',
    orphaned: false,
    ...overrides
  }
}

export function fakeEvidence(overrides: Partial<AttemptEvidence> = {}): AttemptEvidence {
  return {
    taskId: 'task_fixture',
    runId: 'run_fixture',
    dispatchId: 'ctx_fixture',
    executor: fakeExecutor(),
    startedAtMs: FIXTURE_STARTED_MS,
    workspace: null,
    runDirectory: null,
    placement: null,
    ...overrides
  }
}
