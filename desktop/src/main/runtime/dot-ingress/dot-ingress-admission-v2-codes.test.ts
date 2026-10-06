import { describe, expect, it } from 'vitest'
import { DOT_INGRESS_ERROR_CODES } from '../../../shared/dot-ingress/dot-ingress-errors'
import {
  DOT_INGRESS_V2_ONLY_ERROR_CODES,
  dotIngressErrorMessageV2
} from '../../../shared/dot-ingress/dot-ingress-errors-v2'
import { errorResponse } from '../rpc/errors'
import {
  DOT_INGRESS_GENERIC_FAILURE_MESSAGE,
  sanitizeDotIngressResponse
} from './dot-ingress-admission'

// E1: the ingress passes every contract code a served version can answer with (v1 and v2), with
// its data, and still replaces anything else, such as an internal store code, with a fixed one.

const meta = { runtimeId: 'runtime-fixture-1' }

describe('the dot ingress response sanitizer and contract version 2', () => {
  it.each([...DOT_INGRESS_V2_ONLY_ERROR_CODES])('passes the v2 code %s with its data', (code) => {
    const response = errorResponse('req-1', meta, code, dotIngressErrorMessageV2(code), {
      reason: 'fixture_reason'
    })
    expect(sanitizeDotIngressResponse(response)).toEqual(response)
  })

  it.each([...DOT_INGRESS_ERROR_CODES])('still passes the v1 code %s', (code) => {
    const response = errorResponse('req-2', meta, code, dotIngressErrorMessageV2(code))
    expect(sanitizeDotIngressResponse(response)).toEqual(response)
  })

  it.each(['dot_invalid_input', 'dot_transaction_unavailable', 'autopilot_run_not_live'])(
    'replaces the non-contract code %s with the generic failure',
    (code) => {
      const response = errorResponse('req-3', meta, code, 'Internal detail C:/path', { a: 1 })
      expect(sanitizeDotIngressResponse(response)).toEqual(
        errorResponse('req-3', meta, 'internal_error', DOT_INGRESS_GENERIC_FAILURE_MESSAGE)
      )
    }
  )
})
