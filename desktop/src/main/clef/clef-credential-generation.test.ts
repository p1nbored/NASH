import { inspect } from 'node:util'
import { describe, expect, it } from 'vitest'
import { ClefCredentialGeneration } from './clef-credential-generation'

describe('ClefCredentialGeneration', () => {
  it('mints values no other generation equals', () => {
    const first = ClefCredentialGeneration.mint()
    const second = ClefCredentialGeneration.mint()
    expect(first.equals(first)).toBe(true)
    expect(first.equals(second)).toBe(false)
    expect(second.equals(first)).toBe(false)
  })

  it('never equals a value that is not a minted generation', () => {
    const generation = ClefCredentialGeneration.mint()
    for (const forged of [
      undefined,
      null,
      0,
      1,
      '1',
      'credentials-generation-1',
      {},
      { serial: 1 }
    ]) {
      expect(generation.equals(forged)).toBe(false)
    }
  })

  it('exposes nothing a log, snapshot or serializer could carry', () => {
    const generation = ClefCredentialGeneration.mint()
    expect(Object.keys(generation)).toEqual([])
    expect(JSON.stringify(generation)).toBe('{}')
    expect(inspect(generation, { depth: 10 })).toBe('ClefCredentialGeneration {}')
    expect(String(generation)).toBe('[object Object]')
  })

  it('has no public constructor, so a caller cannot choose its value', () => {
    const construct = (): unknown =>
      // @ts-expect-error -- the constructor is private; only mint() creates generations.
      new ClefCredentialGeneration(1)
    expect(typeof construct).toBe('function')
  })
})
