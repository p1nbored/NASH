import { describe, expect, it } from 'vitest'
import { DotHelloParams } from '../../../shared/dot-ingress/dot-ingress-params'
import { parseDotCall } from './dot-ingress-versioned-params'

describe('dot ingress current call params', () => {
  it('parses only the supported contract and still rejects extra fields', () => {
    expect(parseDotCall({ contractVersion: 3 }, DotHelloParams)).toEqual({ contractVersion: 3 })
    for (const contractVersion of [1, 2, 4]) {
      expect(() => parseDotCall({ contractVersion }, DotHelloParams)).toThrow(
        'Unsupported contract version. Supported versions: 3.'
      )
    }
    expect(() => parseDotCall({ contractVersion: 3, extra: true }, DotHelloParams)).toThrow()
  })
})
