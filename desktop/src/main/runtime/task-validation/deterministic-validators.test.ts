import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AttemptArtifactRecord } from '../orchestration/db/attempt-artifact-store'
import { runMachineChecks, type MachineCheckDeps } from './deterministic-validators'
import { fakeEvidence } from './task-validation.test-fixture'
import type { AttemptEvidence } from './validation-context'

// FIXTURE_ONLY: the token below is synthetic and obviously fake.
const FAKE_TOKEN = 'ghp_0123456789abcdef0123456789abcdef'

function memoryRecorder(): MachineCheckDeps['recorder'] {
  const records: AttemptArtifactRecord[] = []
  return {
    listArtifacts: () => [...records],
    recordArtifact: (input) => {
      const record: AttemptArtifactRecord = {
        artifactId: `artifact_${records.length + 1}`,
        dispatchId: input.dispatchId,
        kind: input.kind,
        root: input.root,
        relativePath: input.relativePath,
        sha256: input.sha256,
        sizeBytes: input.sizeBytes,
        createdAt: input.timestamp,
        orphaned: false
      }
      records.push(record)
      return { duplicate: false, record }
    }
  }
}

describe('deterministic validators', () => {
  let base: string
  let evidence: AttemptEvidence
  let deps: MachineCheckDeps
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'c5-machine-'))
    mkdirSync(join(base, 'run'))
    writeFileSync(join(base, 'run', 'last-message.txt'), 'Done.')
    writeFileSync(join(base, 'report.md'), 'Report body.')
    evidence = fakeEvidence({
      workspace: { path: base, kind: 'git' },
      runDirectory: join(base, 'run')
    })
    deps = {
      recorder: memoryRecorder(),
      git: { readStatus: async () => ({ ok: true, changedFiles: [], headCommitSeconds: 1 }) },
      now: () => new Date('2026-10-05T02:00:00.000Z')
    }
  })
  afterEach(() => rmSync(base, { recursive: true, force: true }))

  it('reports every check in the order the TaskSpec lists it', async () => {
    const outcomes = await runMachineChecks(
      [
        { kind: 'secret_scan_clean' },
        { kind: 'executor_completed' },
        { kind: 'artifact_exists', path: 'report.md', root: 'worktree' },
        { kind: 'no_workspace_writes' }
      ],
      evidence,
      deps
    )
    expect(outcomes.map((outcome) => [outcome.kind, outcome.status])).toEqual([
      ['secret_scan_clean', 'pass'],
      ['executor_completed', 'pass'],
      ['artifact_exists', 'pass'],
      ['no_workspace_writes', 'pass']
    ])
  })

  it('scans artifacts recorded by checks listed after the scan', async () => {
    writeFileSync(join(base, 'report.md'), `token: ${FAKE_TOKEN}`)
    const [scan] = await runMachineChecks(
      [
        { kind: 'secret_scan_clean' },
        { kind: 'artifact_exists', path: 'report.md', root: 'worktree' }
      ],
      evidence,
      deps
    )
    expect(scan).toMatchObject({ kind: 'secret_scan_clean', status: 'fail' })
  })

  it('keeps a check it cannot run in its place, undecided', async () => {
    const outcomes = await runMachineChecks(
      [
        { kind: 'invalid', specKind: 'unit_tests_pass', problem: 'unknown_kind' },
        { kind: 'invalid', specKind: 'artifact_exists', problem: 'invalid_parameters' }
      ],
      evidence,
      deps
    )
    expect(outcomes).toEqual([
      expect.objectContaining({
        kind: 'unit_tests_pass',
        status: 'inconclusive',
        note: 'The check kind `unit_tests_pass` is not one the validators know.'
      }),
      expect.objectContaining({ kind: 'artifact_exists', status: 'inconclusive' })
    ])
  })

  it('turns a check that throws into an undecided check instead of losing the validation', async () => {
    deps = {
      ...deps,
      git: {
        readStatus: async () => {
          throw new Error('boom')
        }
      }
    }
    const [outcome] = await runMachineChecks([{ kind: 'no_workspace_writes' }], evidence, deps)
    expect(outcome).toMatchObject({
      kind: 'no_workspace_writes',
      status: 'inconclusive',
      note: 'The check stopped on an internal error (Error).'
    })
  })
})
