import { describe, expect, it } from 'vitest'
import {
  MAX_TIMER_MS,
  OptionError,
  isPlainRecord,
  readOptionRecord,
  readPositiveCount
} from './option-limits'

describe('readPositiveCount', () => {
  it('keeps the fallback for an absent value', () => {
    expect(readPositiveCount('timeoutMs', undefined, 42)).toBe(42)
  })

  it.each([1, 1000, MAX_TIMER_MS])('accepts %d', (value) => {
    expect(readPositiveCount('timeoutMs', value, 5)).toBe(value)
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['infinite', Infinity],
    ['above the timer maximum', MAX_TIMER_MS + 1],
    ['a numeric string', '5'],
    ['null', null],
    ['an object', {}]
  ])('refuses %s with the option name in the message', (_label, value) => {
    expect(() => readPositiveCount('graceMs', value, 5)).toThrow(OptionError)
    expect(() => readPositiveCount('graceMs', value, 5)).toThrow(/graceMs/)
  })

  it('keeps the timer ceiling at the largest delay setTimeout can hold', () => {
    expect(MAX_TIMER_MS).toBe(2_147_483_647)
  })
})

describe('readOptionRecord', () => {
  it('returns an empty record for an absent value and the record otherwise', () => {
    expect(readOptionRecord('limits', undefined)).toEqual({})
    expect(readOptionRecord('limits', { a: 1 })).toEqual({ a: 1 })
  })

  it.each([null, 5, 'text', [], true])('refuses %j', (value) => {
    expect(() => readOptionRecord('limits', value)).toThrow(/limits must be an object/)
  })
})

describe('isPlainRecord', () => {
  it('accepts objects and refuses arrays, null and primitives', () => {
    expect(isPlainRecord({})).toBe(true)
    expect(isPlainRecord([])).toBe(false)
    expect(isPlainRecord(null)).toBe(false)
    expect(isPlainRecord('x')).toBe(false)
  })
})
