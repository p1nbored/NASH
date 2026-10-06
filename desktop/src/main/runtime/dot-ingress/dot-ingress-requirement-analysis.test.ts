import { describe, expect, it } from 'vitest'
import { DOT_INGRESS_PROSE_MAX_CHARS } from '../../../shared/dot-ingress/dot-ingress-limits'
import { OrchestrationError } from '../orchestration/orchestration-error'
import { analyzeDotRequirement } from './dot-ingress-requirement-analysis'

// FIXTURE_ONLY: every token below is synthetic and obviously fake.
const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.c2lnbmF0dXJl'
const FAKE_BEARER = 'Bearer 0123456789abcdef0123'

function refusal(objective: string, deliverableLanguage?: string) {
  try {
    analyzeDotRequirement({ objective, deliverableLanguage })
    return null
  } catch (error) {
    if (!(error instanceof OrchestrationError)) {
      throw error
    }
    return { code: error.code, message: error.message, data: error.data }
  }
}

describe('dot requirement analysis', () => {
  it('accepts English prose with quoted names and records span rules by name only', () => {
    const analysis = analyzeDotRequirement({
      objective:
        'Summarize the config in `/srv/fixture/app.yml` and mail the owner at "owner@example.test".'
    })
    expect(analysis).toEqual({
      scanRules: ['email_address', 'posix_absolute_path'],
      deliverableLanguage: null
    })
  })

  it('keeps quoted text in any script out of the English check', () => {
    expect(
      analyzeDotRequirement({ objective: 'Translate the title “設定ファイル” into English.' })
    ).toEqual({ scanRules: [], deliverableLanguage: null })
  })

  it.each([
    ['a path', 'Read /srv/fixture/app.yml and summarize it.', 'posix_absolute_path'],
    ['a Windows path', 'Open C:\\fixture\\app.yml and summarize it.', 'windows_absolute_path'],
    ['an email', 'Write to owner@example.test about the outage.', 'email_address'],
    ['a 32-hex id', 'Check account 0123456789abcdef0123456789abcdef today.', 'hex_identifier']
  ])('rejects %s in prose and names the rule only', (_name, objective, rule) => {
    const refused = refusal(objective)
    expect(refused?.code).toBe('dot_requirement_rejected_content')
    expect(refused?.data).toEqual({ rules: expect.arrayContaining([rule]) })
    expect(JSON.stringify(refused)).not.toContain('fixture')
    expect(JSON.stringify(refused)).not.toContain('example.test')
  })

  it.each([
    ['a JWT in quotes', `Use the token "${FAKE_JWT}" for the test.`],
    ['a bearer token in prose', `Call the API with ${FAKE_BEARER} please.`],
    ['a private key header in backticks', 'Store `-----BEGIN PRIVATE KEY-----` in the vault.'],
    ['an API key in a fence', 'Set this:\n```\napi_key = fixture-not-a-real-key\n```\nthen run.']
  ])('rejects %s anywhere, quoted spans included', (_name, objective) => {
    const refused = refusal(objective)
    expect(refused?.code).toBe('dot_requirement_rejected_content')
    expect(JSON.stringify(refused)).not.toContain('fixture-not-a-real-key')
    expect(JSON.stringify(refused)).not.toContain(FAKE_JWT)
  })

  it('rejects prose that is not English and tells dot how to rewrite it', () => {
    const refused = refusal('設定ファイルを要約してください。')
    expect(refused?.code).toBe('dot_requirement_not_english')
    expect(refused?.message).toContain('Rewrite the requirement in English')
  })

  it.each([
    ['blank', '   \n  '],
    ['only quoted text', '"設定ファイル" `docs/plan.md`'],
    ['only punctuation outside quotes', '-- "設定ファイル" --']
  ])('treats a %s requirement as unclear', (_name, objective) => {
    expect(refusal(objective)?.code).toBe('dot_requirement_unclear')
  })

  it('rejects prose over the cap and more quoted spans than the parser allows', () => {
    expect(refusal(`Summarize ${'a'.repeat(DOT_INGRESS_PROSE_MAX_CHARS)}.`)?.code).toBe(
      'dot_requirement_too_long'
    )
    const manySpans = Array.from({ length: 33 }, (_unused, index) => `"n${index}"`).join(' ')
    expect(refusal(`Rename these files: ${manySpans}.`)?.code).toBe('dot_requirement_too_long')
  })

  it('canonicalizes the deliverable language and refuses an invalid tag', () => {
    expect(
      analyzeDotRequirement({
        objective: 'Summarize the issues.',
        deliverableLanguage: 'zh-hant-tw'
      }).deliverableLanguage
    ).toBe('zh-Hant-TW')
    expect(refusal('Summarize the issues.', 'en_US')?.code).toBe('dot_deliverable_language_invalid')
  })

  it('checks a secret before anything else, so no other error can hint at its position', () => {
    expect(refusal(`設定 ${FAKE_BEARER}`)?.code).toBe('dot_requirement_rejected_content')
  })
})
