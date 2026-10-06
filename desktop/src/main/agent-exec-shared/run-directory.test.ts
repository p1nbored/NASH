import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createRunDirectory,
  defaultTempRoots,
  locateRunDirectory,
  type RunDirectoryInput
} from './run-directory'

let base = ''
let worktree = ''
let runsRoot = ''

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'agent-exec-rundir-'))
  worktree = join(base, 'worktree')
  runsRoot = join(base, 'runs')
  mkdirSync(worktree)
  mkdirSync(runsRoot)
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

function input(overrides: Partial<RunDirectoryInput> = {}): RunDirectoryInput {
  return {
    runsRoot,
    runId: 'run-0001',
    worktreePath: worktree,
    platform: process.platform,
    // The suite itself lives under the OS temp directory, so the temp rule is injected per test.
    forbiddenRoots: [],
    ...overrides
  }
}

function kindOf(result: Awaited<ReturnType<typeof createRunDirectory>>): string {
  return result.ok ? 'ok' : result.kind
}

describe('locateRunDirectory (pure validation)', () => {
  it.each(['run-0001', 'A_b-9', 'a', 'x'.repeat(64)])('accepts run id %s', (runId) => {
    expect(locateRunDirectory({ runsRoot, runId }, process.platform)).toMatchObject({ ok: true })
  })

  it.each([
    '',
    '..',
    '.',
    '../escape',
    'a/b',
    'a\\b',
    '.hidden',
    '-leading',
    'has space',
    'x'.repeat(65),
    'NUL',
    'con',
    'run:1',
    'run\u0000'
  ])('rejects run id %j', (runId) => {
    expect(locateRunDirectory({ runsRoot, runId }, process.platform)).toMatchObject({ ok: false })
  })

  it.each([
    ['a non-string run id', { runsRoot, runId: 5 }],
    ['a non-string runs root', { runsRoot: 5, runId: 'r1' }],
    ['a relative runs root', { runsRoot: 'runs', runId: 'r1' }],
    ['a UNC runs root', { runsRoot: '\\\\server\\share\\runs', runId: 'r1' }],
    ['a runs root with NUL', { runsRoot: `${runsRoot}\u0000`, runId: 'r1' }]
  ])('rejects %s', (_label, value) => {
    expect(locateRunDirectory(value, process.platform)).toMatchObject({ ok: false })
  })

  it('derives every path from the root and the id', () => {
    const located = locateRunDirectory({ runsRoot, runId: 'r1' }, process.platform)
    expect(located).toEqual({
      ok: true,
      value: { runDir: join(runsRoot, 'r1'), tempDir: join(runsRoot, 'r1', 'tmp') }
    })
  })
})

describe('createRunDirectory', () => {
  it('creates a fresh run directory and its temp directory beneath the runs root', async () => {
    const result = await createRunDirectory(input())
    expect(result).toMatchObject({ ok: true })
    expect(statSync(join(runsRoot, 'run-0001')).isDirectory()).toBe(true)
    expect(statSync(join(runsRoot, 'run-0001', 'tmp')).isDirectory()).toBe(true)
  })

  it.skipIf(process.platform === 'win32')(
    'creates the directory private to its owner',
    async () => {
      await createRunDirectory(input())
      expect(statSync(join(runsRoot, 'run-0001')).mode & 0o077).toBe(0)
    }
  )

  it('never reuses a run directory that already exists, and leaves it untouched', async () => {
    const existing = join(runsRoot, 'run-0001')
    mkdirSync(existing)
    writeFileSync(join(existing, 'earlier-answer.txt'), 'stale answer from an earlier run')
    expect(kindOf(await createRunDirectory(input()))).toBe('run_dir_unusable')
    expect(existsSync(join(existing, 'earlier-answer.txt'))).toBe(true)
  })

  it('refuses two runs that race for the same id: exactly one wins', async () => {
    const results = await Promise.all([createRunDirectory(input()), createRunDirectory(input())])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toHaveLength(1)
  })

  it('refuses a runs root that does not exist or is not a directory', async () => {
    expect(kindOf(await createRunDirectory(input({ runsRoot: join(base, 'missing') })))).toBe(
      'run_dir_unusable'
    )
    const file = join(base, 'a-file')
    writeFileSync(file, 'x')
    expect(kindOf(await createRunDirectory(input({ runsRoot: file })))).toBe('run_dir_unusable')
  })

  it('refuses a runs root that is a symbolic link', async (context) => {
    const link = join(base, 'linked-runs')
    try {
      symlinkSync(runsRoot, link, 'junction')
    } catch {
      context.skip()
    }
    expect(kindOf(await createRunDirectory(input({ runsRoot: link })))).toBe('run_dir_unusable')
    expect(existsSync(join(runsRoot, 'run-0001'))).toBe(false)
  })

  it('refuses a runs root inside the worktree, or the worktree itself', async () => {
    const inside = join(worktree, 'runs')
    mkdirSync(inside)
    expect(kindOf(await createRunDirectory(input({ runsRoot: inside })))).toBe('run_dir_unusable')
    expect(kindOf(await createRunDirectory(input({ runsRoot: worktree })))).toBe('run_dir_unusable')
  })

  it('does not mistake a sibling that shares the worktree name prefix for the worktree', async () => {
    const sibling = join(base, 'worktree-runs')
    mkdirSync(sibling)
    expect(kindOf(await createRunDirectory(input({ runsRoot: sibling })))).toBe('ok')
  })

  it('refuses a runs root under any temp directory it is told about', async () => {
    expect(kindOf(await createRunDirectory(input({ forbiddenRoots: [base] })))).toBe(
      'run_dir_unusable'
    )
    expect(
      kindOf(await createRunDirectory(input({ forbiddenRoots: [join(base, 'elsewhere')] })))
    ).toBe('ok')
  })

  it('reports a malformed run id as invalid before touching the disk', async () => {
    const result = await createRunDirectory(input({ runId: '../escape' }))
    expect(kindOf(result)).toBe('invalid_request')
    expect(existsSync(join(base, 'escape'))).toBe(false)
  })
})

describe('defaultTempRoots', () => {
  it('always includes the OS temp directory', () => {
    expect(defaultTempRoots(process.platform)).toContain(tmpdir())
  })
})
