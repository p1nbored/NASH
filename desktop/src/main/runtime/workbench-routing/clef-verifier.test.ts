import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClefVerifyResultSchema } from '../../../shared/clef/clef-verification-view'
import { getClefCallCircuit } from '../../clef/clef-call-circuit-owner'
import { clefInputCostMicroUsd } from '../../clef/clef-spend-ledger'
import { buildClefVerificationReport } from '../../clef/clef-verification-report'
import { clefVerificationReportSha256 } from '../../clef/clef-verified-profile'
import { buildClefVerificationRequest } from './clef-verification-request'
import { createVerifierHarness, type VerifierHarness } from './clef-verifier.test-fixture'
import {
  transportBlocked,
  transportHangingUntilAborted,
  transportHeldUntilReleased,
  transportResponseBytes
} from './clef-scripted-transport.test-fixture'
import { FIXTURE_ONLY_INPUT_TOKENS } from '../../clef/fixtures/synthetic-clef-responses.test-fixture'
import {
  FIXTURE_ONLY_ACCOUNT_ID,
  FIXTURE_ONLY_BEARER,
  fixtureClefResponseBytes
} from './workbench-routing.test-fixture'

let active: VerifierHarness | null = null

function setup(options: Parameters<typeof createVerifierHarness>[0] = {}): VerifierHarness {
  active = createVerifierHarness(options)
  return active
}

afterEach(() => {
  active?.close()
  active = null
})

const { request: VERIFICATION_REQUEST, sent: SENT } = buildClefVerificationRequest()
const OK_BYTES = fixtureClefResponseBytes(VERIFICATION_REQUEST.bodyBytes)

describe('verify: the one billed call', () => {
  it('reports the redacted structure of the answer with its hash, and no cost or spend', async () => {
    const { verifier, harness } = setup()
    const result = await verifier.verify()
    const expected = buildClefVerificationReport({ status: 200, bytes: OK_BYTES }, SENT)
    expect(result).toMatchObject({
      outcome: 'reported',
      reportSha256: clefVerificationReportSha256(expected),
      pin: { pinnable: true, problems: [] }
    })
    if (result.outcome !== 'reported') {
      return
    }
    expect(result.report).toMatchObject({
      httpStatus: 200,
      optionIdEcho: 'exact',
      model: { observed: '@cf/cloudflare/clef' }
    })
    expect(ClefVerifyResultSchema.safeParse(result).success).toBe(true)
    // Why: D-022 shows no cost; the ledger still records what the call spent.
    expect(Object.keys(result)).not.toContain('cost')
    expect(Object.keys(result)).not.toContain('spend')
    expect(Number(harness.spendRows()[0]?.spent_micro_usd)).toBe(
      clefInputCostMicroUsd(FIXTURE_ONLY_INPUT_TOKENS)
    )
    expect(harness.transport).toHaveBeenCalledTimes(1)
  })

  it('reserves through the ledger as one verification attempt that belongs to no request', async () => {
    const { verifier, harness } = setup()
    await verifier.verify()
    const rows = harness.spendRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      request_id: null,
      purpose: 'verification',
      attempt: null,
      state: 'settled',
      input_tokens: FIXTURE_ONLY_INPUT_TOKENS
    })
    // Why: verification spend never draws on the production daily neuron cap.
    expect(harness.ledger.snapshot().dailyNeuronsSpent).toBe(0)
  })

  it('sends exactly the verification body once, with the sealed handle and a single-attempt budget', async () => {
    const { verifier, harness } = setup()
    await verifier.verify()
    const [sentRequest] = harness.transport.mock.calls[0] ?? []
    expect(sentRequest?.body).toEqual(VERIFICATION_REQUEST.bodyBytes)
    expect(sentRequest?.credentials).toBe(harness.credentials.read())
    expect(sentRequest?.maxAttempts).toBe(1)
    expect(typeof sentRequest?.beforeAttempt).toBe('function')
    expect(sentRequest?.signal).toBeInstanceOf(AbortSignal)
  })

  it('teaches the call circuit that Clef answered', async () => {
    const { verifier, harness } = setup()
    getClefCallCircuit().record('transient_exhausted', harness.credentials.generation())
    expect(
      getClefCallCircuit().snapshot(harness.credentials.generation()).consecutiveTransient
    ).toBe(1)
    await verifier.verify()
    expect(
      getClefCallCircuit().snapshot(harness.credentials.generation()).consecutiveTransient
    ).toBe(0)
  })

  it('never lets a token, account id or URL reach its result', async () => {
    const { verifier } = setup()
    const text = JSON.stringify(await verifier.verify())
    expect(text).not.toContain(FIXTURE_ONLY_ACCOUNT_ID)
    expect(text).not.toContain(FIXTURE_ONLY_BEARER.replace('Bearer ', ''))
    expect(text).not.toMatch(/https?:\/\//)
  })

  it('reports an answer that cannot be pinned with the reasons, and keeps the whole reservation', async () => {
    const { verifier, harness } = setup()
    harness.transport.mockImplementation(
      transportResponseBytes(new TextEncoder().encode('not json'))
    )
    const result = await verifier.verify()
    expect(result).toMatchObject({ outcome: 'reported', pin: { pinnable: false } })
    if (result.outcome !== 'reported') {
      return
    }
    expect(result.pin.problems).toContain('envelope_unrecognized')
    expect(harness.spendRows()[0]).toMatchObject({ purpose: 'verification', state: 'kept' })
  })
})

