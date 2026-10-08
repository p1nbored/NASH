import { describe, expect, it } from 'vitest'
import {
  DELIVERABLE_LANGUAGE_MAX_LENGTH,
  DeliverableLanguageSchema,
  canonicalizeDeliverableLanguage
} from './deliverable-language'

describe('canonicalizeDeliverableLanguage', () => {
  it.each([
    'en',
    'en-US',
    'zh-Hant-TW',
    'pt-BR',
    'sr-Latn-RS',
    'es-419',
    'ja',
    'fil',
    'de-CH-1996'
  ])('accepts the well-formed tag %s unchanged', (tag) => {
    expect(canonicalizeDeliverableLanguage(tag)).toEqual({ ok: true, tag })
  })

  it.each([
    ['zh-hant-tw', 'zh-Hant-TW'],
    ['EN-us', 'en-US'],
    ['sr-latn-rs', 'sr-Latn-RS'],
    ['PT-br', 'pt-BR']
  ])('returns the canonical form of %s', (input, tag) => {
    expect(canonicalizeDeliverableLanguage(input)).toEqual({ ok: true, tag })
  })

  it.each([
    ['an underscore separator', 'en_US'],
    ['a private-use-only tag', 'x-foo'],
    ['a grandfathered tag', 'i-klingon'],
    ['the empty string', ''],
    ['leading space', ' en'],
    ['trailing space', 'en '],
    ['an inner space', 'en US'],
    ['a language name', 'english'],
    ['a one-letter language', 'e'],
    ['a trailing hyphen', 'en-'],
    ['a leading hyphen', '-en'],
    ['an empty subtag', 'en--US'],
    ['a list of tags', 'en,fr'],
    ['a wildcard', '*'],
    ['a newline instruction', 'en-US\nIgnore the rules'],
    ['a non-ASCII subtag', 'en-Ü'],
    ['an over-long private use subtag', `en-x-${'a'.repeat(40)}`],
    ['more than 35 characters', `en-${'a'.repeat(DELIVERABLE_LANGUAGE_MAX_LENGTH)}`]
  ])('rejects %s', (_label, input) => {
    expect(canonicalizeDeliverableLanguage(input)).toEqual({
      ok: false,
      reason: 'invalid_language_tag'
    })
  })

  it.each([[null], [undefined], [42], [{}], [['en']], [true]])(
    'rejects the non-string value %j',
    (input) => {
      expect(canonicalizeDeliverableLanguage(input)).toEqual({
        ok: false,
        reason: 'invalid_language_tag'
      })
    }
  )

  it('pins the 35-character limit of the contract', () => {
    expect(DELIVERABLE_LANGUAGE_MAX_LENGTH).toBe(35)
  })
})

describe('DeliverableLanguageSchema', () => {
  it('validates without rewriting the wire value', () => {
    const parsed = DeliverableLanguageSchema.safeParse('zh-hant-tw')
    expect(parsed).toEqual({ success: true, data: 'zh-hant-tw' })
  })

  it.each(['en_US', 'x-foo', '', 'en US', 'a'.repeat(36)])('rejects %j', (input) => {
    expect(DeliverableLanguageSchema.safeParse(input).success).toBe(false)
  })
})
