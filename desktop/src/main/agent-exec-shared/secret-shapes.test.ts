import { describe, expect, it } from 'vitest'
import { sanitizeCrashReportString } from '../../shared/crash-report-redaction'
import { redactString } from '../observability/redactor'
import { hasSecretLikeText, maskSecretLikeText } from './secret-shapes'

// FIXTURE_ONLY: every credential below is obviously fake and matches no real account.
type Oracle = 'crash-report' | 'observability'
type Sample = [family: string, text: string, secret: string, oracles?: readonly Oracle[]]

const SAMPLES: Sample[] = [
  [
    'openai key',
    'bad key sk-FIXTUREONLYFIXTUREONLYFIXTUREONLY1234 given',
    'FIXTUREONLYFIXTUREONLY'
  ],
  [
    'github token',
    'push failed ghp_FIXTUREONLYFIXTUREONLYFIXTUREONLYFIXTUREONLY x',
    'FIXTUREONLYFIXTURE'
  ],
  ['github fine-grained', 'github_pat_FIXTUREONLYFIXTUREONLY_1234567890 end', 'FIXTUREONLYFIXTURE'],
  ['gitlab token', 'glpat-FIXTUREONLYFIXTUREONLY12345 end', 'FIXTUREONLYFIXTURE'],
  ['slack token', 'hook xoxb-FIXTUREONLY-1234567890 end', 'FIXTUREONLY-1234567890'],
  ['aws access key id', 'creds AKIAFIXTUREONLY12345 end', 'FIXTUREONLY12345'],
  [
    'bearer token',
    'Authorization: Bearer FIXTUREONLYtoken.value-1234567890 end',
    'FIXTUREONLYtoken'
  ],
  [
    'jwt',
    'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.c2lnbmF0dXJl end',
    'eyJhbGciOiJIUzI1NiJ9',
    ['observability']
  ],
  [
    'private key block',
    'key -----BEGIN PRIVATE KEY-----\nFIXTUREONLYKEYMATERIAL\n-----END PRIVATE KEY-----',
    'FIXTUREONLYKEYMATERIAL'
  ],
  [
    'credential url',
    'clone https://fixtureuser:FIXTUREONLYpassword@example.invalid/repo.git failed',
    'FIXTUREONLYpassword'
  ]
]

describe('maskSecretLikeText', () => {
  it.each(SAMPLES)('masks a %s', (_family, text, secret) => {
    const masked = maskSecretLikeText(text)
    expect(masked).not.toContain(secret)
    expect(masked).toContain('[redacted]')
    expect(hasSecretLikeText(text)).toBe(true)
  })

  it.each([
    ['Authorization: Basic dXNlcjpGSVhUVVJFT05MWQ==', 'dXNlcjpGSVhUVVJFT05MWQ'],
    ['proxy-authorization=Digest FIXTUREONLYdigest123', 'FIXTUREONLYdigest123'],
    ['run tool --password FIXTUREONLYpw1 --verbose', 'FIXTUREONLYpw1'],
    ['run tool --token=FIXTUREONLYtok1 --verbose', 'FIXTUREONLYtok1'],
    ['api_key=FIXTUREONLYvalue123 next', 'FIXTUREONLYvalue123'],
    ['"token": "FIXTUREONLYvalue456"', 'FIXTUREONLYvalue456'],
    ['password: hunter2fixture', 'hunter2fixture'],
    ['-----BEGIN RSA PRIVATE KEY-----\nFIXTUREONLYTRUNCATED', 'FIXTUREONLYTRUNCATED']
  ])('masks %j', (text, secret) => {
    expect(maskSecretLikeText(text)).not.toContain(secret)
    expect(hasSecretLikeText(text)).toBe(true)
  })

  it.each([
    'stream disconnected before completion: status 429, retry in 20s (key rotation docs)',
    'Basic authentication is required by the registry',
    'the token budget was exceeded; tokenizer: fast',
    'see https://example.com/docs?contact=a@b.example for details',
    'git@github.com:org/repo.git',
    'ghp_short and sk-short and AKIA123'
  ])('leaves ordinary text alone: %j', (text) => {
    expect(maskSecretLikeText(text)).toBe(text)
    expect(hasSecretLikeText(text)).toBe(false)
  })

  it('is idempotent', () => {
    for (const [, text] of SAMPLES) {
      const once = maskSecretLikeText(text)
      expect(maskSecretLikeText(once)).toBe(once)
    }
  })

  it('keeps the surrounding text readable', () => {
    expect(maskSecretLikeText('Incorrect API key: sk-FIXTUREONLYFIXTUREONLY1234 (code 401)')).toBe(
      'Incorrect API key: [redacted] (code 401)'
    )
  })
})

describe('maskSecretLikeText covers what the existing Orca redactors treat as secret', () => {
  // Neither oracle can be imported for its patterns (the crash-report ones are module-private and
  // both are quadratic on adversarial text), so this guard keeps the linear shapes from drifting.
  it.each(SAMPLES)('agrees with the oracles that know a %s', (_family, text, secret, oracles) => {
    const known = oracles ?? ['crash-report', 'observability']
    if (known.includes('crash-report')) {
      expect(sanitizeCrashReportString(text, 10_000)).not.toContain(secret)
    }
    if (known.includes('observability')) {
      expect(redactString(text)).not.toContain(secret)
    }
    expect(maskSecretLikeText(text)).not.toContain(secret)
  })
})

describe('secret shapes stay linear on adversarial input', () => {
  const HUGE = 300_000
  const inputs: readonly (readonly [string, string])[] = [
    ['one long identifier run', 'a'.repeat(HUGE)],
    ['dash separated identifier run', 'a-'.repeat(HUGE / 2)],
    ['dotted run (credential url shape)', 'a.'.repeat(HUGE / 2)],
    ['repeated jwt header prefix', 'eyJ-'.repeat(HUGE / 4)],
    ['repeated jwt prefix with dots', 'eyJabcdefghij.'.repeat(HUGE / 14)],
    ['repeated openai prefix', 'sk-'.repeat(HUGE / 3)],
    ['repeated assignment keyword', 'token='.repeat(HUGE / 6)],
    ['assignment keyword then a long value', `token=${'v'.repeat(HUGE)}`],
    ['assignment keyword then long whitespace', `token${' '.repeat(HUGE)}x`],
    ['repeated private key header', '-----BEGIN '.repeat(HUGE / 11)],
    ['private key header then a long run', `-----BEGIN ${'A '.repeat(HUGE / 2)}`],
    ['repeated bearer keyword', 'Bearer '.repeat(HUGE / 7)],
    ['repeated userinfo scheme', '://a'.repeat(HUGE / 4)],
    ['repeated authorization label', 'authorization: '.repeat(HUGE / 15)],
    ['repeated long flag', '--password'.repeat(HUGE / 10)],
    ['long whitespace run', ' '.repeat(HUGE)]
  ]

  it.each(inputs)('masks %s in under 100 ms', (_label, text) => {
    const started = performance.now()
    maskSecretLikeText(text)
    expect(performance.now() - started).toBeLessThan(100)
  })

  it.each(inputs)('scans %s in under 100 ms', (_label, text) => {
    const started = performance.now()
    hasSecretLikeText(text)
    expect(performance.now() - started).toBeLessThan(100)
  })
})
