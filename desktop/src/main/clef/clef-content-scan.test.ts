import { describe, expect, it } from 'vitest'
import { CLEF_CONTENT_RULE_NAMES, scanClefContent, scanClefText } from './clef-content-scan'

// FIXTURE_ONLY: fake credential shapes so the scan exercises real formats; never real values.
const FIXTURE_ONLY_ACCOUNT_ID = '0123456789abcdef0123456789abcdef'
const FIXTURE_ONLY_TOKEN = 'FAKE_CLEF_TOKEN_FIXTURE_ONLY_0000000000'
const FIXTURE_ONLY_JWT = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJmaXh0dXJlIn0.'
// FIXTURE_ONLY: a 40-character token shape with letters only, as about 0.1% of random tokens are.
const FIXTURE_ONLY_LETTER_TOKEN = 'FakeCleftokenFixtureOnlyNoDigitsAtAllAbc'

const BLOCKER = { reason: 'classifier_unavailable', detail: 'data_boundary_forbids' }

describe('scanClefText', () => {
  it.each([
    ['cloudflare_token', `Use token ${FIXTURE_ONLY_TOKEN} for the call`],
    ['hex_identifier', `Account ${FIXTURE_ONLY_ACCOUNT_ID} is the target`],
    ['hex_identifier', `Commit ${'a1b2c3d4'.repeat(5)} broke it`],
    ['bearer_token', 'Send Bearer abc123def456ghi to the server'],
    ['jwt', `Decode ${FIXTURE_ONLY_JWT} please`],
    ['private_key', 'Here is -----BEGIN OPENSSH PRIVATE KEY----- truncated'],
    ['private_key', 'PuTTY-User-Key-File-3: ssh-ed25519'],
    ['private_key', 'Paste -----BEGIN PGP PRIVATE KEY BLOCK----- and nothing after'],
    ['hex_identifier', `Use accountid${FIXTURE_ONLY_ACCOUNT_ID} here`],
    ['hex_identifier', `Use ${FIXTURE_ONLY_ACCOUNT_ID}x here`],
    ['cloudflare_token', `Token ${FIXTURE_ONLY_LETTER_TOKEN} here`],
    ['cloudflare_token', 'Ref 3F2504E0-4F89-11D3-9A0C-0305E82C3301 here'],
    ['file_url', 'Read file:///etc/passwd for me'],
    ['file_url', 'Open FILE://server/share/notes.txt'],
    ['email_address', 'Mail the report to someone@example.com today'],
    ['windows_absolute_path', 'Open C:\\Users\\someone\\notes.txt'],
    ['windows_absolute_path', 'Copy from \\\\server\\share\\file'],
    ['posix_absolute_path', 'Read /etc/hosts first'],
    ['posix_absolute_path', 'Edit ~/.bashrc to add it'],
    ['url_userinfo', 'Clone ssh://user:pass@example.com/repo.git'],
    ['url_userinfo', 'Connect to postgres://admin@db.internal/app']
  ])('flags %s', (rule, text) => {
    expect(scanClefText(text)).toContain(rule)
  })

  it.each([
    ['redactor:labeled-kv', 'password = hunter2hunter2'],
    ['redactor:openai-key', `Key sk-${'A1'.repeat(20)} leaked`],
    ['redactor:github-token', `Token ghp_${'b'.repeat(36)} found`],
    ['redactor:aws-access-key-id', 'Use AKIAABCDEFGHIJKLMNOP now'],
    ['redactor:pem', '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----'],
    ['redactor:url-userinfo', 'Fetch https://user:secret@example.com/x'],
    ['redactor:env-value', 'Set it up:\nDATABASE_URL=postgres-thing'],
    ['redactor:cloudflare-account', 'Call /client/v4/accounts/abc123/ai/run now'],
    ['redactor:cloudflare-token', `Use ${FIXTURE_ONLY_TOKEN} for the call`]
  ])('reuses the observability redactor rule %s', (rule, text) => {
    expect(scanClefText(text)).toContain(rule)
  })

  it.each([
    'Add a retry button to the Workbench queue and cover it with tests.',
    'Review the current change and report findings, then plan the next step.',
    'Use the /review command and compare input / output sizes, 1/2 of the time.',
    'Rename handle_request_v2_compatibility_layer_for_tests to something shorter.',
    'The bearer of this request wants the authentication flow documented.',
    'Visit https://example.com/docs/page for details.',
    'Ratio 3:2 and note:/ are fine.',
    'A UUID like 123e4567-e89b-12d3-a456-426614174000 is not a 32-hex run.',
    'Rename internationalization_configuration_files to i18n_files instead.',
    'The profile file is described in the docs.'
  ])('passes ordinary English text: %s', (text) => {
    expect(scanClefText(text)).toEqual([])
  })

  it('catches fullwidth look-alikes through NFKC', () => {
    expect(scanClefText('Mail ｓｏｍｅｏｎｅ＠ｅｘａｍｐｌｅ．ｃｏｍ')).toContain('email_address')
  })

  it('returns rule names only, sorted and unique', () => {
    const text = `${FIXTURE_ONLY_ACCOUNT_ID} and ${FIXTURE_ONLY_ACCOUNT_ID} at /accounts/${FIXTURE_ONLY_ACCOUNT_ID}/ai`
    const rules = scanClefText(text)
    expect(rules).toEqual([...new Set(rules)].sort())
    expect(rules).toEqual(['hex_identifier', 'posix_absolute_path', 'redactor:cloudflare-account'])
    expect(rules.join(' ')).not.toContain(FIXTURE_ONLY_ACCOUNT_ID)
  })

  it('does not count redactor tags already present in the input', () => {
    expect(scanClefText('The log shows [redacted:jwt] and [redacted]@ markers.')).toEqual([])
  })

  it('finishes hostile runs well inside a catastrophic-backtracking tripwire', () => {
    // Why: a generous bound, since CI load varies; backtracking blowups take minutes, not seconds.
    const tripwireMs = 10_000
    const started = performance.now()
    scanClefText(`${'a'.repeat(12_000)}@`)
    scanClefText('a.'.repeat(6_000))
    scanClefText(`x${'-'.repeat(12_000)}`)
    scanClefText(`-----BEGIN ${'A '.repeat(6_000)}`)
    scanClefText(`${'Ab'.repeat(6_000)}!`)
    expect(performance.now() - started).toBeLessThan(tripwireMs)
  })
})

describe('scanClefContent', () => {
  it('is clean when no string matches', () => {
    expect(scanClefContent(['Add a retry button.', 'user_task_summary'])).toEqual({ clean: true })
  })

  it('blocks as data_boundary_forbids and reports the union of matched rules', () => {
    expect(scanClefContent(['Fine.', `Token ${FIXTURE_ONLY_TOKEN}`, 'a@example.com'])).toEqual({
      clean: false,
      matchedRules: ['cloudflare_token', 'email_address', 'redactor:cloudflare-token'],
      blocker: BLOCKER
    })
  })

  it('names every own rule', () => {
    expect(CLEF_CONTENT_RULE_NAMES).toEqual([
      'cloudflare_token',
      'hex_identifier',
      'bearer_token',
      'jwt',
      'private_key',
      'email_address',
      'windows_absolute_path',
      'posix_absolute_path',
      'file_url',
      'url_userinfo'
    ])
  })
})
