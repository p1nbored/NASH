import { DEFAULT_UI_LOCALE } from '../../../shared/ui-locale'

// Why zh-Hans: the zh catalog is Simplified Chinese; the script subtag selects Simplified glyph
// forms and the matching `:lang(zh)` font order in main.css rather than a Traditional one.
const CATALOG_DOCUMENT_TAGS: Readonly<Record<string, string>> = {
  en: 'en',
  zh: 'zh-Hans',
  ja: 'ja',
  ko: 'ko',
  es: 'es',
  fr: 'fr'
}

function canonicalTag(candidate: string | undefined): string | null {
  if (!candidate) {
    return null
  }
  try {
    return Intl.getCanonicalLocales(candidate)[0] ?? null
  } catch {
    return null
  }
}

/**
 * BCP 47 tag for `<html lang>` from an i18next resource language. Plugin catalogs register under
 * a synthetic `plugin<hex>` language, so their declared locale wins when one is given.
 */
export function toDocumentLanguageTag(resourceLanguage: string, packLocale?: string): string {
  return (
    canonicalTag(packLocale) ??
    CATALOG_DOCUMENT_TAGS[resourceLanguage] ??
    canonicalTag(resourceLanguage) ??
    DEFAULT_UI_LOCALE
  )
}

export function applyDocumentLanguage(tag: string): void {
  // Why optional: node tests and partial `document` stubs have no root element.
  const root = typeof document === 'undefined' ? undefined : document.documentElement
  if (root) {
    root.lang = tag
  }
}
