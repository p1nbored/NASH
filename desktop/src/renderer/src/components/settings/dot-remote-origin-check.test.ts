import { describe, expect, it } from 'vitest'
import { checkDotRemoteOrigin } from './dot-remote-origin-check'
import { dotRemoteOriginProblemMessage } from './dot-remote-refusal-messages'

// Mirrors the main process's origin cases (dot-remote-credentials.test.ts), with the reason added.
describe('checkDotRemoteOrigin', () => {
  it.each([
    ['https://fixture-nash.example.test', 'https://fixture-nash.example.test'],
    ['https://fixture-nash.example.test/', 'https://fixture-nash.example.test'],
    ['  https://Fixture-Nash.Example.Test  ', 'https://fixture-nash.example.test'],
    ['https://fixture.example.test:8443', 'https://fixture.example.test:8443']
  ])('accepts the https origin %s', (input, origin) => {
    expect(checkDotRemoteOrigin(input)).toEqual({ ok: true, origin })
  })

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['https://fixture example.test', 'spaces'],
    ['fixture.example.test', 'not_a_url'],
    ['https://', 'not_a_url'],
    ['http://fixture.example.test', 'not_https'],
    ['ftp://fixture.example.test', 'not_https'],
    ['https://user:pass@fixture.example.test', 'sign_in_details'],
    ['https://fixture.example.test/mcp', 'path'],
    ['https://fixture.example.test/?a=1', 'path'],
    ['https://fixture.example.test/#x', 'path'],
    [`https://${'a'.repeat(2050)}.example.test`, 'too_long']
  ])('refuses %j as %s', (input, reason) => {
    expect(checkDotRemoteOrigin(input)).toEqual({ ok: false, reason })
  })

  it('explains every refusal in plain English without repeating the input', () => {
    const reasons = [
      'empty',
      'too_long',
      'spaces',
      'not_a_url',
      'not_https',
      'sign_in_details',
      'path'
    ] as const
    for (const reason of reasons) {
      const message = dotRemoteOriginProblemMessage(reason)
      expect(message).toMatch(/^[A-Z][^_]*\.$/)
      expect(message).not.toContain('fixture')
    }
    expect(dotRemoteOriginProblemMessage('not_https')).toMatch(/https/)
  })
})
