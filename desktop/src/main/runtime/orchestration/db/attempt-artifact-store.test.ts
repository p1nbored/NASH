import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ATTEMPT_ARTIFACT_LIMIT_PER_DISPATCH,
  getAttemptArtifactStore,
  type AttemptArtifactInput
} from './attempt-artifact-store'
import { seedRoutedTask, seedStartedAttempt } from './app-attempt-routing.test-fixture'
import { createAppRunHarness, type AppRunHarness } from './app-attempt.test-fixture'
import {
  FIXTURE_HASH_A,
  FIXTURE_HASH_B,
  errorCodeOf,
  fixtureTime
} from './autopilot-runtime.test-fixture'

describe('attempt artifact store', () => {
  let harness: AppRunHarness
  let dispatchId: string
  beforeEach(() => {
    harness = createAppRunHarness()
    const { taskId, routeId } = seedRoutedTask(harness)
    dispatchId = seedStartedAttempt(harness, taskId, routeId).dispatchId
  })
  afterEach(() => harness.owner.close())

  const store = () => getAttemptArtifactStore(harness.owner)
  const rowCount = () =>
    harness.owner.db.prepare('SELECT count(*) AS n FROM attempt_artifacts').get()?.n
  const artifact = (overrides: Partial<AttemptArtifactInput> = {}): AttemptArtifactInput => ({
    dispatchId,
    kind: 'report',
    root: 'worktree',
    relativePath: 'docs/report.md',
    sha256: FIXTURE_HASH_A,
    sizeBytes: 1200,
    timestamp: fixtureTime(7),
    ...overrides
  })

  it('is one store per database', () => {
    expect(getAttemptArtifactStore(harness.owner)).toBe(store())
  })

  describe('record', () => {
    it('stores the path, hash and size of a file an attempt produced', () => {
      const { duplicate, record } = store().record(artifact())
      expect(duplicate).toBe(false)
      expect(record).toMatchObject({
        dispatchId,
        kind: 'report',
        root: 'worktree',
        relativePath: 'docs/report.md',
        sha256: FIXTURE_HASH_A,
        sizeBytes: 1200,
        createdAt: fixtureTime(7),
        orphaned: false
      })
      expect(record.artifactId).toMatch(/^artifact_/)
    })

    it('keeps files under the run directory apart from files under the worktree', () => {
      store().record(artifact())
      expect(() => store().record(artifact({ root: 'run_directory' }))).not.toThrow()
      expect(rowCount()).toBe(2)
    })

    it('returns the existing record for the same file and refuses changed content for it', () => {
      const first = store().record(artifact()).record
      expect(store().record(artifact())).toEqual({ duplicate: true, record: first })
      expect(errorCodeOf(() => store().record(artifact({ sha256: FIXTURE_HASH_B })))).toBe(
        'autopilot_artifact_conflict'
      )
      expect(errorCodeOf(() => store().record(artifact({ sizeBytes: 1 })))).toBe(
        'autopilot_artifact_conflict'
      )
      expect(rowCount()).toBe(1)
    })

    it('refuses a Dispatch that Orca does not hold or that belongs to no TaskSpec', () => {
      expect(errorCodeOf(() => store().record(artifact({ dispatchId: 'ctx_unknown' })))).toBe(
        'autopilot_attempt_not_found'
      )
      const plain = harness.owner.createTask({
        spec: 'A task with no TaskSpec.',
        runId: harness.runId
      })
      const started = harness.owner.createStartingWorkerDispatch({
        taskId: plain.id,
        startOptions: {},
        creator: { kind: 'system' },
        maxDepth: Number.MAX_SAFE_INTEGER
      })
      expect(errorCodeOf(() => store().record(artifact({ dispatchId: started.dispatch.id })))).toBe(
        'autopilot_attempt_not_found'
      )
    })

    it('refuses paths that are not plain relative paths inside their root', () => {
      const bad = [
        '',
        '/etc/passwd',
        'C:/Windows/system.ini',
        'C:\\Windows\\system.ini',
        'docs\\report.md',
        '../report.md',
        'docs/../../report.md',
        'docs/..',
        '..',
        './report.md',
        'docs/./report.md',
        'docs//report.md',
        'docs/',
        'docs/report.md\u0000.txt',
        'docs/re\nport.md',
        'a'.repeat(1025)
      ]
      for (const relativePath of bad) {
        expect(errorCodeOf(() => store().record(artifact({ relativePath })))).toBe(
          'autopilot_invalid_input'
        )
      }
      expect(rowCount()).toBe(0)
    })

    it('refuses malformed fields and unknown keys', () => {
      const bad: AttemptArtifactInput[] = [
        artifact({ kind: 'Not A Code' }),
        artifact({ root: 'home' as never }),
        artifact({ sha256: 'abc' }),
        artifact({ sizeBytes: -1 }),
        artifact({ sizeBytes: 1.5 }),
        artifact({ timestamp: 'yesterday' }),
        { ...artifact(), extra: 1 } as never
      ]
      for (const input of bad) {
        expect(errorCodeOf(() => store().record(input))).toBe('autopilot_invalid_input')
      }
      expect(rowCount()).toBe(0)
    })

    it('caps how many files one attempt can record', () => {
      for (let index = 0; index < ATTEMPT_ARTIFACT_LIMIT_PER_DISPATCH; index += 1) {
        store().record(artifact({ relativePath: `out/file-${index}.txt` }))
      }
      expect(
        errorCodeOf(() => store().record(artifact({ relativePath: 'out/one-more.txt' })))
      ).toBe('autopilot_artifact_capacity_exceeded')
      // A repeat of a recorded file is not growth.
      expect(store().record(artifact({ relativePath: 'out/file-0.txt' })).duplicate).toBe(true)
      expect(rowCount()).toBe(ATTEMPT_ARTIFACT_LIMIT_PER_DISPATCH)
    })

    it('opens its own transaction and refuses a connection that is already in one', () => {
      harness.owner.db.exec('BEGIN IMMEDIATE')
      try {
        expect(errorCodeOf(() => store().record(artifact()))).toBe(
          'autopilot_transaction_unavailable'
        )
      } finally {
        harness.owner.db.exec('ROLLBACK')
      }
    })
  })

  describe('reads', () => {
    it('lists the files of one attempt in recording order', () => {
      const first = store().record(artifact({ relativePath: 'b.txt' })).record
      const second = store().record(artifact({ relativePath: 'a.txt' })).record
      expect(store().listForDispatch(dispatchId)).toEqual([first, second])
      expect(store().get(first.artifactId)).toEqual(first)
      expect(store().listForDispatch('ctx_unknown')).toEqual([])
      expect(store().get('artifact_unknown')).toBeNull()
    })

    it('reads a record as orphaned once Orca no longer holds the Dispatch', () => {
      const { record } = store().record(artifact())
      harness.owner.resetAll()
      expect(store().get(record.artifactId)?.orphaned).toBe(true)
      expect(store().listForDispatch(dispatchId)[0]?.orphaned).toBe(true)
    })
  })
})
