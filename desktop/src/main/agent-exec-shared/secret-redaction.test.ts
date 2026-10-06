import { describe, expect, it } from 'vitest'
import { boundText, redactAndBound, redactSecretLikeText } from './secret-redaction'

const HUGE = 300_000

function elapsedMs(run: () => unknown): number {
  const started = performance.now()
  run()
  return performance.now() - started
}

describe('redactSecretLikeText', () => {
  // FIXTURE_ONLY: none of these are real credentials.
  it.each([
    [
      'Incorrect API key provided: sk-FIXTUREONLY1234567890abcdef.',
      'sk-FIXTUREONLY1234567890abcdef'
    ],
    ['Authorization: Bearer FIXTUREONLYtoken.value-123', 'FIXTUREONLYtoken.value-123'],
    ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.c2lnbmF0dXJl end', 'eyJhbGciOiJIUzI1NiJ9'],
    ['api_key=FIXTUREONLYvalue123 next', 'FIXTUREONLYvalue123'],
    ['"token": "FIXTUREONLYvalue456"', 'FIXTUREONLYvalue456'],
    ['password: hunter2fixture', 'hunter2fixture'],
    ['fatal: https://user:FIXTUREONLYpw99@example.invalid/r.git', 'FIXTUREONLYpw99'],
    ['push ghp_FIXTUREONLYFIXTUREONLYFIXTUREONLY1234 denied', 'FIXTUREONLYFIXTURE']
  ])('masks the secret in %j', (input, secret) => {
    const output = redactSecretLikeText(input)
    expect(output).not.toContain(secret)
    expect(output).toContain('[redacted]')
  })

  it('leaves ordinary diagnostics intact', () => {
    const text =
      'stream disconnected before completion: status 429, retry in 20s (key rotation docs)'
    expect(redactSecretLikeText(text)).toBe(text)
  })

  it.each([
    ['an identifier-like run', 'a'.repeat(HUGE)],
    ['a dash separated run', 'a-'.repeat(HUGE / 2)],
    ['a repeated jwt prefix', 'eyJ-'.repeat(HUGE / 4)],
    ['a dotted run', 'a.'.repeat(HUGE / 2)],
    ['an assignment keyword then a long value', `token=${'v'.repeat(HUGE)}`]
  ])('handles %s of 300K characters in under 100 ms', (_label, text) => {
    expect(elapsedMs(() => redactSecretLikeText(text))).toBeLessThan(100)
  })

  it('still masks a secret that opens an over-long input', () => {
    const output = redactSecretLikeText(`sk-FIXTUREONLYFIXTUREONLY1234 ${'z'.repeat(HUGE)}`)
    expect(output).not.toContain('FIXTUREONLYFIXTUREONLY1234')
  })
})

describe('redactAndBound', () => {
  it('clips before redacting so the cost never depends on the input length', () => {
    for (const text of ['a'.repeat(HUGE), 'eyJ-'.repeat(HUGE / 4), `token=${'v'.repeat(HUGE)}`]) {
      expect(elapsedMs(() => redactAndBound(text, 300))).toBeLessThan(100)
    }
  })

  it('returns text no longer than the bound and says when it cut', () => {
    const bounded = redactAndBound('x'.repeat(HUGE), 200)
    expect(bounded.text).toHaveLength(200)
    expect(bounded.truncated).toBe(true)
    expect(redactAndBound('short', 200)).toEqual({ text: 'short', truncated: false })
  })

  it('redacts a secret inside the bound and one that straddles the cut', () => {
    expect(redactAndBound('use sk-FIXTUREONLYFIXTUREONLY1234 now', 200).text).toBe(
      'use [redacted] now'
    )
    const straddling = `${'p'.repeat(190)} sk-FIXTUREONLYFIXTUREONLY1234`
    const bounded = redactAndBound(straddling, 200)
    expect(bounded.text).not.toContain('FIXTURE')
    expect(bounded.truncated).toBe(true)
  })

  it('does not cut a surrogate pair in half', () => {
    expect(redactAndBound(`${'a'.repeat(199)}🌍tail`, 200).text).toBe('a'.repeat(199))
  })
})

describe('boundText', () => {
  it('returns short text unchanged and marks truncation on long text', () => {
    expect(boundText('abc', 10)).toEqual({ text: 'abc', truncated: false })
    expect(boundText('abcdefghij', 4)).toEqual({ text: 'abcd', truncated: true })
  })

  it('does not cut a surrogate pair in half', () => {
    const result = boundText('ab🌍cd', 3)
    expect(result.truncated).toBe(true)
    expect(result.text).toBe('ab')
  })
})
