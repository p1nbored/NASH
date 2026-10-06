import { describe, expect, it } from 'vitest'
import {
  WORKBENCH_VALIDATION_ERROR_CODES,
  WorkbenchValidationCheckPendingParams,
  WorkbenchValidationCheckPendingResultSchema
} from './workbench-validation-params'

const RESULT = { checked: 5, passed: 2, failed: 1, inconclusive: 1, skipped: 1 }

describe('workbench.validation.checkPending params', () => {
  it('takes no input, so a caller cannot pick attempts, a limit or a reviewer', () => {
    expect(WorkbenchValidationCheckPendingParams.parse({})).toEqual({})
    for (const extra of [
      { limit: 100 },
      { dispatchId: 'ctx_0123456789ab' },
      { reviewer: 'codex' },
      { path: 'C:/Users/me/.ssh/id_rsa' }
    ]) {
      expect(WorkbenchValidationCheckPendingParams.safeParse(extra).success).toBe(false)
    }
  })
})

describe('workbench.validation.checkPending result', () => {
  it('carries counts by outcome and nothing else', () => {
    expect(
      WorkbenchValidationCheckPendingResultSchema.parse({
        ...RESULT,
        path: 'C:/private/result.json',
        resultText: 'file contents'
      })
    ).toEqual(RESULT)
  })

  it.each([
    ['a negative count', { ...RESULT, skipped: -1, checked: 3 }],
    ['a fractional count', { ...RESULT, passed: 1.5 }],
    ['a total that is not the sum of its outcomes', { ...RESULT, checked: 4 }],
    ['a missing outcome', { checked: 0, passed: 0, failed: 0, inconclusive: 0 }]
  ])('refuses %s', (_name, value) => {
    expect(WorkbenchValidationCheckPendingResultSchema.safeParse(value).success).toBe(false)
  })

  it('accepts an empty pass', () => {
    const empty = { checked: 0, passed: 0, failed: 0, inconclusive: 0, skipped: 0 }
    expect(WorkbenchValidationCheckPendingResultSchema.parse(empty)).toEqual(empty)
  })
})

describe('workbench validation refusal codes', () => {
  it('are distinct workbench codes, so the RPC error mapping passes them through', () => {
    const codes = Object.values(WORKBENCH_VALIDATION_ERROR_CODES)
    expect(new Set(codes).size).toBe(codes.length)
    for (const code of codes) {
      expect(code).toMatch(/^workbench_validation_[a-z_]+$/)
    }
  })
})
