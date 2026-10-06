import { describe, expect, it } from 'vitest'
import { detectCodexExecBlock } from './codex-exec-blocked-heuristics'

describe('detectCodexExecBlock (text heuristics, not a structured error code)', () => {
  it.each([
    "You've hit your usage limit. Upgrade to Pro or try again at 3:14 PM.",
    'ERROR: Usage limit reached for gpt-6-astra',
    'insufficient_quota: You exceeded your current quota',
    'Quota exceeded for this billing period',
    'You have reached your weekly limit'
  ])('maps %j to quota', (message) => {
    expect(detectCodexExecBlock([message])).toMatchObject({ reason: 'quota', heuristic: true })
  })

  it.each([
    'Not logged in. Run `codex login` to authenticate.',
    'unexpected status 401 Unauthorized',
    'Your access token could not be refreshed because your refresh token was revoked.',
    'Authentication failed: invalid credentials',
    'Please sign in again'
  ])('maps %j to auth', (message) => {
    expect(detectCodexExecBlock([message])).toMatchObject({ reason: 'auth', heuristic: true })
  })

  it('returns null for unrelated failures and empty input', () => {
    expect(detectCodexExecBlock(['model stream ended unexpectedly'])).toBeNull()
    expect(detectCodexExecBlock([])).toBeNull()
    expect(detectCodexExecBlock([''])).toBeNull()
  })

  it('reports a bounded, redacted snippet of what matched', () => {
    const noisy = `${'x'.repeat(500)} usage limit reached for sk-FIXTUREONLY1234567890abcdef ${'y'.repeat(500)}`
    const match = detectCodexExecBlock([noisy])
    expect(match?.reason).toBe('quota')
    expect(match?.matchedText.length).toBeLessThanOrEqual(240)
    expect(match?.matchedText).not.toContain('sk-FIXTUREONLY1234567890abcdef')
  })

  it('scans every supplied text and prefers the first that matches', () => {
    expect(detectCodexExecBlock(['nothing here', 'usage limit hit'])?.reason).toBe('quota')
  })
})
