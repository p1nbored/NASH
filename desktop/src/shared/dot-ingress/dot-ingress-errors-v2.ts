import {
  DOT_INGRESS_ERROR_CODES,
  DOT_INGRESS_ERROR_MESSAGES,
  isDotIngressErrorCode,
  type DotIngressErrorCode,
  type DotRetryable
} from './dot-ingress-errors'

// Contract version 2 adds these codes; version 1 keeps its list, so a version 1 call receives the
// fallback code instead, with the same data. Every code stays in the dot_ namespace.

export const DOT_INGRESS_V2_ONLY_ERROR_CODES = [
  // The requested access is above the maximum the user set for the workspace.
  'dot_access_above_maximum',
  // RG7: on a read-only run dot may deny a command or edit prompt but not allow it.
  'dot_decision_deny_only',
  // A cancel found the run still stopping or the request still changing; nothing was canceled.
  'dot_request_busy'
] as const
export type DotIngressV2OnlyErrorCode = (typeof DOT_INGRESS_V2_ONLY_ERROR_CODES)[number]

export const DOT_INGRESS_ERROR_CODES_V2 = [
  ...DOT_INGRESS_ERROR_CODES,
  ...DOT_INGRESS_V2_ONLY_ERROR_CODES
] as const
export type DotIngressErrorCodeV2 = (typeof DOT_INGRESS_ERROR_CODES_V2)[number]

export const DOT_INGRESS_V2_ONLY_ERROR_MESSAGES = {
  dot_access_above_maximum:
    'The requested access is above the maximum the user set for this workspace. Ask for less access, or ask the user to raise the maximum in the app.',
  dot_decision_deny_only:
    'This run may only read, so dot can deny this permission prompt but not allow it. Allowing it is possible only in the app.',
  dot_request_busy:
    'The run could not be stopped yet or the request is still changing, so nothing was canceled. Try again later.'
} as const satisfies Record<DotIngressV2OnlyErrorCode, string>

export const DOT_INGRESS_V2_ONLY_ERROR_RETRYABLE = {
  dot_access_above_maximum: 'yes',
  dot_decision_deny_only: 'no',
  dot_request_busy: 'later'
} as const satisfies Record<DotIngressV2OnlyErrorCode, DotRetryable>

/** The nearest version 1 code, which a version 1 call receives in place of a version 2 code. */
export const DOT_INGRESS_V1_FALLBACK_CODES = {
  dot_access_above_maximum: 'dot_workspace_unknown',
  dot_decision_deny_only: 'dot_decision_desktop_only',
  dot_request_busy: 'dot_request_not_cancelable'
} as const satisfies Record<DotIngressV2OnlyErrorCode, DotIngressErrorCode>

export function isDotIngressV2OnlyErrorCode(value: unknown): value is DotIngressV2OnlyErrorCode {
  return DOT_INGRESS_V2_ONLY_ERROR_CODES.some((code) => code === value)
}

/** A code of any served contract version: what the ingress may pass through to the dot. */
export function isDotIngressContractErrorCode(value: unknown): value is DotIngressErrorCodeV2 {
  return isDotIngressErrorCode(value) || isDotIngressV2OnlyErrorCode(value)
}

export function dotIngressErrorMessageV2(code: DotIngressErrorCodeV2): string {
  return isDotIngressV2OnlyErrorCode(code)
    ? DOT_INGRESS_V2_ONLY_ERROR_MESSAGES[code]
    : DOT_INGRESS_ERROR_MESSAGES[code]
}
