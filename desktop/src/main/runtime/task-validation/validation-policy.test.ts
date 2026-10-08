import { describe, expect, it } from 'vitest'
import { MACHINE_CHECK_KINDS, planValidation } from './validation-policy'

describe('validation policy', () => {
  it('validates a TaskSpec without machine checks by its default check, never by refusing it', () => {
    expect(planValidation({ machineChecks: [] })).toEqual({ policy: 'default' })
    expect(planValidation({ machineChecks: [], review: null })).toEqual({ policy: 'default' })
  })

  it('runs a model review only when the TaskSpec asks for one, after its machine checks (D-027)', () => {
    expect(planValidation({ machineChecks: [], review: 'model' })).toEqual({
      policy: 'model_review',
      checks: []
    })
    expect(
      planValidation({ machineChecks: [{ kind: 'secret_scan_clean' }], review: 'model' })
    ).toEqual({ policy: 'model_review', checks: [{ kind: 'secret_scan_clean' }] })
  })

  it('runs the machine checks in the order the TaskSpec lists them', () => {
    const plan = planValidation({
      machineChecks: [
        { kind: 'artifact_exists', path: 'out/report.md' },
        { kind: 'no_workspace_writes' },
        { kind: 'secret_scan_clean' }
      ]
    })
    expect(plan).toEqual({
      policy: 'machine_checks',
      checks: [
        { kind: 'artifact_exists', path: 'out/report.md', root: 'worktree' },
        { kind: 'no_workspace_writes' },
        { kind: 'secret_scan_clean' }
      ]
    })
    expect(MACHINE_CHECK_KINDS).toEqual([
      'artifact_exists',
      'no_workspace_writes',
      'secret_scan_clean'
    ])
  })

  it('keeps an unknown kind or bad parameters as a check that cannot decide, in its place', () => {
    const plan = planValidation({
      machineChecks: [
        { kind: 'unit_tests_pass' },
        { kind: 'artifact_exists' },
        { kind: 'artifact_exists', path: 'a.md', root: 'home' },
        { kind: 'artifact_exists', path: 'result.json', root: 'run_directory' },
        { kind: 'no_workspace_writes', strict: true },
        { kind: 'output_schema', schema: 'not json' },
        { kind: 'output_schema', schema: '[1, 2]' }
      ]
    })
    expect(plan).toEqual({
      policy: 'machine_checks',
      checks: [
        { kind: 'invalid', specKind: 'unit_tests_pass', problem: 'unknown_kind' },
        { kind: 'invalid', specKind: 'artifact_exists', problem: 'invalid_parameters' },
        { kind: 'invalid', specKind: 'artifact_exists', problem: 'invalid_parameters' },
        { kind: 'invalid', specKind: 'artifact_exists', problem: 'invalid_parameters' },
        { kind: 'invalid', specKind: 'no_workspace_writes', problem: 'invalid_parameters' },
        { kind: 'invalid', specKind: 'output_schema', problem: 'unknown_kind' },
        { kind: 'invalid', specKind: 'output_schema', problem: 'unknown_kind' }
      ]
    })
  })
})
