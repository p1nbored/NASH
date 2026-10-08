import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import zh from './locales/zh.json'
import nashKeys from './nash-catalog-keys.test-fixture.json'

function flatten(
  value: unknown,
  prefix = '',
  result = new Map<string, string>()
): Map<string, string> {
  if (typeof value === 'string') {
    result.set(prefix, value)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, result)
    }
  }
  return result
}
const english = flatten(en)
const placeholders = (value: string): string[] => (value.match(/\{\{[^}]+\}\}/g) ?? []).sort()

// Keys added or changed since Orca import 8105599b, captured for NASH plan P7.
describe('NASH catalog coverage', () => {
  for (const [locale, catalog] of Object.entries({ es, fr, ja, ko, zh })) {
    it(`${locale}: translates every NASH key with the same placeholders`, () => {
      const target = flatten(catalog)
      const missing = nashKeys.filter((key) => !target.get(key)?.trim())
      expect(missing).toEqual([])
      const mismatched = nashKeys.filter(
        (key) =>
          JSON.stringify(placeholders(target.get(key) ?? '')) !==
          JSON.stringify(placeholders(english.get(key) ?? ''))
      )
      expect(mismatched).toEqual([])
    })
  }
  it('keeps the key fixture tied to live English copy', () => {
    expect(nashKeys.filter((key) => !english.has(key))).toEqual([])
  })
})
