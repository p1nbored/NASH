import { describe, expect, it } from 'vitest'
import { isEnglishText } from '../english-text'
import { DOT_INGRESS_ERROR_CODES, isDotIngressErrorCode } from './dot-ingress-errors'
import { DOT_INGRESS_ERROR_CODES_V2 } from './dot-ingress-errors-v2'
import {
  DOT_INGRESS_ERROR_CODES_V3,
  DOT_INGRESS_V3_FALLBACK_CODES,
  DOT_INGRESS_V3_ONLY_ERROR_CODES,
  DOT_INGRESS_V3_ONLY_ERROR_RETRYABLE,
  dotIngressErrorMessageV3,
  isDotIngressContractErrorCodeV3
} from './dot-ingress-errors-v3'

describe('dot ingress error codes of contract version 3', () => {
  it('adds only the validation code, in the dot_ namespace, after the version 2 list', () => {
    expect([...DOT_INGRESS_V3_ONLY_ERROR_CODES]).toEqual(['dot_validation_not_found'])
    expect([...DOT_INGRESS_ERROR_CODES_V3]).toEqual([
      ...DOT_INGRESS_ERROR_CODES_V2,
      'dot_validation_not_found'
    ])
    expect(DOT_INGRESS_V3_ONLY_ERROR_RETRYABLE.dot_validation_not_found).toBe('no')
  })

  it('gives every code a fixed English message', () => {
    for (const code of DOT_INGRESS_ERROR_CODES_V3) {
      const message = dotIngressErrorMessageV3(code)
      expect(message.length, code).toBeGreaterThan(10)
      expect(isEnglishText(message), code).toBe(true)
    }
    expect(dotIngressErrorMessageV3('dot_validation_not_found')).toBe(
      'The validation decision was not found.'
    )
  })

  it('falls back to a version 1 code for callers of older versions', () => {
    for (const fallback of Object.values(DOT_INGRESS_V3_FALLBACK_CODES)) {
      expect(isDotIngressErrorCode(fallback)).toBe(true)
      expect(DOT_INGRESS_ERROR_CODES).toContain(fallback)
    }
    expect(DOT_INGRESS_V3_FALLBACK_CODES.dot_validation_not_found).toBe('dot_request_not_found')
  })

  it('recognises a code of any served version and nothing else', () => {
    for (const code of DOT_INGRESS_ERROR_CODES_V3) {
      expect(isDotIngressContractErrorCodeV3(code), code).toBe(true)
    }
    for (const other of ['internal_error', 'autopilot_validation_conflict', 'dot_unknown', 3]) {
      expect(isDotIngressContractErrorCodeV3(other), String(other)).toBe(false)
    }
  })
})
