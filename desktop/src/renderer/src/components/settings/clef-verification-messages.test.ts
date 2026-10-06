import { describe, expect, it } from 'vitest'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { CLEF_PROFILE_PROBLEMS } from '../../../../shared/clef/clef-verification-view'
import {
  ROUTE_BLOCKER_DETAILS,
  ROUTE_BLOCKER_REASONS,
  ROUTING_STATUSES
} from '../../../../shared/clef/clef-route-contract'
import * as messagesModule from './clef-verification-messages'
import {
  clefBlockerMessage,
  clefProfileProblemMessage,
  clefRoutingStatusMessage,
  clefVerificationCallErrorMessage
} from './clef-verification-messages'

const SNAKE_CASE_CODE = /\b[a-z]+_[a-z_]+\b/

// The refusals main raises before anything is spent (clef-verifier-refusals.ts).
const VERIFIER_ERROR_CODES = [
  'workbench_clef_credentials_missing',
  'workbench_clef_credentials_unsealed',
  'workbench_clef_auth_failed',
  'workbench_clef_quota_latched',
  'workbench_clef_circuit_open',
  'workbench_clef_verification_in_progress',
  'workbench_clef_request_invalid',
  'workbench_clef_report_unconfirmed',
  'workbench_clef_report_not_pinnable',
  'workbench_clef_profile_write_failed',
  'workbench_clef_unavailable',
  'workbench_routing_not_configured',
  'workbench_forbidden',
  'method_not_found'
]

function rpcError(code: string): RuntimeRpcCallError {
  return new RuntimeRpcCallError({ id: 'rpc-1', ok: false, error: { code, message: 'raw text' } })
}

function expectPlainEnglish(messages: string[]): void {
  for (const message of messages) {
    expect(message).not.toMatch(SNAKE_CASE_CODE)
    // Why 4: the shortest real label is "Ready"; a bare code fragment would be shorter.
    expect(message.length).toBeGreaterThanOrEqual(4)
  }
  expect(new Set(messages).size).toBe(messages.length)
}

describe('Clef verification messages', () => {
  it('labels every routing status in plain English', () => {
    expectPlainEnglish(ROUTING_STATUSES.map((status) => clefRoutingStatusMessage(status).label))
    expectPlainEnglish(ROUTING_STATUSES.map((status) => clefRoutingStatusMessage(status).detail))
  })

  it('explains every reason a report cannot be pinned', () => {
    expectPlainEnglish(CLEF_PROFILE_PROBLEMS.map(clefProfileProblemMessage))
  })

  it('explains every blocker reason and detail of a failed call', () => {
    expectPlainEnglish(
      ROUTE_BLOCKER_REASONS.map(
        (reason) => clefBlockerMessage({ reason, detail: 'not_configured' }).reason
      )
    )
    expectPlainEnglish(
      ROUTE_BLOCKER_DETAILS.map(
        (detail) => clefBlockerMessage({ reason: 'classifier_unavailable', detail }).detail
      )
    )
  })

  it('explains every refusal of Verify and Pin without repeating raw error text', () => {
    const messages = VERIFIER_ERROR_CODES.map((code) =>
      clefVerificationCallErrorMessage(rpcError(code))
    )

    expectPlainEnglish(messages)
    expect(messages.join(' ')).not.toContain('raw text')
    expect(clefVerificationCallErrorMessage(new Error('leaky'))).not.toContain('leaky')
  })

  // Why: D-022 shows no Clef budget or cost, so no message may warn about money.
  it('never speaks of a budget, a spend cap or a cost', () => {
    const messages = [
      ...ROUTING_STATUSES.flatMap((status) => {
        const message = clefRoutingStatusMessage(status)
        return [message.label, message.detail]
      }),
      ...ROUTE_BLOCKER_DETAILS.map(
        (detail) => clefBlockerMessage({ reason: 'classifier_unavailable', detail }).detail
      ),
      ...VERIFIER_ERROR_CODES.map((code) => clefVerificationCallErrorMessage(rpcError(code))),
      ...['workbench_clef_budget_unset', 'workbench_clef_verification_cap_reached'].map((code) =>
        clefVerificationCallErrorMessage(rpcError(code))
      )
    ]
    for (const message of messages) {
      expect(message).not.toMatch(/budget|spend cap|cost|priced|\$/i)
    }
    expect(Object.keys(messagesModule)).not.toContain('formatMicroUsd')
  })
})
