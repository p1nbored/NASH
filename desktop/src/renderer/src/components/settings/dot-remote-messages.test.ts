import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import {
  type DotRemoteReconnectReason,
  DOT_REMOTE_CONNECTION_STATES,
  DOT_REMOTE_PAIR_AGAIN_REASONS,
  DOT_REMOTE_PAIRING_STATES,
  DOT_REMOTE_RECONNECT_REASONS,
  DOT_REMOTE_RPC_ERROR_CODES,
  DOT_REMOTE_TOKEN_PROTECTIONS,
  DOT_REMOTE_TOKEN_RECONNECT_REASONS
} from '../../../../shared/rpc-contract/workbench-dot-remote-params'
import {
  FIXTURE_REMOTE_ORIGIN,
  FIXTURE_REMOTE_TOKEN,
  fixtureConnectedRemoteStatus,
  fixtureRemoteStatus
} from './dot-remote-access.test-fixture'
import { dotRemoteCallErrorMessage } from './dot-remote-refusal-messages'
import {
  dotRemotePairedLine,
  dotRemotePairingEndMessage,
  dotRemotePill,
  dotRemoteReconnectMessage,
  dotRemoteStateDetail,
  dotRemoteTokenProtectionMessage
} from './dot-remote-status-messages'

const RAW = `raw server text ${FIXTURE_REMOTE_TOKEN} OAI-Sites-Authorization ${FIXTURE_REMOTE_ORIGIN}`

function refusal(code: string, data?: unknown): RuntimeRpcCallError {
  return new RuntimeRpcCallError({ id: 't', ok: false, error: { code, message: RAW, data } })
}

/** A sentence a person reads: capitalized, ended, and free of codes, tokens and headers. */
function expectPlainEnglish(message: string): void {
  expect(message).toMatch(/^[A-Z].*[.]$/)
  expect(message).not.toMatch(/_/)
  expect(message).not.toContain('raw server text')
  expect(message).not.toContain(FIXTURE_REMOTE_TOKEN)
  expect(message).not.toContain('OAI-Sites')
}

