import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { validateCodexExecRequest } from './codex-exec-request-validation'

let base = ''
let worktree = ''
let runsRoot = ''

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'codex-exec-request-'))
  worktree = join(base, 'worktree')
  runsRoot = join(base, 'runs')
  mkdirSync(worktree)
  mkdirSync(runsRoot)
})

afterAll(() => {
  rmSync(base, { recursive: true, force: true })
})

const LIMITS = { maxPromptBytes: 1024 }

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    prompt: 'Summarize the repository.',
    model: 'gpt-6-astra',
    effort: 'high',
    sandbox: 'read-only',
    worktreePath: worktree,
    runsRoot,
    runId: 'run-0001',
    ...overrides
  }
}

function problemOf(value: unknown): string {
  const result = validateCodexExecRequest(value, LIMITS, process.platform)
  if (result.ok) {
    throw new Error('expected the request to be refused')
  }
  expect(result.failure.kind).toBe('invalid_request')
  return result.failure.detail
}

describe('validateCodexExecRequest', () => {
  it('accepts a valid request and derives the argv and applied settings from it', () => {
    const result = validateCodexExecRequest(
      request({ ephemeral: true, sandbox: 'workspace-write' }),
      LIMITS,
      process.platform
    )
    expect(result).toMatchObject({
      ok: true,
      value: {
        applied: {
          model: 'gpt-6-astra',
          effort: 'high',
          sandbox: 'workspace-write',
          ephemeral: true,
          outputSchema: false
        }
      }
    })
    if (result.ok) {
      expect(result.value.argv).toContain('--ephemeral')
      expect(result.value.argv).toContain(join(runsRoot, 'run-0001', 'last-message.txt'))
    }
  })

  it("records no sandbox and passes no --sandbox when the request leaves it to codex's default", () => {
    const result = validateCodexExecRequest(
      request({ sandbox: undefined }),
      LIMITS,
      process.platform
    )
    expect(result).toMatchObject({ ok: true, value: { applied: { sandbox: null } } })
    expect(result.ok && result.value.argv).not.toContain('--sandbox')
  })

  it('passes the schema path to --output-schema only when a schema is declared', () => {
    const schema = { type: 'object', properties: {} }
    const result = validateCodexExecRequest(
      request({ outputSchema: schema }),
      LIMITS,
      process.platform
    )
    expect(result.ok && result.value.argv).toContain(
      join(runsRoot, 'run-0001', 'result.schema.json')
    )
    expect(result.ok && result.value.applied.outputSchema).toBe(true)
  })

  it('skips the git-repository check only when the request asks, and records it as applied', () => {
    const skipped = validateCodexExecRequest(
      request({ skipGitRepoCheck: true }),
      LIMITS,
      process.platform
    )
    expect(skipped.ok && skipped.value.argv).toContain('--skip-git-repo-check')
    expect(skipped.ok && skipped.value.applied.skipGitRepoCheck).toBe(true)
    const plain = validateCodexExecRequest(request(), LIMITS, process.platform)
    expect(plain.ok && plain.value.argv).not.toContain('--skip-git-repo-check')
    expect(plain.ok && plain.value.applied.skipGitRepoCheck).toBe(false)
  })

  it.each([
    ['a non-object request', null],
    ['a string request', 'prompt'],
    ['a non-string model', request({ model: 5 })],
    ['a non-string effort', request({ effort: ['high'] })],
    ['a non-string sandbox', request({ sandbox: {} })],
    ['a non-string worktree', request({ worktreePath: 7 })],
    ['a non-string prompt', request({ prompt: 5 })],
    ['a string for ephemeral', request({ ephemeral: 'false' })],
    ['a number for ephemeral', request({ ephemeral: 1 })],
    ['a string for skipGitRepoCheck', request({ skipGitRepoCheck: 'true' })],
    ['an array output schema', request({ outputSchema: [] })],
    ['a string output schema', request({ outputSchema: '{}' })],
    ['a missing runs root', request({ runsRoot: undefined })],
    ['a relative runs root', request({ runsRoot: 'runs' })],
    ['a malformed run id', request({ runId: '../x' })],
    ['a missing run id', request({ runId: undefined })],
    ['a UNC worktree', request({ worktreePath: '\\\\server\\share\\wt' })],
    ['effort extreme', request({ effort: 'extreme' })],
    ['danger-full-access', request({ sandbox: 'danger-full-access' })],
    ['an empty prompt', request({ prompt: '  ' })],
    ['a NUL in the prompt', request({ prompt: 'a\u0000b' })],
    ['a prompt above the cap', request({ prompt: 'p'.repeat(2048) })]
  ])('refuses %s with a typed failure and never throws', (_label, value) => {
    expect(problemOf(value).length).toBeGreaterThan(0)
  })

  it('does not echo a hostile value into the failure detail', () => {
    expect(problemOf(request({ model: 'SECRET-SENTINEL value' }))).not.toContain('SECRET-SENTINEL')
  })
})
