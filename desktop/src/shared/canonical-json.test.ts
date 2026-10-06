import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalAgentSessionDigest } from './agent-session-mutation-envelope'
import { canonicalJson } from './canonical-json'

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

describe('canonicalJson', () => {
  it('serializes keys in sorted order at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}'
    )
  })

  it('sorts integer-like keys as strings and drops undefined fields', () => {
    expect(canonicalJson({ '9': 2, '10': 1, b: undefined })).toBe('{"10":1,"9":2}')
  })

  it('orders mixed-case and non-ASCII keys by code unit', () => {
    expect(canonicalJson({ a: 1, A: 2, é: 3, 中: 4 })).toBe('{"A":2,"a":1,"é":3,"中":4}')
  })

  it('writes undefined and NaN as null inside arrays', () => {
    expect(canonicalJson([undefined, Number.NaN, Infinity])).toBe('[null,null,null]')
  })

  it('writes undefined at the top level as null', () => {
    expect(canonicalJson(undefined)).toBe('null')
  })

  it('writes negative zero as zero and keeps empty containers', () => {
    expect(canonicalJson({ zero: -0, empty: {}, none: [] })).toBe('{"empty":{},"none":[],"zero":0}')
  })

  it('serializes a Date as an empty object because toJSON is not consulted', () => {
    expect(canonicalJson(new Date(0))).toBe('{}')
  })

  it('escapes a lone surrogate the way JSON.stringify does', () => {
    expect(canonicalJson('\ud800')).toBe('"\\ud800"')
  })

  it('does not mutate the input or depend on its key order', () => {
    const input = { b: [{ z: 1, y: 2 }], a: 1 }
    const before = JSON.stringify(input)
    expect(canonicalJson(input)).toBe(canonicalJson({ a: 1, b: [{ y: 2, z: 1 }] }))
    expect(JSON.stringify(input)).toBe(before)
  })

  it('throws on a cycle and on a bigint rather than returning a partial text', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => canonicalJson(cyclic)).toThrow(RangeError)
    expect(() => canonicalJson({ big: 1n })).toThrow(TypeError)
  })

  it('hashes to the same digest as the agent session wire digest', () => {
    const inputs: Record<string, unknown>[] = [
      { b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } },
      { '9': 2, '10': 1, b: undefined },
      { a: 1, A: 2, é: 3, 中: 4 },
      { list: [undefined, Number.NaN, -0, 'quote"slash\\line\n'], flag: true, none: null }
    ]
    for (const input of inputs) {
      expect(sha256Hex(canonicalJson(input))).toBe(canonicalAgentSessionDigest(input))
    }
  })
})
