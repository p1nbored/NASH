// Spec section 7: the redactor covers Cloudflare account paths and API tokens, so diagnostic
// bundles are safe even where no Clef-specific scrubbing ran.

import { describe, expect, it } from 'vitest'
import { redactAttributes, redactSpan, redactString, type RedactableSpan } from './redactor'

// FIXTURE_ONLY: fake values shaped like a real account id and API token; never real secrets.
const FIXTURE_ONLY_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
const FIXTURE_ONLY_TOKEN = 'FAKE_CLEF_TOKEN_FIXTURE_ONLY_0000000000'
const FIXTURE_ONLY_TOKEN_40 = 'FakeCleftoken0FixtureOnly1NoRealSecret'.padEnd(40, 'Z')
const RUN_URL = `https://api.cloudflare.com/client/v4/accounts/${FIXTURE_ONLY_ACCOUNT_ID}/ai/run/@cf/cloudflare/clef`
const ACCOUNT_TAG = '[redacted:cloudflare-account]'
const TOKEN_TAG = '[redacted:cloudflare-token]'

function span(overrides: Partial<RedactableSpan>): RedactableSpan {
  return {
    name: 'test',
    traceId: 't',
    spanId: 's',
    kind: 'internal',
    startTimeUnixNano: '0',
    endTimeUnixNano: '1',
    durationMs: 0,
    attributes: {},
    events: [],
    exit: { _tag: 'Success' },
    ...overrides
  }
}

describe('redactor Cloudflare account path', () => {
  it('redacts the account id in a run URL and keeps the rest of the path', () => {
    expect(redactString(`POST ${RUN_URL} failed`)).toBe(
      `POST https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_TAG}/ai/run/@cf/cloudflare/clef failed`
    )
  })

  it.each([
    ['a trailing segment', `/accounts/${FIXTURE_ONLY_ACCOUNT_ID}`, `/accounts/${ACCOUNT_TAG}`],
    ['a query string', `/accounts/some-id?x=1`, `/accounts/${ACCOUNT_TAG}?x=1`],
    ['any letter case', `/ACCOUNTS/abc123`, `/ACCOUNTS/${ACCOUNT_TAG}`],
    ['a quoted JSON value', `{"url":"/accounts/abc/ai"}`, `{"url":"/accounts/${ACCOUNT_TAG}/ai"}`],
    ['a short id', `/accounts/x/ai`, `/accounts/${ACCOUNT_TAG}/ai`]
  ])('redacts any non-placeholder segment: %s', (_label, input, expected) => {
    expect(redactString(input)).toBe(expected)
  })

  it.each([
    'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/@cf/cloudflare/clef',
    '/accounts/{account_id}',
    '/accounts/{id}/ai?x=1'
  ])('keeps a recorded URL template placeholder: %s', (template) => {
    expect(redactString(template)).toBe(template)
  })

  it('does not touch text that only mentions accounts', () => {
    expect(redactString('switch accounts in the settings; accounts/ is a folder name')).toBe(
      'switch accounts in the settings; accounts/ is a folder name'
    )
  })

  it('is idempotent', () => {
    const once = redactString(`call ${RUN_URL} twice`)
    expect(redactString(once)).toBe(once)
  })

  it('covers attribute values, span events and the exit cause', () => {
    const out = JSON.stringify(
      redactSpan(
        span({
          attributes: { url: RUN_URL },
          events: [{ name: 'e', timeUnixNano: '0', attributes: { message: `failed ${RUN_URL}` } }],
          exit: { _tag: 'Failure', cause: `Error at ${RUN_URL}\n  at fetch` }
        })
      )
    )
    expect(out).not.toContain(FIXTURE_ONLY_ACCOUNT_ID)
    expect(out.split(ACCOUNT_TAG)).toHaveLength(4)
  })
})

describe('redactor Cloudflare token', () => {
  it.each([
    ['the 39 character fixture token', FIXTURE_ONLY_TOKEN],
    ['a 40 character mixed-case token', FIXTURE_ONLY_TOKEN_40],
    ['a long URL-safe token with a hyphen', `${'Ab1-'.repeat(12)}Zz`],
    ['a hex-like token with one non-hex character', 'E3B0C44298FC1C149AFBF4C8996FB924G']
  ])('redacts %s wherever it appears', (_label, token) => {
    expect(redactString(`call failed with ${token} here`)).toBe(
      `call failed with ${TOKEN_TAG} here`
    )
    expect(redactString(token)).toBe(TOKEN_TAG)
    expect(redactString(`(${token}),`)).toBe(`(${TOKEN_TAG}),`)
  })

  it('covers attribute values, span events and the exit cause', () => {
    const out = JSON.stringify(
      redactSpan(
        span({
          attributes: { note: `saw ${FIXTURE_ONLY_TOKEN}` },
          events: [
            { name: 'e', timeUnixNano: '0', attributes: { message: `saw ${FIXTURE_ONLY_TOKEN}` } }
          ],
          exit: { _tag: 'Failure', cause: `saw ${FIXTURE_ONLY_TOKEN}\n  at fetch` }
        })
      )
    )
    expect(out).not.toContain(FIXTURE_ONLY_TOKEN)
    expect(out.split(TOKEN_TAG)).toHaveLength(4)
  })

  it('redacts a token nested inside an attribute value tree', () => {
    const out = redactAttributes({ failure: { detail: [`x ${FIXTURE_ONLY_TOKEN}`] } })
    expect(JSON.stringify(out)).not.toContain(FIXTURE_ONLY_TOKEN)
  })

  it.each([
    ['a git commit id', 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'],
    ['a sha256 digest', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    [
      'an uppercase sha256 digest',
      'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855'
    ],
    ['an uppercase GUID', '3F2504E0-4F89-11D3-9A0C-0305E82C3301'],
    ['a lowercase snake_case identifier', 'handle_request_v2_compatibility_layer_for_tests'],
    ['a short mixed token', 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0U'],
    ['an ordinary sentence', 'The profile file is described in the docs and has 3 sections.']
  ])('leaves %s alone', (_label, text) => {
    expect(redactString(text)).toBe(text)
  })

  it('is idempotent', () => {
    const once = redactString(`saw ${FIXTURE_ONLY_TOKEN} and ${FIXTURE_ONLY_TOKEN_40}`)
    expect(redactString(once)).toBe(once)
  })

  it('stays linear on hostile runs', () => {
    // Why: a generous bound, since CI load varies; backtracking blowups take minutes, not seconds.
    const tripwireMs = 10_000
    const started = performance.now()
    redactString('a'.repeat(50_000))
    redactString(`${'Ab'.repeat(25_000)}!`)
    redactString(`${'a-'.repeat(25_000)}/accounts/${'x'.repeat(25_000)}`)
    expect(performance.now() - started).toBeLessThan(tripwireMs)
  })
})
