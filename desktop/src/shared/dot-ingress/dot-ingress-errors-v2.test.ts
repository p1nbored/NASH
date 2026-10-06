import { describe, expect, it } from 'vitest'
import { isEnglishText } from '../english-text'
import { DOT_INGRESS_ERROR_CODES, DOT_INGRESS_ERROR_MESSAGES } from './dot-ingress-errors'
import {
  DOT_INGRESS_ERROR_CODES_V2,
  DOT_INGRESS_V1_FALLBACK_CODES,
  DOT_INGRESS_V2_ONLY_ERROR_CODES,
  DOT_INGRESS_V2_ONLY_ERROR_MESSAGES,
  DOT_INGRESS_V2_ONLY_ERROR_RETRYABLE,
  dotIngressErrorMessageV2,
  isDotIngressContractErrorCode,
  isDotIngressV2OnlyErrorCode
} from './dot-ingress-errors-v2'

describe('dot ingress error catalog of contract version 2', () => {
  it('pins the codes version 2 adds', () => {
    expect([...DOT_INGRESS_V2_ONLY_ERROR_CODES]).toEqual([
      'dot_access_above_maximum',
      'dot_decision_deny_only',
      'dot_request_busy'
    ])
  })

  it('keeps the version 1 list as it is and appends the new codes after it', () => {
    expect(DOT_INGRESS_ERROR_CODES).toHaveLength(18)
    expect([...DOT_INGRESS_ERROR_CODES_V2]).toEqual([
      ...DOT_INGRESS_ERROR_CODES,
      ...DOT_INGRESS_V2_ONLY_ERROR_CODES
    ])
    const versionOne = new Set<string>(DOT_INGRESS_ERROR_CODES)
    for (const code of DOT_INGRESS_V2_ONLY_ERROR_CODES) {
      expect(versionOne.has(code), code).toBe(false)
      expect(code).toMatch(/^dot_[a-z_]+$/)
    }
  })

  it('gives every new code one fixed English message, a retry hint and a version 1 fallback', () => {
    const codes = [...DOT_INGRESS_V2_ONLY_ERROR_CODES].sort()
    expect(Object.keys(DOT_INGRESS_V2_ONLY_ERROR_MESSAGES).sort()).toEqual(codes)
    expect(Object.keys(DOT_INGRESS_V2_ONLY_ERROR_RETRYABLE).sort()).toEqual(codes)
    expect(Object.keys(DOT_INGRESS_V1_FALLBACK_CODES).sort()).toEqual(codes)
    for (const [code, message] of Object.entries(DOT_INGRESS_V2_ONLY_ERROR_MESSAGES)) {
      expect(isEnglishText(message), code).toBe(true)
      expect(message, code).toMatch(/^[\x20-\x7e]+$/)
      expect(message.endsWith('.'), code).toBe(true)
      expect(message).not.toMatch(/[A-Za-z]:\\|\/[a-z]+\/|[0-9a-f]{8}-[0-9a-f]{4}/i)
    }
    for (const fallback of Object.values(DOT_INGRESS_V1_FALLBACK_CODES)) {
      expect(DOT_INGRESS_ERROR_CODES).toContain(fallback)
    }
  })

  it('marks what a client may retry', () => {
    expect(DOT_INGRESS_V2_ONLY_ERROR_RETRYABLE).toEqual({
      dot_access_above_maximum: 'yes',
      dot_decision_deny_only: 'no',
      dot_request_busy: 'later'
    })
  })

  it('falls back to the nearest version 1 code', () => {
    expect(DOT_INGRESS_V1_FALLBACK_CODES).toEqual({
      dot_access_above_maximum: 'dot_workspace_unknown',
      dot_decision_deny_only: 'dot_decision_desktop_only',
      dot_request_busy: 'dot_request_not_cancelable'
    })
  })

  it('looks up messages of either version and recognizes only contract codes', () => {
    expect(dotIngressErrorMessageV2('dot_request_busy')).toBe(
      DOT_INGRESS_V2_ONLY_ERROR_MESSAGES.dot_request_busy
    )
    expect(dotIngressErrorMessageV2('dot_rate_limited')).toBe(
      DOT_INGRESS_ERROR_MESSAGES.dot_rate_limited
    )
    expect(isDotIngressContractErrorCode('dot_rate_limited')).toBe(true)
    expect(isDotIngressContractErrorCode('dot_decision_deny_only')).toBe(true)
    for (const other of ['workbench_run_stop_unconfirmed', 'internal_error', 'dot_made_up', 7]) {
      expect(isDotIngressContractErrorCode(other), String(other)).toBe(false)
    }
    expect(isDotIngressV2OnlyErrorCode('dot_request_busy')).toBe(true)
    expect(isDotIngressV2OnlyErrorCode('dot_request_not_cancelable')).toBe(false)
  })
})