describe('verify: refusals before any call', () => {
  const refused = (v: VerifierHarness) => {
    expect(v.harness.transport).not.toHaveBeenCalled()
    expect(v.harness.spendRows()).toEqual([])
  }

  it.each([
    ['nothing saved', { tokenPresent: false, accountPresent: false, protection: 'absent' }],
    ['only the token saved', { tokenPresent: true, accountPresent: false, protection: 'sealed' }]
  ] as const)(
    'fails closed with a clear code when credentials are missing: %s',
    async (_label, status) => {
      const v = setup()
      v.harness.credentials.setStatus(status)
      await expect(v.verifier.verify()).rejects.toMatchObject({
        code: 'workbench_clef_credentials_missing'
      })
      refused(v)
    }
  )

  it('fails closed when the sealed handle cannot be read', async () => {
    const v = setup()
    v.harness.credentials.setHandle(null)
    await expect(v.verifier.verify()).rejects.toMatchObject({
      code: 'workbench_clef_credentials_missing'
    })
    refused(v)
  })

  it.each(['plaintext_refused', 'sealing_unavailable'] as const)(
    'refuses credentials that are not sealed: %s',
    async (protection) => {
      const v = setup()
      v.harness.credentials.setStatus({ tokenPresent: true, accountPresent: true, protection })
      await expect(v.verifier.verify()).rejects.toMatchObject({
        code: 'workbench_clef_credentials_unsealed'
      })
      refused(v)
    }
  )

  it('runs whatever was spent before: no budget, cap or cost check (D-022)', async () => {
    const v = setup()
    for (let index = 0; index < 20; index += 1) {
      const seeded = v.harness.routes.spend.atomically(() =>
        v.harness.ledger.reserve({
          requestId: null,
          purpose: index % 2 === 0 ? 'test' : 'verification',
          estimatedInputTokens: 1_000_000
        })
      )
      expect(seeded.ok).toBe(true)
    }
    expect(v.harness.ledger.snapshot().verificationMicroUsdSpent).toBeGreaterThan(5_000_000)
    expect((await v.verifier.verify()).outcome).toBe('reported')
    expect(v.harness.transport).toHaveBeenCalledTimes(1)
  })

  it('refuses while an auth latch, a quota latch or an open circuit holds', async () => {
    const circuitCases = [
      ['auth_failed', 'workbench_clef_auth_failed'],
      ['quota_latched', 'workbench_clef_quota_latched']
    ] as const
    for (const [outcome, code] of circuitCases) {
      const v = setup()
      getClefCallCircuit().record(outcome, v.harness.credentials.generation())
      await expect(v.verifier.verify()).rejects.toMatchObject({ code })
      refused(v)
      v.close()
      active = null
    }
    const v = setup()
    for (let strike = 0; strike < 3; strike += 1) {
      getClefCallCircuit().record('transient_exhausted', v.harness.credentials.generation())
    }
    await expect(v.verifier.verify()).rejects.toMatchObject({ code: 'workbench_clef_circuit_open' })
    refused(v)
  })
})

describe('verify: calls that end without a report', () => {
  it('reports a rejected credential, keeps the reservation and latches the credentials', async () => {
    const v = setup()
    v.harness.transport.mockImplementation(
      transportBlocked(
        { reason: 'classifier_unavailable', detail: 'auth_or_account' },
        'http_status',
        {
          latch: 'auth_failed',
          status: 401
        }
      )
    )
    const result = await v.verifier.verify()
    expect(result).toMatchObject({
      outcome: 'call_failed',
      blocker: { reason: 'classifier_unavailable', detail: 'auth_or_account' },
      httpStatus: 401,
      attempts: 1
    })
    expect(v.harness.spendRows()[0]).toMatchObject({ purpose: 'verification', state: 'kept' })
    expect(getClefCallCircuit().snapshot(v.harness.credentials.generation()).authFailed).toBe(true)
  })

  it('reports a transient failure without retrying the paid call', async () => {
    const v = setup()
    v.harness.transport.mockImplementation(
      transportBlocked(
        { reason: 'classifier_unavailable', detail: 'transient_exhausted' },
        'network'
      )
    )
    const result = await v.verifier.verify()
    expect(result).toMatchObject({ outcome: 'call_failed', httpStatus: null, attempts: 1 })
    expect(v.harness.transport).toHaveBeenCalledTimes(1)
    expect(v.harness.spendRows()).toHaveLength(1)
  })

  it('ends as interrupted when shutdown aborts the call, and allows a later verification', async () => {
    const v = setup()
    let inFlight: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      inFlight = resolve
    })
    v.harness.transport.mockImplementation(transportHangingUntilAborted(inFlight))
    const pending = v.verifier.verify()
    await started
    expect(v.harness.aborts.abortAll()).toBe(1)
    expect(await pending).toMatchObject({
      outcome: 'call_failed',
      blocker: { reason: 'classifier_unavailable', detail: 'interrupted' },
      httpStatus: null
    })
    expect(v.harness.spendRows()[0]).toMatchObject({ purpose: 'verification', state: 'kept' })
    v.harness.transport.mockImplementation(transportResponseBytes(OK_BYTES))
    expect((await v.verifier.verify()).outcome).toBe('reported')
  })

  it('refuses a second verification while one is in flight and reserves only once', async () => {
    const v = setup()
    const held = transportHeldUntilReleased()
    v.harness.transport.mockImplementation(held.transport)
    const gate = vi.spyOn(getClefCallCircuit(), 'gate')
    const first = v.verifier.verify()
    await held.inFlight
    await expect(v.verifier.verify()).rejects.toMatchObject({
      code: 'workbench_clef_verification_in_progress'
    })
    // Why: the refused click must not consult the circuit, which a real gate call can half-open.
    expect(gate).toHaveBeenCalledTimes(1)
    held.release()
    expect((await first).outcome).toBe('reported')
    expect(v.harness.spendRows()).toHaveLength(1)
  })
})
