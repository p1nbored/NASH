import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  seedRoutedTask,
  startOrcaDispatch
} from '../orchestration/db/app-attempt-routing.test-fixture'
import {
  createAppRunHarness,
  type AppRunHarness
} from '../orchestration/db/app-attempt.test-fixture'
import { fixtureTime } from '../orchestration/db/autopilot-runtime.test-fixture'
import { checkArtifactExists, checkSecretScanClean } from './artifact-checks'
import { createTaskValidationPort, type TaskValidationPort } from './task-validation-port'
import { fakeEvidence, sha256Of } from './task-validation.test-fixture'
import type { AttemptEvidence } from './validation-context'

// FIXTURE_ONLY: the token below is synthetic and obviously fake.
const FAKE_TOKEN = 'ghp_0123456789abcdef0123456789abcdef'

describe('artifact checks', () => {
  let base: string
  let worktree: string
  let harness: AppRunHarness
  let port: TaskValidationPort
  let evidence: AttemptEvidence
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'c5-artifact-checks-'))
    worktree = join(base, 'worktree')
    mkdirSync(join(worktree, 'out'), { recursive: true })
    writeFileSync(join(worktree, 'out', 'report.md'), 'Report body.')
    harness = createAppRunHarness()
    port = createTaskValidationPort(harness.owner)
    const { taskId, routeId } = seedRoutedTask(harness)
    const { dispatchId } = startOrcaDispatch(harness, taskId, routeId)
    evidence = fakeEvidence({
      taskId,
      runId: harness.runId,
      dispatchId,
      workspace: { path: worktree, kind: 'git' }
    })
  })
  afterEach(() => {
    harness.owner.close()
    rmSync(base, { recursive: true, force: true })
  })

  const exists = (path: string) =>
    checkArtifactExists(evidence, { path, root: 'worktree' }, port, fixtureTime(8))

  it('records an existing artifact with its sha256 and passes on that record', async () => {
    const result = await exists('out/report.md')
    expect(result).toMatchObject({ kind: 'artifact_exists', status: 'pass' })
    const [artifact] = port.listArtifacts(evidence.dispatchId)
    expect(artifact).toMatchObject({
      root: 'worktree',
      relativePath: 'out/report.md',
      sha256: sha256Of('Report body.'),
      sizeBytes: 12
    })
    expect(result.evidence).toEqual([{ kind: 'artifact', ref: artifact?.artifactId }])
  })

  it('fails a missing artifact and refuses escapes and links', async () => {
    expect(await exists('out/missing.md')).toMatchObject({
      status: 'fail',
      note: 'The artifact `out/missing.md` does not exist.'
    })
    expect(await exists('../outside.md')).toMatchObject({ status: 'fail' })
    mkdirSync(join(base, 'outside'))
    writeFileSync(join(base, 'outside', 'x.md'), 'x')
    try {
      // Junctions need no privilege on Windows; a host that cannot make one skips this part.
      symlinkSync(join(base, 'outside'), join(worktree, 'linked'), 'junction')
      expect(await exists('linked/x.md')).toMatchObject({ status: 'fail' })
    } catch {
      // No link support on this host.
    }
    expect(port.listArtifacts(evidence.dispatchId)).toEqual([])
  })

  it('cannot decide without a local root to look in', async () => {
    evidence = { ...evidence, workspace: null }
    expect(await exists('out/report.md')).toMatchObject({ status: 'inconclusive' })
  })

  it('cannot decide when a recorded artifact changed before it was recorded again', async () => {
    await exists('out/report.md')
    writeFileSync(join(worktree, 'out', 'report.md'), 'Changed body.')
    expect(await exists('out/report.md')).toMatchObject({ status: 'inconclusive' })
  })

  describe('secret_scan_clean', () => {
    it('passes when every recorded artifact is free of secret shapes', async () => {
      await exists('out/report.md')
      const result = await checkSecretScanClean(evidence, port)
      expect(result).toMatchObject({ kind: 'secret_scan_clean', status: 'pass' })
      expect(result.evidence).toHaveLength(1)
    })

    it('fails on a secret shape in an artifact, without echoing it', async () => {
      writeFileSync(join(worktree, 'out', 'report.md'), `token: ${FAKE_TOKEN}`)
      await exists('out/report.md')
      const result = await checkSecretScanClean(evidence, port)
      expect(result.status).toBe('fail')
      expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN)
    })

    it('cannot decide when a scanned file changed since it was recorded', async () => {
      await exists('out/report.md')
      writeFileSync(join(worktree, 'out', 'report.md'), 'Changed later.')
      expect((await checkSecretScanClean(evidence, port)).status).toBe('inconclusive')
    })

    it('passes with nothing to scan for an in-session attempt without artifacts', async () => {
      expect(await checkSecretScanClean(evidence, port)).toMatchObject({
        status: 'pass',
        evidence: []
      })
    })
  })
})
