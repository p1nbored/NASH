import { afterEach, describe, expect, it } from 'vitest'
import type { RecordVerdictInput } from '../orchestration/db/app-attempt-validation-outcome'
import { createRunnerWorld, type RunnerWorld } from './validation-runner.test-fixture'

// FIXTURE_ONLY: a synthetic attempt worktree; no git, worktree or executor is touched.
const OWN_WORKTREE = {
  mode: 'own_worktree',
  worktreeId: 'fixture-repo::C:/fixture/workspaces/nash-task-1',
  branch: 'nash-task-1',
  path: 'C:/fixture/workspaces/nash-task-1',
  baseCommit: '0123456789abcdef0123456789abcdef01234567'
}

describe('validation runner: a write task in its own worktree (D-025)', () => {
  let world: RunnerWorld
  const verdicts: RecordVerdictInput[] = []
  afterEach(() => {
    world.cleanup()
    verdicts.length = 0
  })

  function worldCapturingVerdicts(): RunnerWorld {
    return createRunnerWorld({
      wrapPort: (port) => ({
        ...port,
        recordVerdict: (input) => {
          verdicts.push(input)
          return port.recordVerdict(input)
        }
      })
    })
  }

  function passingWriteTask(): void {
    world = worldCapturingVerdicts()
    world.claimedTask({
      spec: { machineChecks: [] },
      executableEvidence: { executable: 'codex', attemptWorkspace: OWN_WORKTREE }
    })
  }

  it('tells the primary which branch to merge once the task passes', async () => {
    passingWriteTask()
    const [report] = await world.runner.validatePending()
    expect(report).toMatchObject({ outcome: 'settled', verdict: 'pass' })
    expect(verdicts[0]?.notice?.body).toContain('committed on branch `nash-task-1`')
    expect(verdicts[0]?.notice?.body).toMatch(/merge that branch into your worktree/i)
    expect(world.state.worktreeReads).toEqual([
      {
        worktreeId: OWN_WORKTREE.worktreeId,
        branch: OWN_WORKTREE.branch,
        path: OWN_WORKTREE.path,
        baseCommit: OWN_WORKTREE.baseCommit
      }
    ])
  })

  it('asks for a commit in the worktree first when git shows the passed changes uncommitted', async () => {
    passingWriteTask()
    world.state.worktreeChanges = { readable: true, commitsAhead: 0, uncommitted: true }
    await world.runner.validatePending()
    expect(verdicts[0]?.notice?.body).toContain(
      'uncommitted in worktree `C:/fixture/workspaces/nash-task-1`'
    )
    expect(verdicts[0]?.notice?.body).toContain(
      'commit them there in your terminal first, then merge branch `nash-task-1`'
    )
  })

  it('says there is nothing to merge when the passed worktree has no changes', async () => {
    passingWriteTask()
    world.state.worktreeChanges = { readable: true, commitsAhead: 0, uncommitted: false }
    await world.runner.validatePending()
    expect(verdicts[0]?.notice?.body).toContain('there is nothing to merge')
    expect(verdicts[0]?.notice?.body).not.toMatch(/merge that branch into your worktree/i)
  })

  it('asks the primary to check before merging when git cannot be read', async () => {
    passingWriteTask()
    world.state.worktreeChanges = { readable: false }
    await world.runner.validatePending()
    expect(verdicts[0]?.notice?.body).toMatch(/\bcheck\b/i)
    expect(verdicts[0]?.notice?.body).not.toMatch(/changes are (committed|uncommitted)/)
  })

  it('leaves the branch for inspection when the task fails, and reads no git for it', async () => {
    world = worldCapturingVerdicts()
    world.claimedTask({
      spec: { machineChecks: [{ kind: 'artifact_exists', path: 'missing.md', root: 'worktree' }] },
      executableEvidence: { executable: 'codex', attemptWorkspace: OWN_WORKTREE }
    })
    const [report] = await world.runner.validatePending()
    expect(report).toMatchObject({ outcome: 'settled', verdict: 'fail' })
    expect(verdicts[0]?.notice?.body).toMatch(/left for inspection/)
    expect(verdicts[0]?.notice?.body).not.toMatch(/merge that branch into your worktree/i)
    expect(world.state.worktreeReads).toEqual([])
  })
})
