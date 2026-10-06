import { z } from 'zod'
import type { DotRetryable } from '../dot-ingress/dot-ingress-errors'
import {
  DOT_INGRESS_ERROR_CODES_V3,
  dotIngressErrorMessageV3,
  type DotIngressErrorCodeV3
} from '../dot-ingress/dot-ingress-errors-v3'

// Site-level codes. They never use the dot_ namespace, which belongs to NASH; NASH refusals keep
// their own code and fixed English message. Every message is fixed so a Site cannot reword one.

export const DOT_REMOTE_ERROR_MESSAGES = {
  nash_never_paired: 'NASH is not paired with this Site. Pair it from the NASH desktop app first.',
  unauthorized: 'This caller is not allowed to use this NASH pairing.',
  payload_invalid: 'The input does not match its schema. Fix the input and try again.',
  rate_limited: 'Too many calls in a short time. Try again later.',
  inbox_full: 'Too many items are waiting for NASH. Try again later.',
  idempotency_conflict:
    'This key was already used with different content. Use a new key for new content.',
  receipt_not_found: 'No item with this id was found.',
  request_not_found: 'NASH has not reported a request with this id.',
  decision_not_open: 'NASH has not reported an open permission prompt with this id.',
  decision_allow_not_permitted:
    'NASH reported that dot may only deny this permission prompt. Allowing it is possible only in the app.',
  session_expired: 'The session expired. Renew it, or pair again if renewal fails.',
  generation_revoked: 'This pairing was revoked. Pair NASH again from the desktop app.',
  lease_lost: 'This lease is no longer held. Lease the inbox again.',
  ack_conflict: 'This item was already acknowledged with a different outcome.',
  challenge_not_found: 'No pairing challenge with this code was found.',
  challenge_expired: 'The pairing code expired. Start pairing again from the desktop app.',
  challenge_used: 'The pairing code was already used. Start pairing again from the desktop app.',
  challenge_denied: 'The owner declined this pairing.',
  device_credential_invalid:
    'This device credential is not valid. Pair NASH again from the desktop app.',
  device_credential_reused:
    'This device credential was already replaced, so the pairing was revoked to protect it. Pair NASH again from the desktop app.',
  pairing_expired:
    'This pairing reached its maximum lifetime. Pair NASH again from the desktop app.',
  cancel_target_not_admitted:
    'NASH did not accept the task this cancel was for, so there is nothing to cancel.',
  pairing_revoked: 'The pairing was revoked before NASH took this item, so it was not delivered.',
  validation_decision_not_open:
    'NASH has not reported a validation decision with this id that is still waiting. Decide it in the app.'
} as const

export type DotRemoteErrorCode = keyof typeof DOT_REMOTE_ERROR_MESSAGES

export const DOT_REMOTE_ERROR_RETRYABLE = {
  nash_never_paired: 'no',
  unauthorized: 'no',
  payload_invalid: 'yes',
  rate_limited: 'later',
  inbox_full: 'later',
  idempotency_conflict: 'no',
  receipt_not_found: 'no',
  request_not_found: 'no',
  decision_not_open: 'no',
  decision_allow_not_permitted: 'no',
  session_expired: 'yes',
  generation_revoked: 'no',
  lease_lost: 'no',
  ack_conflict: 'no',
  challenge_not_found: 'no',
  challenge_expired: 'no',
  challenge_used: 'no',
  challenge_denied: 'no',
  device_credential_invalid: 'no',
  device_credential_reused: 'no',
  pairing_expired: 'no',
  cancel_target_not_admitted: 'no',
  pairing_revoked: 'no',
  validation_decision_not_open: 'no'
} as const satisfies Record<DotRemoteErrorCode, DotRetryable>

