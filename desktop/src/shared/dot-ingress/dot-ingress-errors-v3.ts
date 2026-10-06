import type { DotIngressErrorCode, DotRetryable } from './dot-ingress-errors'
import {
  DOT_INGRESS_ERROR_CODES_V2,
  dotIngressErrorMessageV2,
  isDotIngressContractErrorCode
} from './dot-ingress-errors-v2'

// Contract version 3 adds one code. Older callers never reach a validation method, but a version 1
// or 2 refusal still never carries it: they receive the fallback code with the same data.

export const DOT_INGRESS_V3_ONLY_ERROR_CODES = [
  // The validation is unknown, belongs to a run dot did not start, or has no result to decide yet.
  'dot_validation_not_found'
] as const
export type DotIngressV3OnlyErrorCode = (typeof DOT_INGRESS_V3_ONLY_ERROR_CODES)[number]

export const DOT_INGRESS_ERROR_CODES_V3 = [
  ...DOT_INGRESS_ERROR_CODES_V2,
  ...DOT_INGRESS_V3_ONLY_ERROR_CODES
] as const
export type DotIngressErrorCodeV3 = (typeof DOT_INGRESS_ERROR_CODES_V3)[number]

export const DOT_INGRESS_V3_ONLY_ERROR_MESSAGES = {
  dot_validation_not_found: 'The validation decision was not found.'
} as const satisfies Record<DotIngressV3OnlyErrorCode, string>

export const DOT_INGRESS_V3_ONLY_ERROR_RETRYABLE = {
  dot_validation_not_found: 'no'
} as const satisfies Record<DotIngressV3OnlyErrorCode, DotRetryable>

/** The nearest version 1 code, which a version 1 or 2 call receives in place of a version 3 code. */
export const DOT_INGRESS_V3_FALLBACK_CODES = {
  dot_validation_not_found: 'dot_request_not_found'
} as const satisfies Record<DotIngressV3OnlyErrorCode, DotIngressErrorCode>

export function isDotIngressV3OnlyErrorCode(value: unknown): value is DotIngressV3OnlyErrorCode {
  return DOT_INGRESS_V3_ONLY_ERROR_CODES.some((code) => code === value)
}

/** A code of any served contract version: what the ingress may pass through to dot. */
export function isDotIngressContractErrorCodeV3(value: unknown): value is DotIngressErrorCodeV3 {
  return isDotIngressContractErrorCode(value) || isDotIngressV3OnlyErrorCode(value)
}

export function dotIngressErrorMessageV3(code: DotIngressErrorCodeV3): string {
  return isDotIngressV3OnlyErrorCode(code)
    ? DOT_INGRESS_V3_ONLY_ERROR_MESSAGES[code]
    : dotIngressErrorMessageV2(code)
}
