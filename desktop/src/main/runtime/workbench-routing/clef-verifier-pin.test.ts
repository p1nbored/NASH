import { afterEach, describe, expect, it } from 'vitest'
import { ClefProfilePinResultSchema } from '../../../shared/clef/clef-verification-view'
import { CLEF_SCHEMA_PINS } from '../../clef/clef-schema-pins'
import { buildClefVerificationReport } from '../../clef/clef-verification-report'
import {
  clefVerificationReportSha256,
  clefVerifiedProfileFromReport,
  clefVerifiedProfileHash
} from '../../clef/clef-verified-profile'
import { buildClefVerificationRequest } from './clef-verification-request'
import { createVerifierHarness, type VerifierHarness } from './clef-verifier.test-fixture'
import { transportBlocked, transportResponseBytes } from './clef-scripted-transport.test-fixture'
import { fixtureClefResponseBytes } from './workbench-routing.test-fixture'

let active: VerifierHarness | null = null

function setup(): VerifierHarness {
  active = createVerifierHarness()
  return active
}

afterEach(() => {
  active?.close()
  active = null
})

const { request, sent } = buildClefVerificationRequest()
const OK_BYTES = fixtureClefResponseBytes(request.bodyBytes)
const EXPECTED_REPORT = buildClefVerificationReport({ status: 200, bytes: OK_BYTES }, sent)
const OK_SHA = clefVerificationReportSha256(EXPECTED_REPORT)

async function verified(v: VerifierHarness): Promise<string> {
  const result = await v.verifier.verify()
  if (result.outcome !== 'reported') {
    throw new Error('the fixture verification must produce a report')
  }
  return result.reportSha256
}

describe('pin: the report the user confirmed', () => {
  it('writes the profile derived from exactly the confirmed report', async () => {
    const v = setup()
    const sha = await verified(v)
    expect(sha).toBe(OK_SHA)

    const result = v.verifier.pin(sha)

    const expected = clefVerifiedProfileFromReport(EXPECTED_REPORT, {
      verifiedAt: new Date(v.harness.clock.ms).toISOString(),
      schemaPins: CLEF_SCHEMA_PINS
    })
    expect(expected.ok).toBe(true)
    if (!expected.ok) {
      return
    }
    expect(v.writeProfile).toHaveBeenCalledTimes(1)
    expect(v.writes[0]).toEqual(expected.profile)
    expect(v.writes[0]?.reportSha256).toBe(sha)
    expect(v.writes[0]?.schemaPins).toEqual(CLEF_SCHEMA_PINS)
    expect(v.writes[0]?.expectedResponseModel).toBe('@cf/cloudflare/clef')
    expect(result).toEqual({
      pinned: true,
      profileHash: clefVerifiedProfileHash(expected.profile),
      verifiedAt: new Date(v.harness.clock.ms).toISOString(),
      routingStatus: 'ready'
    })
    expect(ClefProfilePinResultSchema.safeParse(result).success).toBe(true)
  })

  it('reports the routing status the gates see after the write', async () => {
    const v = setup()
    v.setRoutingStatus('quota_latched')
    expect(v.verifier.pin(await verified(v)).routingStatus).toBe('quota_latched')
  })

  it('makes no call and no reservation of its own', async () => {
    const v = setup()
    const sha = await verified(v)
    const rowsBefore = v.harness.spendRows().length
    v.verifier.pin(sha)
    expect(v.harness.transport).toHaveBeenCalledTimes(1)
    expect(v.harness.spendRows()).toHaveLength(rowsBefore)
  })

  it('is single use: the confirmed report cannot pin a second time', async () => {
    const v = setup()
    const sha = await verified(v)
    v.verifier.pin(sha)
    expect(() => v.verifier.pin(sha)).toThrowError(
      expect.objectContaining({ code: 'workbench_clef_report_unconfirmed' })
    )
    expect(v.writeProfile).toHaveBeenCalledTimes(1)
  })
})

describe('pin: refusals write nothing', () => {
  it('refuses when no verification has run', () => {
    const v = setup()
    expect(() => v.verifier.pin(OK_SHA)).toThrowError(
      expect.objectContaining({ code: 'workbench_clef_report_unconfirmed' })
    )
    expect(v.writeProfile).not.toHaveBeenCalled()
  })

  it.each(['0'.repeat(64), 'f'.repeat(64), 'not a hash', ''])(
    'refuses a hash that is not the held report: %j',
    async (hash) => {
      const v = setup()
      await verified(v)
      expect(() => v.verifier.pin(hash)).toThrowError(
        expect.objectContaining({ code: 'workbench_clef_report_unconfirmed' })
      )
      expect(v.writeProfile).not.toHaveBeenCalled()
    }
  )

  it('refuses the hash of an earlier report once a newer verification has run', async () => {
    const v = setup()
    const first = await verified(v)
    v.harness.transport.mockImplementation(
      transportBlocked(
        { reason: 'classifier_unavailable', detail: 'transient_exhausted' },
        'network'
      )
    )
    expect((await v.verifier.verify()).outcome).toBe('call_failed')
    expect(() => v.verifier.pin(first)).toThrowError(
      expect.objectContaining({ code: 'workbench_clef_report_unconfirmed' })
    )
    expect(v.writeProfile).not.toHaveBeenCalled()
  })

  it('refuses a report with problems and names them', async () => {
    const v = setup()
    v.harness.transport.mockImplementation(
      transportResponseBytes(new TextEncoder().encode('{"unexpected":true}'))
    )
    const result = await v.verifier.verify()
    if (result.outcome !== 'reported') {
      throw new Error('a 200 answer must produce a report')
    }
    expect(result.pin.pinnable).toBe(false)
    expect(() => v.verifier.pin(result.reportSha256)).toThrowError(
      expect.objectContaining({
        code: 'workbench_clef_report_not_pinnable',
        message: expect.stringContaining('envelope_unrecognized')
      })
    )
    expect(v.writeProfile).not.toHaveBeenCalled()
  })

  it('refuses a report that names the flash variant as its model', async () => {
    const v = setup()
    const flash = new TextEncoder().encode(
      new TextDecoder().decode(OK_BYTES).replace('@cf/cloudflare/clef', 'clef-flash')
    )
    v.harness.transport.mockImplementation(transportResponseBytes(flash))
    const result = await v.verifier.verify()
    if (result.outcome !== 'reported') {
      throw new Error('a 200 answer must produce a report')
    }
    expect(result.pin.problems).toContain('response_model_disallowed')
    expect(() => v.verifier.pin(result.reportSha256)).toThrowError(
      expect.objectContaining({ code: 'workbench_clef_report_not_pinnable' })
    )
    expect(v.writes).toEqual([])
  })
})

describe('pin: a failed write', () => {
  it('reports a generic code, never the file error, and keeps the report pinnable', async () => {
    const v = setup()
    const sha = await verified(v)
    const diskError = new Error('EBUSY: resource busy, rename C:\\Users\\fixture\\profile.json')
    v.writeProfile.mockImplementationOnce(() => {
      throw diskError
    })
    expect(() => v.verifier.pin(sha)).toThrowError(
      expect.objectContaining({
        code: 'workbench_clef_profile_write_failed',
        message: 'The verified profile could not be written.'
      })
    )
    expect(v.failures).toEqual([diskError])
    expect(v.verifier.pin(sha).pinned).toBe(true)
  })
})