describe('remote access status messages', () => {
  it('gives every connection state its own pill and plain-English detail', () => {
    const labels = new Set<string>()
    const reasonOf: Record<'reconnect_needed' | 'pair_again', DotRemoteReconnectReason> = {
      reconnect_needed: 'service_token_rejected',
      pair_again: 'session_ended'
    }
    for (const state of DOT_REMOTE_CONNECTION_STATES) {
      const status = fixtureRemoteStatus({
        state,
        enabled: state !== 'off',
        reconnectReason:
          state === 'reconnect_needed' || state === 'pair_again' ? reasonOf[state] : null
      })
      const pill = dotRemotePill(status)
      expect(pill.label).not.toMatch(/_/)
      labels.add(pill.label)
      expectPlainEnglish(dotRemoteStateDetail(status))
    }
    expect(labels.size).toBe(DOT_REMOTE_CONNECTION_STATES.length)
    expect(dotRemotePill(null)).toEqual({ label: 'Unavailable', tone: 'warning' })
    expect(dotRemotePill(fixtureRemoteStatus({ state: 'connected', enabled: true })).tone).toBe(
      'success'
    )
  })

  it('never claims that dot itself is connected', () => {
    const detail = dotRemoteStateDetail(fixtureRemoteStatus({ state: 'connected', enabled: true }))
    expect(detail).toMatch(/cannot tell whether dot is connected/)
  })

  it('does not claim a failed contact while offline, which also covers waiting to refresh', () => {
    const detail = dotRemoteStateDetail(fixtureRemoteStatus({ state: 'offline', enabled: true }))
    expect(detail).toMatch(/keeps trying/)
    expect(detail).not.toMatch(/could not be reached/)
  })

  it('explains every stop reason differently and says what resumes it', () => {
    const messages = DOT_REMOTE_RECONNECT_REASONS.map(dotRemoteReconnectMessage)
    messages.forEach(expectPlainEnglish)
    expect(new Set(messages).size).toBe(messages.length)
    for (const reason of DOT_REMOTE_TOKEN_RECONNECT_REASONS) {
      expect(dotRemoteReconnectMessage(reason)).toMatch(/Paste/)
    }
    for (const reason of DOT_REMOTE_PAIR_AGAIN_REASONS) {
      expect(dotRemoteReconnectMessage(reason)).toMatch(/Pair again/)
    }
    expect(dotRemoteReconnectMessage('pairing_expired')).toMatch(/lifetime/)
  })

  it('shows how long a pairing lasts when the Site says', () => {
    const status = fixtureConnectedRemoteStatus()
    expect(dotRemotePairedLine(status.pairing)).toMatch(/^Paired until .+\. Approved on .+\.$/)
    const open = dotRemotePairedLine(
      status.pairing ? { ...status.pairing, pairedUntil: null } : null
    )
    expect(open).toMatch(/^Paired on .+\.$/)
    expect(open).not.toMatch(/until/)
    expect(dotRemotePairedLine(null)).toBeNull()
  })

  it('shows only "Token saved" for a sealed token and explains the refused protections', () => {
    expect(dotRemoteTokenProtectionMessage('sealed')).toBe('Token saved')
    expect(dotRemoteTokenProtectionMessage('absent')).toBeNull()
    const refused = DOT_REMOTE_TOKEN_PROTECTIONS.filter(
      (protection) => protection !== 'sealed' && protection !== 'absent'
    ).map((protection) => dotRemoteTokenProtectionMessage(protection) ?? '')
    refused.forEach(expectPlainEnglish)
    expect(new Set(refused).size).toBe(refused.length)
  })

  it('explains how each pairing ended and says nothing while it is idle or waiting', () => {
    expect(dotRemotePairingEndMessage('idle')).toBeNull()
    expect(dotRemotePairingEndMessage('waiting_for_approval')).toBeNull()
    const ended = DOT_REMOTE_PAIRING_STATES.filter(
      (state) => state !== 'idle' && state !== 'waiting_for_approval'
    ).map((state) => dotRemotePairingEndMessage(state) ?? '')
    ended.forEach(expectPlainEnglish)
    expect(new Set(ended).size).toBe(ended.length)
    expect(dotRemotePairingEndMessage('expired')).toMatch(/expired/)
  })
})

describe('remote access refusal messages', () => {
  it('gives every remote access error code its own plain-English message', () => {
    const codes = Object.values(DOT_REMOTE_RPC_ERROR_CODES)
    const messages = codes.map((code) => dotRemoteCallErrorMessage(refusal(code)))
    messages.forEach(expectPlainEnglish)
    expect(new Set(messages).size).toBe(codes.length)
  })

  it('explains each token shape refusal from its reason only', () => {
    const reasons = [
      'token_missing',
      'token_too_short',
      'token_too_long',
      'token_invalid_characters'
    ]
    const messages = reasons.map((reason) =>
      dotRemoteCallErrorMessage(refusal(DOT_REMOTE_RPC_ERROR_CODES.tokenInvalid, { reason }))
    )
    messages.forEach(expectPlainEnglish)
    expect(new Set(messages).size).toBe(reasons.length)
    expect(
      dotRemoteCallErrorMessage(
        refusal(DOT_REMOTE_RPC_ERROR_CODES.tokenInvalid, { reason: 'something_new' })
      )
    ).toBe(dotRemoteCallErrorMessage(refusal(DOT_REMOTE_RPC_ERROR_CODES.tokenInvalid)))
  })

  it('covers the caller, registration, value and response failures too', () => {
    const other = [
      refusal('method_not_found'),
      refusal('workbench_forbidden'),
      refusal('invalid_argument'),
      new z.ZodError([]),
      refusal('some_future_code'),
      new Error(RAW)
    ].map(dotRemoteCallErrorMessage)
    other.forEach(expectPlainEnglish)
    expect(new Set(other).size).toBe(other.length - 1)
    expect(other[0]).toMatch(/not connected in this build/)
  })
})
