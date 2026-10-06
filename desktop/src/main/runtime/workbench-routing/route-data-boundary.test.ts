import { describe, expect, it } from 'vitest'
import type { ClefStateInput } from '../../clef/clef-state-builder'
import { evaluateRouteDataBoundary } from './route-data-boundary'

const FIXTURE_ONLY_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'

function check(objective: string, taskSpec: Partial<ClefStateInput> = {}) {
  return evaluateRouteDataBoundary({ objective, ...taskSpec })
}

describe('evaluateRouteDataBoundary (G1)', () => {
  it('passes a clean English TaskSpec and returns the state Clef would see', () => {
    const result = check('Add a retry button to the Workbench queue.', {
      expectedOutputs: ['A change to the queue.'],
      acceptanceCriteria: ['The tests pass.'],
      explicitConstraints: ['Keep the design.']
    })
    expect(result).toEqual({
      passed: true,
      state: {
        objective: 'Add a retry button to the Workbench queue.',
        expected_outputs: ['A change to the queue.'],
        acceptance_criteria: ['The tests pass.'],
        explicit_constraints: ['Keep the design.'],
        data_class: 'agent_task_spec'
      }
    })
  })

  it('blocks a content-scan hit as data_boundary_forbids and keeps only the rule names', () => {
    expect(check(`Bill account ${FIXTURE_ONLY_ACCOUNT_ID} for it.`)).toEqual({
      passed: false,
      blocker: { reason: 'classifier_unavailable', detail: 'data_boundary_forbids' },
      matchedRules: ['hex_identifier']
    })
  })

  it('scans every TaskSpec field, not only the objective', () => {
    for (const field of ['expectedOutputs', 'acceptanceCriteria', 'explicitConstraints'] as const) {
      const result = check('Add a retry button.', { [field]: ['Only edit /etc/hosts here.'] })
      expect(result).toEqual({
        passed: false,
        blocker: { reason: 'classifier_unavailable', detail: 'data_boundary_forbids' },
        matchedRules: ['posix_absolute_path']
      })
    }
  })

  it('blocks a SHA-256 in the prose but passes the same hash inside a verbatim span', () => {
    const hash = 'a'.repeat(64)
    expect(check(`Verify the build ${hash} again.`)).toMatchObject({
      passed: false,
      matchedRules: ['hex_identifier']
    })
    expect(check(`Verify the build "${hash}" again.`).passed).toBe(true)
  })

  it('still blocks a path or a hash in the prose outside the verbatim spans', () => {
    const result = check('Open C:\\work\\repo\\notes.txt and read "this".')
    expect(result.passed).toBe(false)
    expect(!result.passed && result.matchedRules).toEqual(['windows_absolute_path'])
  })

  it('passes non-English prose, which Clef classifies as written (D-027)', () => {
    const result = check('\u4FEE\u590D\u767B\u5F55\u9875\u9762')
    expect(result.passed && result.state.objective).toBe('\u4FEE\u590D\u767B\u5F55\u9875\u9762')
  })

  it('still reports a content-scan hit in non-English prose', () => {
    const result = check(`\u4FEE\u590D ${FIXTURE_ONLY_ACCOUNT_ID}`)
    expect(!result.passed && result.blocker.detail).toBe('data_boundary_forbids')
  })

  it('passes non-Latin text and paths inside quoted spans, which stay masked', () => {
    const result = check('Rename "\u767B\u5F55" in "C:\\work\\repo\\a.txt" now.')
    expect(result.passed).toBe(true)
    expect(result.passed && result.state.objective).toBe(
      'Rename [quoted text] in [quoted text] now.'
    )
  })

  it('asks for clarification when no prose is left outside the spans', () => {
    expect(check('"\u767B\u5F55"')).toEqual({
      passed: false,
      blocker: { reason: 'missing_inputs', detail: 'needs_clarification' },
      matchedRules: []
    })
  })

  it('passes an over-cap objective as an excerpt with a truncation marker (D-027)', () => {
    const result = check('z'.repeat(2_001))
    expect(result.passed && result.state.objective).toBe(`${'z'.repeat(1_988)} [truncated]`)
  })

  it('blocks a data class that is not on the allowed list', () => {
    const result = evaluateRouteDataBoundary({ objective: 'Add a retry button.' }, [])
    expect(result).toEqual({
      passed: false,
      blocker: { reason: 'classifier_unavailable', detail: 'data_boundary_forbids' },
      matchedRules: []
    })
    expect(
      evaluateRouteDataBoundary({ objective: 'Add a retry button.' }, ['user_task_summary']).passed
    ).toBe(false)
  })
})
