import type * as FsPromises from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { FIXTURE_STARTED_MS, fakeEvidence } from './task-validation.test-fixture'
import { checkNoWorkspaceWrites } from './workspace-write-check'

// FIXTURE_ONLY: lstat is faked, so no path below exists or is read.
const tracker = vi.hoisted(() => ({ inFlight: 0, peak: 0, calls: 0 }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>()
  return {
    ...actual,
    lstat: async (path: string) => {
      tracker.calls += 1
      tracker.inFlight += 1
      tracker.peak = Math.max(tracker.peak, tracker.inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      tracker.inFlight -= 1
      if (path.endsWith('gone.md')) {
        throw new Error('ENOENT')
      }
      const written = path.includes('during') ? FIXTURE_STARTED_MS + 1_000 : FIXTURE_STARTED_MS - 1
      return { mtimeMs: written }
    }
  }
})

const WORKSPACE = 'C:\\fixture\\workspace'

function files(count: number, name: (index: number) => string): string[] {
  return Array.from({ length: count }, (_, index) => `${WORKSPACE}\\${name(index)}`)
}

async function check(changedFiles: string[]) {
  tracker.inFlight = 0
  tracker.peak = 0
  tracker.calls = 0
  const evidence = fakeEvidence({ workspace: { path: WORKSPACE, kind: 'git' } })
  return checkNoWorkspaceWrites(evidence, {
    readStatus: async () => ({ ok: true, changedFiles, headCommitSeconds: null })
  })
}

describe('no_workspace_writes: bounded file dating', () => {
  it('dates at most 16 changed files at a time and still counts every write', async () => {
    const changed = files(200, (index) =>
      index % 4 === 0 ? `during-${index}.md` : `old-${index}.md`
    )
    const result = await check(changed)
    expect(tracker.peak).toBeLessThanOrEqual(16)
    expect(tracker.calls).toBe(200)
    expect(result).toMatchObject({
      status: 'fail',
      note: '50 changed paths in the workspace were written during the attempt.'
    })
  })

  it('keeps the pass and undecidable results unchanged', async () => {
    expect(await check(files(40, (index) => `old-${index}.md`))).toMatchObject({
      status: 'pass',
      note: 'The workspace has 40 uncommitted changes, all older than the attempt.'
    })
    expect(tracker.peak).toBeLessThanOrEqual(16)
    expect(
      await check([...files(30, (index) => `old-${index}.md`), `${WORKSPACE}\\gone.md`])
    ).toMatchObject({
      status: 'inconclusive'
    })
  })
})
