import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FIXTURE_STARTED_MS, fakeEvidence, fakeExecutor } from './task-validation.test-fixture'
import type { AttemptEvidence } from './validation-context'
import {
  checkNoWorkspaceWrites,
  type WorkspaceGitPort,
  type WorkspaceGitStatus
} from './workspace-write-check'

const BEFORE = new Date(FIXTURE_STARTED_MS - 60_000)
const DURING = new Date(FIXTURE_STARTED_MS + 60_000)

function gitReporting(status: WorkspaceGitStatus): WorkspaceGitPort & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    readStatus: async (path) => {
      calls.push(path)
      return status
    }
  }
}

describe('no_workspace_writes', () => {
  let workspace: string
  let evidence: AttemptEvidence
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'c5-workspace-'))
    evidence = fakeEvidence({ workspace: { path: workspace, kind: 'git' } })
  })
  afterEach(() => rmSync(workspace, { recursive: true, force: true }))

  function changed(name: string, at: Date): string {
    const path = join(workspace, name)
    writeFileSync(path, 'x')
    utimesSync(path, at, at)
    return path
  }

  it('passes a clean workspace whose last commit predates the attempt', async () => {
    const git = gitReporting({ ok: true, changedFiles: [], headCommitSeconds: 1 })
    const result = await checkNoWorkspaceWrites(evidence, git)
    expect(result).toMatchObject({ kind: 'no_workspace_writes', status: 'pass' })
    expect(result.evidence).toHaveLength(1)
    expect(git.calls).toEqual([workspace])
  })

  it('fails when a changed file was written during the attempt', async () => {
    const files = [changed('old.md', BEFORE), changed('new.md', DURING)]
    const result = await checkNoWorkspaceWrites(
      evidence,
      gitReporting({ ok: true, changedFiles: files, headCommitSeconds: 1 })
    )
    expect(result).toMatchObject({
      status: 'fail',
      note: '1 changed path in the workspace was written during the attempt.'
    })
  })

  it('fails when a commit was made during the attempt', async () => {
    const seconds = Math.floor(FIXTURE_STARTED_MS / 1000) + 30
    expect(
      await checkNoWorkspaceWrites(
        evidence,
        gitReporting({ ok: true, changedFiles: [], headCommitSeconds: seconds })
      )
    ).toMatchObject({
      status: 'fail',
      note: 'A commit was made in the workspace during the attempt.'
    })
  })

  it('passes changes that all predate the attempt, and cannot decide on an undatable one', async () => {
    const old = [changed('a.md', BEFORE), changed('b.md', BEFORE)]
    expect(
      await checkNoWorkspaceWrites(
        evidence,
        gitReporting({ ok: true, changedFiles: old, headCommitSeconds: null })
      )
    ).toMatchObject({ status: 'pass' })
    const deleted = [...old, join(workspace, 'deleted.md')]
    expect(
      await checkNoWorkspaceWrites(
        evidence,
        gitReporting({ ok: true, changedFiles: deleted, headCommitSeconds: null })
      )
    ).toMatchObject({ status: 'inconclusive' })
  })

  it('cannot decide for a folder workspace, an unknown workspace, a live process or a git failure', async () => {
    const git = gitReporting({ ok: true, changedFiles: [], headCommitSeconds: null })
    expect(
      await checkNoWorkspaceWrites(
        { ...evidence, workspace: { path: workspace, kind: 'folder' } },
        git
      )
    ).toMatchObject({
      status: 'inconclusive',
      note: 'A folder workspace has no git status to compare.'
    })
    expect(await checkNoWorkspaceWrites({ ...evidence, workspace: null }, git)).toMatchObject({
      status: 'inconclusive'
    })
    expect(await checkNoWorkspaceWrites({ ...evidence, startedAtMs: null }, git)).toMatchObject({
      status: 'inconclusive',
      note: 'The start of the attempt is not recorded, so no change can be dated.'
    })
    const live = { ...evidence, executor: fakeExecutor({ treeVerdict: 'live' }) }
    expect(await checkNoWorkspaceWrites(live, git)).toMatchObject({ status: 'inconclusive' })
    expect(git.calls).toEqual([])
    expect(
      await checkNoWorkspaceWrites(evidence, gitReporting({ ok: false, reason: 'git_failed' }))
    ).toMatchObject({ status: 'inconclusive' })
  })
})
