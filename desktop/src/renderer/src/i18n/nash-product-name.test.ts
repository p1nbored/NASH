import { describe, expect, it } from 'vitest'

import nashKeys from './nash-catalog-keys.test-fixture.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import zh from './locales/zh.json'
import {
  KEPT_ORCA_CATALOG_KEYS,
  ORCA_SERVICE_PHRASES,
  PRODUCT_TOKEN,
  RETIRED_IDENTITY_VALUES,
  type CatalogLocale
} from './nash-product-name.test-fixture'

const CATALOGS: Readonly<Record<CatalogLocale, unknown>> = { en, es, fr, ja, ko, zh }

function flatten(
  value: unknown,
  prefix = '',
  out = new Map<string, string>()
): Map<string, string> {
  if (typeof value === 'string') {
    out.set(prefix, value)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out)
    }
  }
  return out
}

function withoutServicePhrases(locale: CatalogLocale, value: string): string {
  return ORCA_SERVICE_PHRASES[locale].reduce((text, phrase) => text.replace(phrase, ''), value)
}

describe('NASH product name in the renderer catalogs (D-017)', () => {
  for (const locale of Object.keys(CATALOGS) as CatalogLocale[]) {
    it(`${locale}: names Orca only for Orca's own services, project and files`, () => {
      const offenders = [...flatten(CATALOGS[locale])]
        .filter(([key]) => !(key in KEPT_ORCA_CATALOG_KEYS))
        .filter(([, value]) => PRODUCT_TOKEN[locale].test(withoutServicePhrases(locale, value)))
        .map(([key, value]) => `${key}: ${value}`)
      expect(offenders).toEqual([])
    })

    it(`${locale}: never shows the orca:// scheme or the ~/.orca folder`, () => {
      const offenders = [...flatten(CATALOGS[locale])]
        .filter(([, value]) =>
          RETIRED_IDENTITY_VALUES.some((retired) => value.toLowerCase().includes(retired))
        )
        .map(([key]) => key)
      expect(offenders).toEqual([])
    })
  }

  it('keeps every kept key real, so the list cannot hide a stale exception', () => {
    const english = flatten(en)
    const sourceOnlyKeys = new Set(['auto.components.artifacts.ArtifactsPage.signInCopy'])
    const stale = Object.keys(KEPT_ORCA_CATALOG_KEYS).filter(
      (key) => !sourceOnlyKeys.has(key) && !PRODUCT_TOKEN.en.test(english.get(key) ?? '')
    )
    expect(stale).toEqual([])
  })

  it('names the app NASH in the window, tray and recovery copy the main process reads', () => {
    const english = flatten(en)
    expect(english.get('tray.openOrca')).toBe('Open NASH')
    expect(english.get('menu.exploreOrca')).toBe('Explore NASH')
    expect(english.get('rendererRecovery.title')).toBe('NASH keeps failing to load')
    expect(flatten(ja).get('tray.openOrca')).toContain('NASH')
  })
})

const placeholders = (value: string): string[] => (value.match(/\{\{[^}]+\}\}/g) ?? []).sort()

describe('NASH catalog coverage', () => {
  const english = flatten(en)
  for (const [locale, catalog] of Object.entries(CATALOGS)) {
    if (locale === 'en') {
      continue
    }
    it(`${locale}: translates every NASH key with matching placeholders`, () => {
      const target = flatten(catalog)
      expect(nashKeys.filter((key) => !target.get(key)?.trim())).toEqual([])
      for (const key of nashKeys) {
        expect(placeholders(target.get(key) ?? ''), key).toEqual(
          placeholders(english.get(key) ?? '')
        )
      }
    })
  }
  it('keeps the key fixture tied to live English copy', () => {
    expect(nashKeys.filter((key) => !english.has(key))).toEqual([])
  })
})