/** Codes a dot-facing MCP tool may return as an error result. */
export const DOT_REMOTE_TOOL_ERROR_CODES = [
  'nash_never_paired',
  'unauthorized',
  'payload_invalid',
  'rate_limited',
  'inbox_full',
  'idempotency_conflict',
  'receipt_not_found',
  'request_not_found',
  'decision_not_open',
  'decision_allow_not_permitted',
  'validation_decision_not_open'
] as const satisfies readonly DotRemoteErrorCode[]

/** Codes a NASH-facing or owner-facing endpoint may return. */
export const DOT_REMOTE_ENDPOINT_ERROR_CODES = [
  'unauthorized',
  'payload_invalid',
  'rate_limited',
  'session_expired',
  'generation_revoked',
  'lease_lost',
  'ack_conflict',
  'challenge_not_found',
  'challenge_expired',
  'challenge_used',
  'challenge_denied',
  'device_credential_invalid',
  'device_credential_reused',
  'pairing_expired'
] as const satisfies readonly DotRemoteErrorCode[]

/** Codes the Site itself writes into a refused receipt; NASH was never asked. */
export const DOT_REMOTE_SITE_REFUSAL_CODES = [
  'cancel_target_not_admitted',
  'pairing_revoked'
] as const

type NonEmpty<T> = readonly [T, ...T[]]

function mapNonEmpty<T, U>(items: NonEmpty<T>, map: (item: T) => U): [U, ...U[]] {
  const [first, ...rest] = items
  return [map(first), ...rest.map(map)]
}

function errorPair(code: DotRemoteErrorCode) {
  return z
    .object({
      code: z.literal(code),
      message: z.literal(DOT_REMOTE_ERROR_MESSAGES[code]),
      retryable: z.literal(DOT_REMOTE_ERROR_RETRYABLE[code])
    })
    .strict()
}

export const DotRemoteToolErrorSchema = z
  .object({
    error: z.discriminatedUnion('code', mapNonEmpty(DOT_REMOTE_TOOL_ERROR_CODES, errorPair))
  })
  .strict()

export const DotRemoteEndpointErrorSchema = z
  .object({
    error: z.discriminatedUnion('code', mapNonEmpty(DOT_REMOTE_ENDPOINT_ERROR_CODES, errorPair))
  })
  .strict()

function nashRefusal(code: DotIngressErrorCodeV3) {
  return z
    .object({
      by: z.literal('nash'),
      code: z.literal(code),
      message: z.literal(dotIngressErrorMessageV3(code))
    })
    .strict()
}

function siteRefusal(code: (typeof DOT_REMOTE_SITE_REFUSAL_CODES)[number]) {
  return z
    .object({
      by: z.literal('site'),
      code: z.literal(code),
      message: z.literal(DOT_REMOTE_ERROR_MESSAGES[code])
    })
    .strict()
}

/** A v3 contract code with its fixed English message, as NASH answered the item. */
export const DotRemoteNashRefusalSchema = z.discriminatedUnion(
  'code',
  mapNonEmpty(DOT_INGRESS_ERROR_CODES_V3, nashRefusal)
)

export const DotRemoteSiteRefusalSchema = z.discriminatedUnion(
  'code',
  mapNonEmpty(DOT_REMOTE_SITE_REFUSAL_CODES, siteRefusal)
)

export const DotRemoteReceiptRefusalSchema = z.union([
  DotRemoteNashRefusalSchema,
  DotRemoteSiteRefusalSchema
])

export function dotRemoteNashRefusal(code: DotIngressErrorCodeV3) {
  return { by: 'nash', code, message: dotIngressErrorMessageV3(code) } as const
}

export function dotRemoteSiteRefusal(code: (typeof DOT_REMOTE_SITE_REFUSAL_CODES)[number]) {
  return { by: 'site', code, message: DOT_REMOTE_ERROR_MESSAGES[code] } as const
}

export function dotRemoteError(code: DotRemoteErrorCode) {
  return {
    error: {
      code,
      message: DOT_REMOTE_ERROR_MESSAGES[code],
      retryable: DOT_REMOTE_ERROR_RETRYABLE[code]
    }
  } as const
}
