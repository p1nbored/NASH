// FIXTURE_ONLY: every id, hash, path and model below is synthetic and describes no real run.
import { createHash } from 'node:crypto'
import type { AttemptEvidence } from './validation-context'

export const FIXTURE_STARTED_AT = '2026-10-05T01:00:00.000Z'
export const FIXTURE_STARTED_MS = Date.parse(FIXTURE_STARTED_AT)

export function sha256Of(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

export function fakeEvidence(overrides: Partial<AttemptEvidence> = {}): AttemptEvidence {
  return {
    taskId: 'task_fixture',
    runId: 'run_fixture',
    dispatchId: 'ctx_fixture',
    startedAtMs: FIXTURE_STARTED_MS,
    workspace: null,
    ...overrides
  }
}
