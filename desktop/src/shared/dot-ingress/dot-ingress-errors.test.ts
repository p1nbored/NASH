import { describe, expect, it } from 'vitest'
import { isEnglishText } from '../english-text'
import {
  DOT_INGRESS_ERROR_CODES,
  DOT_INGRESS_ERROR_MESSAGES,
  DOT_INGRESS_ERROR_RETRYABLE,
  dotIngressErrorMessage,
  isDotIngressErrorCode
} from './dot-ingress-errors'
import {
  DOT_DEFAULT_REQUEST_ACCESS,
  DOT_INGRESS_CONTRACT_VERSION,
  DOT_INGRESS_DEFAULT_RATE_PER_MINUTE,
  DOT_INGRESS_DEFAULT_RATE_PER_UTC_DAY,
  DOT_INGRESS_PRINCIPAL_ID,
  DOT_INGRESS_RATE_WINDOW_MS,
  DOT_INGRESS_RECEIVED_LIMIT,
  DOT_INGRESS_RETAINED_LIMIT
} from './dot-ingress-limits'
import { DOT_REQUEST_STATES, DOT_REQUEST_STATUS_TEXT } from './dot-ingress-status-text'

describe('dot ingress error catalog', () => {
  it('pins the closed set of codes of contract version 1', () => {
    expect([...DOT_INGRESS_ERROR_CODES]).toEqual([
      'dot_ingress_disabled',
      'dot_ingress_forbidden',
      'dot_unsupported_contract_version',
      'dot_workspace_unknown',
      'dot_workspace_unavailable',
      'dot_requirement_not_english',
      'dot_requirement_unclear',
      'dot_requirement_too_long',
      'dot_requirement_rejected_content',
      'dot_deliverable_language_invalid',
      'dot_idempotency_conflict',
      'dot_request_not_found',
      'dot_request_not_cancelable',
      'dot_capacity_exceeded',
      'dot_rate_limited',
      'dot_recovery_required',
      'dot_decision_not_found',
      'dot_decision_desktop_only'
    ])
  })

  it('gives every code one fixed message and one retry hint, and nothing else', () => {
    expect(Object.keys(DOT_INGRESS_ERROR_MESSAGES).sort()).toEqual(
      [...DOT_INGRESS_ERROR_CODES].sort()
    )
    expect(Object.keys(DOT_INGRESS_ERROR_RETRYABLE).sort()).toEqual(
      [...DOT_INGRESS_ERROR_CODES].sort()
    )
    for (const hint of Object.values(DOT_INGRESS_ERROR_RETRYABLE)) {
      expect(['yes', 'no', 'maybe', 'later']).toContain(hint)
    }
  })

  it('keeps every code in the dot_ namespace so the dispatcher can pass it through', () => {
    for (const code of DOT_INGRESS_ERROR_CODES) {
      expect(code).toMatch(/^dot_[a-z_]+$/)
    }
  })

  it('writes every message in English, as plain printable text', () => {
    for (const [code, message] of Object.entries(DOT_INGRESS_ERROR_MESSAGES)) {
      expect(isEnglishText(message), code).toBe(true)
      expect(message, code).toMatch(/^[\x20-\x7e]+$/)
      expect(message.length, code).toBeLessThanOrEqual(300)
      expect(message.endsWith('.'), code).toBe(true)
    }
  })

  it('tells the dot how to rewrite a requirement that is not English, with the required wording', () => {
    expect(DOT_INGRESS_ERROR_MESSAGES.dot_requirement_not_english).toBe(
      'Rewrite the requirement in English. Put names, paths and quotations that must not be translated inside double quotes, typographic double quotes or backticks.'
    )
    expect(DOT_INGRESS_ERROR_RETRYABLE.dot_requirement_not_english).toBe('yes')
  })

  it('lists the supported contract versions in the version error', () => {
    expect(DOT_INGRESS_ERROR_MESSAGES.dot_unsupported_contract_version).toContain(
      String(DOT_INGRESS_CONTRACT_VERSION)
    )
  })

  it('names rules or limits only: no message quotes request text, ids or paths', () => {
    for (const message of Object.values(DOT_INGRESS_ERROR_MESSAGES)) {
      expect(message).not.toMatch(/[A-Za-z]:\\|\/[a-z]+\/|[0-9a-f]{8}-[0-9a-f]{4}/i)
    }
    expect(DOT_INGRESS_ERROR_MESSAGES.dot_requirement_rejected_content).not.toMatch(
      /matched|contains "/i
    )
  })

  it('marks the retry behavior the blueprint requires', () => {
    expect(DOT_INGRESS_ERROR_RETRYABLE).toMatchObject({
      dot_ingress_disabled: 'no',
      dot_ingress_forbidden: 'no',
      dot_unsupported_contract_version: 'no',
      dot_workspace_unknown: 'no',
      dot_workspace_unavailable: 'maybe',
      dot_requirement_unclear: 'yes',
      dot_requirement_too_long: 'yes',
      dot_requirement_rejected_content: 'yes',
      dot_deliverable_language_invalid: 'yes',
      dot_idempotency_conflict: 'no',
      dot_request_not_found: 'no',
      dot_request_not_cancelable: 'no',
      dot_capacity_exceeded: 'later',
      dot_rate_limited: 'later',
      dot_recovery_required: 'no'
    })
  })

  it('looks a message up by code and recognizes only catalog codes', () => {
    expect(dotIngressErrorMessage('dot_request_not_found')).toBe(
      DOT_INGRESS_ERROR_MESSAGES.dot_request_not_found
    )
    expect(isDotIngressErrorCode('dot_rate_limited')).toBe(true)
    expect(isDotIngressErrorCode('dot_made_up')).toBe(false)
    expect(isDotIngressErrorCode('unauthorized')).toBe(false)
    expect(isDotIngressErrorCode(undefined)).toBe(false)
  })
})

