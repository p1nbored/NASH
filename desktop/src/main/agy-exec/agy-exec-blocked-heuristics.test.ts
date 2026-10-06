import { describe, expect, it } from 'vitest'
import { detectAgyExecBlock } from './agy-exec-blocked-heuristics'

// FIXTURE_ONLY: these texts are guesses at agy wording; the real strings are unverified (gate G8).
describe('detectAgyExecBlock', () => {
  it.each([
    'Error: quota exceeded for this model',
    'RESOURCE_EXHAUSTED: rate limit reached',
    '429 Too Many Requests',
    'You have reached your usage limit',
    'rate limit exceeded, retry later'
  ])('reads %j as quota', (text) => {
    expect(detectAgyExecBlock([text])).toMatchObject({ reason: 'quota', heuristic: true })
  })

  it.each([
    'You are not logged in. Please sign in.',
    'Error: unauthenticated',
    '401 Unauthorized',
    'Authentication failed: token expired',
    'login required'
  ])('reads %j as auth', (text) => {
    expect(detectAgyExecBlock([text])).toMatchObject({ reason: 'auth', heuristic: true })
  })

  it('returns null for ordinary failure text and for no text', () => {
    expect(detectAgyExecBlock(['panic: nil pointer dereference'])).toBeNull()
    expect(detectAgyExecBlock([''])).toBeNull()
    expect(detectAgyExecBlock([])).toBeNull()
  })

  it('bounds the matched text and redacts credential shapes in it', () => {
    const secret = `sk-${'a1B2'.repeat(10)}`
    const match = detectAgyExecBlock([
      `${'x'.repeat(500)} quota exceeded for key ${secret} ${'y'.repeat(500)}`
    ])
    expect(match?.matchedText.length).toBeLessThanOrEqual(240)
    expect(match?.matchedText).not.toContain(secret)
  })

  it('prefers quota over auth when a text names both, in a fixed order', () => {
    expect(detectAgyExecBlock(['unauthorized: quota exceeded'])?.reason).toBe('quota')
  })
})
