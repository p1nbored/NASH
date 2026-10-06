import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createRunDirectory,
  defaultTempRoots,
  locateRunDirectory,
  type RunDirectoryInput
} from './codex-exec-run-directory'

// The creation rules (exclusive, private, fenced, validated ids) are tested with the shared module;
// this file covers only what the codex adapter adds: its two file locations and the pass-through.

let base = ''
let worktree = ''
let runsRoot = ''

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'codex-exec-rundir-'))
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

describe('locateRunDirectory (codex locations)', () => {
  it('derives every path from the root and the id, with the codex file names', () => {
    expect(locateRunDirectory({ runsRoot, runId: 'r1' }, process.platform)).toEqual({
      ok: true,
      value: {
        runDir: join(runsRoot, 'r1'),
        tempDir: join(runsRoot, 'r1', 'tmp'),
        lastMessagePath: join(runsRoot, 'r1', 'last-message.txt'),
        schemaPath: join(runsRoot, 'r1', 'result.schema.json')
      }
    })
  })

  it('passes a refusal through unchanged', () => {
    expect(locateRunDirectory({ runsRoot, runId: '../escape' }, process.platform)).toMatchObject({
      ok: false
    })
  })
})

describe('createRunDirectory (codex locations)', () => {
  it('returns the codex file locations for the directory it created', async () => {
    const result = await createRunDirectory(input())
    expect(result).toEqual({
      ok: true,
      value: {
        runDir: join(runsRoot, 'run-0001'),
        tempDir: join(runsRoot, 'run-0001', 'tmp'),
        lastMessagePath: join(runsRoot, 'run-0001', 'last-message.txt'),
        schemaPath: join(runsRoot, 'run-0001', 'result.schema.json')
      }
    })
    expect(existsSync(join(runsRoot, 'run-0001', 'tmp'))).toBe(true)
  })

  it('never reuses a run directory, so a stale last message cannot satisfy a new run', async () => {
    const existing = join(runsRoot, 'run-0001')
    mkdirSync(existing)
    writeFileSync(join(existing, 'last-message.txt'), 'stale answer from an earlier run')
    expect(await createRunDirectory(input())).toMatchObject({ ok: false, kind: 'run_dir_unusable' })
    expect(readFileSync(join(existing, 'last-message.txt'), 'utf8')).toBe(
      'stale answer from an earlier run'
    )
  })

  it('passes the kind of a refusal through unchanged', async () => {
    expect(await createRunDirectory(input({ runId: '../escape' }))).toMatchObject({
      ok: false,
      kind: 'invalid_request'
    })
  })
})

describe('defaultTempRoots (re-exported)', () => {
  it('always includes the OS temp directory', () => {
    expect(defaultTempRoots(process.platform)).toContain(tmpdir())
  })
})
