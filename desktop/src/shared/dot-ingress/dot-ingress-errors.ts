import { DOT_INGRESS_SUPPORTED_CONTRACT_VERSIONS } from './dot-ingress-limits'

// Every code starts with dot_ so the dispatcher can pass it through; messages are fixed English.

export const DOT_INGRESS_ERROR_CODES = [
  'dot_ingress_disabled',
  'dot_ingress_forbidden',
  'dot_unsupported_contract_version',
  'dot_workspace_unknown',
  'dot_workspace_unavailable',
  'dot_requirement_not_english',
  'dot_requirement_unclear',
  'dot_requirement_too_long',
  'dot_requirement_rejected_content',
  'dot_idempotency_conflict',
  'dot_request_not_found',
  'dot_request_not_cancelable',
  'dot_capacity_exceeded',
  'dot_rate_limited',
  'dot_recovery_required',
  // Decision codes: an unknown id, and a tool the user keeps for the desktop.
  'dot_decision_not_found',
  'dot_decision_desktop_only',
  'dot_access_above_maximum',
  'dot_decision_deny_only',
  'dot_request_busy',
  'dot_validation_not_found'
] as const
export type DotIngressErrorCode = (typeof DOT_INGRESS_ERROR_CODES)[number]

export type DotRetryable = 'yes' | 'no' | 'maybe' | 'later'

const SUPPORTED_VERSIONS = DOT_INGRESS_SUPPORTED_CONTRACT_VERSIONS.join(', ')

export const DOT_INGRESS_ERROR_MESSAGES = {
  dot_ingress_disabled: 'The dot interface is turned off in the app.',
  dot_ingress_forbidden: 'This caller is not allowed to use the dot interface.',
  dot_unsupported_contract_version: `Unsupported contract version. Supported versions: ${SUPPORTED_VERSIONS}.`,
  dot_workspace_unknown: 'This workspace reference is not enabled for dot requests.',
  dot_workspace_unavailable:
    'The workspace is not available right now. Local workspaces only; try again later.',
  dot_requirement_not_english:
    'Rewrite the requirement in English. Put names, paths and quotations that must not be translated inside double quotes, typographic double quotes or backticks.',
  dot_requirement_unclear:
    'The requirement is blank or has no prose outside quoted text. Describe the task in English sentences.',
  dot_requirement_too_long:
    'The requirement is too long. Shorten the prose or reduce the quoted spans.',
  dot_requirement_rejected_content:
    'The requirement was rejected because it contains content that must not leave the machine. Remove it and resubmit.',
  dot_idempotency_conflict: 'This idempotency key was already used for a different request.',
  dot_request_not_found: 'The request was not found.',
  dot_request_not_cancelable:
    'Only a request that was handed to the workbench and is not yet canceled can be canceled.',
  dot_capacity_exceeded: 'Too many dot requests are waiting or stored. Try again later.',
  dot_rate_limited: 'The submission limit set in the app was reached. Try again later.',
  dot_recovery_required: 'The dot request store needs recovery in the app. Nothing was changed.',
  dot_decision_not_found: 'The permission prompt was not found.',
  dot_decision_desktop_only: 'This permission prompt can only be answered in the app.',
  dot_access_above_maximum:
    'The requested access is above the maximum the user set for this workspace. Ask for less access, or ask the user to raise the maximum in the app.',
  dot_decision_deny_only:
    'This run may only read, so dot can deny this permission prompt but not allow it. Allowing it is possible only in the app.',
  dot_request_busy:
    'The run could not be stopped yet or the request is still changing, so nothing was canceled. Try again later.',
  dot_validation_not_found: 'The validation decision was not found.'
} as const satisfies Record<DotIngressErrorCode, string>

export const DOT_INGRESS_ERROR_RETRYABLE = {
  dot_ingress_disabled: 'no',
  dot_ingress_forbidden: 'no',
  dot_unsupported_contract_version: 'no',
  dot_workspace_unknown: 'no',
  dot_workspace_unavailable: 'maybe',
  dot_requirement_not_english: 'yes',
  dot_requirement_unclear: 'yes',
  dot_requirement_too_long: 'yes',
  dot_requirement_rejected_content: 'yes',
  dot_idempotency_conflict: 'no',
  dot_request_not_found: 'no',
  dot_request_not_cancelable: 'no',
  dot_capacity_exceeded: 'later',
  dot_rate_limited: 'later',
  dot_recovery_required: 'no',
  dot_decision_not_found: 'no',
  dot_decision_desktop_only: 'no',
  dot_access_above_maximum: 'yes',
  dot_decision_deny_only: 'no',
  dot_request_busy: 'later',
  dot_validation_not_found: 'no'
} as const satisfies Record<DotIngressErrorCode, DotRetryable>

export function isDotIngressErrorCode(value: unknown): value is DotIngressErrorCode {
  return typeof value === 'string' && DOT_INGRESS_ERROR_CODES.some((code) => code === value)
}

export function dotIngressErrorMessage(code: DotIngressErrorCode): string {
  return DOT_INGRESS_ERROR_MESSAGES[code]
}