describe('dot ingress status text', () => {
  it('has one constant English sentence per request state', () => {
    expect(Object.keys(DOT_REQUEST_STATUS_TEXT).sort()).toEqual([...DOT_REQUEST_STATES].sort())
    expect(new Set(Object.values(DOT_REQUEST_STATUS_TEXT)).size).toBe(DOT_REQUEST_STATES.length)
    for (const [state, text] of Object.entries(DOT_REQUEST_STATUS_TEXT)) {
      expect(isEnglishText(text), state).toBe(true)
      expect(text, state).toMatch(/^[\x20-\x7e]+$/)
    }
  })

  it('never promises more than the request state says: no result, completion or approval', () => {
    for (const text of Object.values(DOT_REQUEST_STATUS_TEXT)) {
      expect(text).not.toMatch(/approved|finished|completed|done|result/i)
    }
  })
})

describe('dot ingress limits', () => {
  it('pins the trust-policy numbers and the defaults the user can change', () => {
    expect(DOT_INGRESS_RECEIVED_LIMIT).toBe(20)
    expect(DOT_INGRESS_RETAINED_LIMIT).toBe(10_000)
    expect(DOT_INGRESS_DEFAULT_RATE_PER_MINUTE).toBe(6)
    expect(DOT_INGRESS_DEFAULT_RATE_PER_UTC_DAY).toBe(100)
    expect(DOT_INGRESS_RATE_WINDOW_MS).toBe(60_000)
    expect(DOT_INGRESS_CONTRACT_VERSION).toBe(1)
  })

  it('files the dot under its own principal, never the desktop one, and defaults access to read_only', () => {
    expect(DOT_INGRESS_PRINCIPAL_ID).toBe('dot-ingress')
    expect(DOT_INGRESS_PRINCIPAL_ID).not.toBe('local-desktop-ui')
    expect(DOT_DEFAULT_REQUEST_ACCESS).toBe('read_only')
  })
})
