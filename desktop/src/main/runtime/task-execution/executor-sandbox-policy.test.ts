// FIXTURE_ONLY: pure policy checks; no Codex or agy CLI is run.
import { describe, expect, it } from 'vitest'
import {
  agyAppliedAccess,
  agySandboxForAccess,
  codexAppliedAccess,
  codexSandboxForAccess
} from './executor-sandbox-policy'

const CODEX_APPLIED = {
  model: 'gpt-6.1-sol',
  effort: 'max',
  ephemeral: false,
  outputSchema: false,
  skipGitRepoCheck: false
} as const

describe('executor sandbox policy (D-025)', () => {
  it('runs Codex read-only for a read-only run and workspace-write for a write run', () => {
    expect(codexSandboxForAccess('read_only')).toBe('read-only')
    expect(codexSandboxForAccess('workspace_write')).toBe('workspace-write')
  })

  it('never maps any access level to danger-full-access', () => {
    for (const access of ['read_only', 'workspace_write'] as const) {
      expect(codexSandboxForAccess(access)).not.toBe('danger-full-access')
    }
  })

  it('keeps agy in its --sandbox for a read-only run and adds nothing for a write run', () => {
    expect(agySandboxForAccess('read_only')).toBe(true)
    expect(agySandboxForAccess('workspace_write')).toBe(false)
  })

  it('reads the access a Codex run went out with from the sandbox the runner applied', () => {
    expect(codexAppliedAccess({ ...CODEX_APPLIED, sandbox: 'read-only' })).toBe('read_only')
    expect(codexAppliedAccess({ ...CODEX_APPLIED, sandbox: 'workspace-write' })).toBe(
      'workspace_write'
    )
    // No --sandbox and a refused request applied nothing the access level asked for.
    expect(codexAppliedAccess({ ...CODEX_APPLIED, sandbox: null })).toBeNull()
    expect(codexAppliedAccess(null)).toBeNull()
  })

  it('reads the access an agy run went out with from whether its argv carried --sandbox', () => {
    const applied = { model: 'gemini-3.8-flash-high', effort: null }
    expect(
      agyAppliedAccess({
        applied,
        argv: ['--print=[prompt omitted, 9 chars]', '--sandbox', '--model', 'm']
      })
    ).toBe('read_only')
    expect(
      agyAppliedAccess({ applied, argv: ['--print=[prompt omitted, 9 chars]', '--model', 'm'] })
    ).toBe('workspace_write')
    expect(agyAppliedAccess({ applied: null, argv: [] })).toBeNull()
  })
})
