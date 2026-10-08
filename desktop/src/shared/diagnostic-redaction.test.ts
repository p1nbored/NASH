import { describe, expect, it } from 'vitest'
import { redactSecretShapes, sanitizeCopiedDiagnostics } from './crash-report-redaction'

describe('copied diagnostic redaction', () => {
  it('redacts tokens, JWTs and quoted credential assignments while preserving diagnostic paths', () => {
    const value =
      'path=C:/repo/file.ts Bearer abc123 sk-123456789012345678901234 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature {"access_token":"private-value"}'
    const result = redactSecretShapes(value)
    expect(result).toContain('path=C:/repo/file.ts')
    expect(result).not.toMatch(/abc123|123456789012345678901234|eyJ|private-value/)
    expect(result).toContain('[redacted')
  })

  it('removes a long secret before truncating and caps copied diagnostics', () => {
    expect(redactSecretShapes(`Bearer ${'x'.repeat(700)}`)).toBe('[redacted-secret]')
    expect(redactSecretShapes('message '.repeat(100)).length).toBeLessThanOrEqual(503)
  })
})

it('redacts provider environment credentials and escaped quoted secret values', () => {
  const json = JSON.stringify({
    password: '" secret-tail',
    client_secret: 'backslash\\ secret-tail'
  })
  const diagnostic = `ANTHROPIC_AUTH_TOKEN=opaque-provider-value GOOGLE_API_KEY=another-private-value\n${json}`
  expect(sanitizeCopiedDiagnostics(diagnostic)).not.toMatch(
    /opaque-provider-value|another-private-value|secret-tail/
  )
})
