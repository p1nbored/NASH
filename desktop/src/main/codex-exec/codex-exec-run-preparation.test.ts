import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CODEX_EXEC_LIMITS } from './codex-exec-run-options'
import { prepareCodexExecRun } from './codex-exec-run-preparation'

let base = ''
let worktree = ''
let runsRoot = ''

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'codex-exec-prep-'))
  worktree = join(base, 'worktree')
  runsRoot = join(base, 'runs')
  mkdirSync(worktree)
  mkdirSync(runsRoot)
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

// The suite lives under the OS temp directory, so the temp-directory rule is switched off here.
const DEPS = { platform: process.platform, tempRoots: () => [] }

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

describe('prepareCodexExecRun', () => {
  it('creates the run directory and its temp directory, and reports their paths', async () => {
    const prepared = await prepareCodexExecRun(request(), DEFAULT_CODEX_EXEC_LIMITS, DEPS)
    expect(prepared.ok).toBe(true)
    expect(existsSync(join(runsRoot, 'run-0001', 'tmp'))).toBe(true)
    if (prepared.ok) {
      expect(prepared.run.location.runDir).toBe(join(runsRoot, 'run-0001'))
      expect(prepared.run.schema).toBeNull()
    }
  })

  it('writes the output schema into the new run directory when one is declared', async () => {
    const schema = { type: 'object', properties: { summary: { type: 'string' } } }
    const prepared = await prepareCodexExecRun(
      request({ outputSchema: schema }),
      DEFAULT_CODEX_EXEC_LIMITS,
      DEPS
    )
    expect(prepared.ok && prepared.run.schema).not.toBeNull()
    expect(
      JSON.parse(readFileSync(join(runsRoot, 'run-0001', 'result.schema.json'), 'utf8'))
    ).toEqual(schema)
  })

  it('refuses an invalid request before creating anything', async () => {
    const prepared = await prepareCodexExecRun(
      request({ effort: 'extreme' }),
      DEFAULT_CODEX_EXEC_LIMITS,
      DEPS
    )
    expect(prepared).toMatchObject({ ok: false, failure: { kind: 'invalid_request' } })
    expect(existsSync(join(runsRoot, 'run-0001'))).toBe(false)
  })

  it('refuses a schema it cannot enforce before creating the run directory', async () => {
    const prepared = await prepareCodexExecRun(
      request({ outputSchema: { type: 'object', required: ['missing'] } }),
      DEFAULT_CODEX_EXEC_LIMITS,
      DEPS
    )
    expect(prepared).toMatchObject({ ok: false, failure: { kind: 'schema_unvalidatable' } })
    expect(existsSync(join(runsRoot, 'run-0001'))).toBe(false)
  })

  it('never reuses a run directory that is already there', async () => {
    mkdirSync(join(runsRoot, 'run-0001'))
    const prepared = await prepareCodexExecRun(request(), DEFAULT_CODEX_EXEC_LIMITS, DEPS)
    expect(prepared).toMatchObject({ ok: false, failure: { kind: 'run_dir_unusable' } })
  })

  it('stops at the last-moment refusal of the caller before creating anything', async () => {
    const seen: string[] = []
    const prepared = await prepareCodexExecRun(
      request(),
      DEFAULT_CODEX_EXEC_LIMITS,
      DEPS,
      async (validated) => {
        seen.push(validated.location.runDir)
        return { kind: 'executable_not_launchable', detail: 'refused for the test' }
      }
    )
    expect(prepared).toMatchObject({ ok: false, failure: { kind: 'executable_not_launchable' } })
    expect(seen).toEqual([join(runsRoot, 'run-0001')])
    expect(existsSync(join(runsRoot, 'run-0001'))).toBe(false)
  })

  it('applies the OS temp-directory rule it was given', async () => {
    const prepared = await prepareCodexExecRun(request(), DEFAULT_CODEX_EXEC_LIMITS, {
      platform: process.platform,
      tempRoots: () => [base]
    })
    expect(prepared).toMatchObject({ ok: false, failure: { kind: 'run_dir_unusable' } })
  })
})
