import { createHash } from 'node:crypto'
import { canonicalJson } from '../canonical-json'
import {
  DotCancelParamsV3,
  DotDecisionAnswerParamsV3,
  DotMessageParamsV3,
  DotSubmitParamsV3
} from '../dot-ingress/dot-ingress-v3'
import { DotValidationDecideParamsV3 } from '../dot-ingress/dot-ingress-validation'
import { DOT_REMOTE_PAYLOAD_CONTRACT_VERSION } from './dot-remote-limits'

// RG2/RG5: an inbox payload is exactly the v3 params of its method, as stored after the MCP layer
// adds contractVersion 3 and applies the schema defaults. Its hash is what deduplication compares.
// Remote contract v4 keeps these payloads: the dot ingress contract they follow did not change.

export const DOT_REMOTE_ITEM_KINDS = [
  'submit',
  'cancel',
  'permission_answer',
  'message',
  'validation_decision'
] as const
export type DotRemoteItemKind = (typeof DOT_REMOTE_ITEM_KINDS)[number]

export const DOT_REMOTE_ITEM_PAYLOAD_SCHEMAS = {
  submit: DotSubmitParamsV3,
  cancel: DotCancelParamsV3,
  permission_answer: DotDecisionAnswerParamsV3,
  message: DotMessageParamsV3,
  validation_decision: DotValidationDecideParamsV3
} as const

export const DOT_REMOTE_ITEM_METHODS = {
  submit: 'dotIngress.requests.submit',
  cancel: 'dotIngress.requests.cancel',
  permission_answer: 'dotIngress.decisions.answer',
  message: 'dotIngress.requests.message',
  validation_decision: 'dotIngress.validations.decide'
} as const satisfies Record<DotRemoteItemKind, string>

export const DOT_REMOTE_PAYLOAD_HASH_RULE = `payloadSha256 is the lowercase hex SHA-256 of the UTF-8 bytes of the canonical JSON of the stored payload. The stored payload is the v${DOT_REMOTE_PAYLOAD_CONTRACT_VERSION} params object after the MCP layer adds contractVersion ${DOT_REMOTE_PAYLOAD_CONTRACT_VERSION} and applies the schema defaults, such as requestedAccess read_only. Canonical JSON sorts object keys by UTF-16 code unit at every depth, omits members whose value is undefined, keeps array order, writes no whitespace, and writes strings and numbers exactly as JSON.stringify does, so non-ASCII characters stay unescaped.`

/** The exact text that payloadSha256 hashes. */
export function dotRemoteCanonicalPayload(payload: Record<string, unknown>): string {
  return canonicalJson(payload)
}

export function dotRemotePayloadSha256(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex')
}

/** The stored payload for a tool input: contractVersion is added here and never taken from input. */
export function dotRemoteInboxPayload(kind: DotRemoteItemKind, input: Record<string, unknown>) {
  if ('contractVersion' in input) {
    throw new Error('A tool input never carries contractVersion; the MCP layer injects it.')
  }
  return DOT_REMOTE_ITEM_PAYLOAD_SCHEMAS[kind].parse({
    ...input,
    contractVersion: DOT_REMOTE_PAYLOAD_CONTRACT_VERSION
  })
}
