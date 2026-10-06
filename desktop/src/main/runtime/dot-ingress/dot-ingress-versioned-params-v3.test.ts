import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DOT_INGRESS_ERROR_MESSAGES } from '../../../shared/dot-ingress/dot-ingress-errors'
import { dotIngressErrorMessageV3 } from '../../../shared/dot-ingress/dot-ingress-errors-v3'
import { errorResponse } from '../rpc/errors'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { sanitizeDotIngressResponse } from './dot-ingress-admission'
import { dotRefusal } from './dot-ingress-refusals'
import {
  dotErrorForVersion,
  parseDotCall,
  parseDotCallFromV2,
  parseDotCallFromV3
} from './dot-ingress-versioned-params'

const v = (version: number) => z.object({ contractVersion: z.literal(version) }).strict()
const SCHEMAS = { v1: v(1), v2: v(2), v3: v(3) }

function refusalOf(run: () => unknown): OrchestrationError | null {
  try {
    run()
    return null
  } catch (error) {
    if (error instanceof OrchestrationError) {
      return error
    }
    throw error
  }
}

describe('dot calls of contract version 3', () => {
  it('parses each served version with its own strict schema', () => {
    for (const version of [1, 2, 3] as const) {
      expect(parseDotCall({ contractVersion: version }, SCHEMAS)).toEqual({
        version,
        params: { contractVersion: version }
      })
    }
    const refused = refusalOf(() => parseDotCall({ contractVersion: 4 }, SCHEMAS))
    expect(refused).toMatchObject({
      code: 'dot_unsupported_contract_version',
      message: 'Unsupported contract version. Supported versions: 1, 2, 3.',
      data: { supportedContractVersions: [1, 2, 3] }
    })
  })

  it('serves a version 2 method to versions 2 and 3, and tells version 1 what it needs', () => {
    const schemas = { v2: SCHEMAS.v2, v3: SCHEMAS.v3 }
    expect(
      parseDotCallFromV2('dotIngress.requests.message', { contractVersion: 3 }, schemas)
    ).toEqual({ version: 3, params: { contractVersion: 3 } })
    expect(
      refusalOf(() =>
        parseDotCallFromV2('dotIngress.requests.message', { contractVersion: 1 }, schemas)
      )?.message
    ).toBe('This method needs contract version 2 or later.')
  })

  it('serves a version 3 method to version 3 only', () => {
    expect(
      parseDotCallFromV3('dotIngress.validations.decide', { contractVersion: 3 }, SCHEMAS.v3)
    ).toEqual({ version: 3, params: { contractVersion: 3 } })
    for (const version of [1, 2]) {
      const refused = refusalOf(() =>
        parseDotCallFromV3('dotIngress.validations.list', { contractVersion: version }, SCHEMAS.v3)
      )
      expect(refused).toMatchObject({
        code: 'dot_unsupported_contract_version',
        message: 'This method needs contract version 3 or later.'
      })
    }
  })

  it('never gives a version 1 or 2 caller the version 3 code', () => {
    const thrown = dotRefusal('dot_validation_not_found', { reason: 'fixture' })
    expect(thrown.message).toBe('The validation decision was not found.')
    for (const version of [1, 2]) {
      expect(dotErrorForVersion(version, thrown)).toMatchObject({
        code: 'dot_request_not_found',
        message: DOT_INGRESS_ERROR_MESSAGES.dot_request_not_found,
        data: { reason: 'fixture' }
      })
    }
    expect(dotErrorForVersion(3, thrown)).toBe(thrown)
    const v2Only = dotRefusal('dot_request_busy')
    expect(dotErrorForVersion(2, v2Only)).toBe(v2Only)
    expect(dotErrorForVersion(3, v2Only)).toBe(v2Only)
    expect(dotErrorForVersion(1, v2Only)).toMatchObject({ code: 'dot_request_not_cancelable' })
  })

  it('lets the ingress sanitizer pass the version 3 code with its data', () => {
    const response = errorResponse(
      'req-1',
      { runtimeId: 'runtime-fixture-1' },
      'dot_validation_not_found',
      dotIngressErrorMessageV3('dot_validation_not_found'),
      { reason: 'fixture' }
    )
    expect(sanitizeDotIngressResponse(response)).toEqual(response)
  })
})
