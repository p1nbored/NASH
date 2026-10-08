import { describe, expect, it } from 'vitest'
import { DOT_INGRESS_CONTRACT_VERSION } from './dot-ingress-limits'
import {
  DOT_INGRESS_METHOD_NAMES,
  DOT_UNSUPPORTED_CONTRACT_VERSION_MESSAGE,
  dotMethodsServed,
  isServedContractVersion
} from './dot-ingress-versions'

describe('dot ingress current contract', () => {
  it('serves only version 3', () => {
    expect(DOT_INGRESS_CONTRACT_VERSION).toBe(3)
    expect(isServedContractVersion(3)).toBe(true)
    for (const other of [0, 1, 2, 4, '3', null, undefined]) {
      expect(isServedContractVersion(other)).toBe(false)
    }
    expect(DOT_UNSUPPORTED_CONTRACT_VERSION_MESSAGE).toBe(
      'Unsupported contract version. Supported versions: 3.'
    )
  })

  it('advertises only registered methods of the closed surface', () => {
    expect(dotMethodsServed([...DOT_INGRESS_METHOD_NAMES])).toEqual([...DOT_INGRESS_METHOD_NAMES])
    expect(dotMethodsServed(['dotIngress.hello', 'other.method'])).toEqual(['dotIngress.hello'])
    expect(DOT_INGRESS_METHOD_NAMES).toContain('dotIngress.validations.decide')
  })
})
