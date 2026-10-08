// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { pluginLanguageResourceId } from '../../../shared/plugins/plugin-language-pack-artifact'
import { applyDocumentLanguage, toDocumentLanguageTag } from './document-language'
import { i18n, setRendererPluginLanguagePacks, setRendererUiLanguage } from './i18n'

// Why: <html lang> picks CJK glyph forms and the per-language font order in main.css, and it
// tells screen readers which voice to use; it has to follow the UI language, not stay English.
describe('toDocumentLanguageTag', () => {
  it.each([
    ['en', 'en'],
    ['zh', 'zh-Hans'],
    ['ja', 'ja'],
    ['ko', 'ko'],
    ['es', 'es'],
    ['fr', 'fr'],
    ['en-XA', 'en-XA']
  ])('maps the %s catalog to %s', (language, tag) => {
    expect(toDocumentLanguageTag(language)).toBe(tag)
  })

  it("uses a plugin language pack's declared locale", () => {
    expect(toDocumentLanguageTag('plugin1f2e', 'pt-BR')).toBe('pt-BR')
  })

  it('falls back to English for a tag the platform cannot parse', () => {
    expect(toDocumentLanguageTag('plugin1f2e')).toBe('en')
    expect(toDocumentLanguageTag('plugin1f2e', 'not a locale')).toBe('en')
    expect(toDocumentLanguageTag('')).toBe('en')
  })
})

describe('document language follows the UI language', () => {
  beforeEach(async () => {
    setRendererPluginLanguagePacks([])
    await i18n.changeLanguage('en')
  })

  afterEach(async () => {
    setRendererPluginLanguagePacks([])
    await i18n.changeLanguage('en')
  })

  it('writes the tag onto <html>', () => {
    applyDocumentLanguage('ko')
    expect(document.documentElement.lang).toBe('ko')
  })

  // Why: many tests stub `document` with a partial object; a language switch must not throw there.
  it('ignores a document stub without a root element', async () => {
    vi.stubGlobal('document', { createElement: () => ({}) })
    try {
      expect(() => applyDocumentLanguage('ja')).not.toThrow()
      await expect(i18n.changeLanguage('ja')).resolves.toBeTypeOf('function')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('starts in English', () => {
    expect(document.documentElement.lang).toBe('en')
  })

  it('switches to the Simplified Chinese script tag', async () => {
    await i18n.changeLanguage('zh')
    expect(document.documentElement.lang).toBe('zh-Hans')
  })

  it('switches to Japanese and back', async () => {
    await i18n.changeLanguage('ja')
    expect(document.documentElement.lang).toBe('ja')
    await i18n.changeLanguage('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('uses the locale of an active plugin language pack', async () => {
    const id = 'plugin:orca-samples.portuguese/pt-BR' as const
    setRendererPluginLanguagePacks([
      {
        id,
        resourceLanguage: pluginLanguageResourceId(id),
        pluginKey: 'orca-samples.portuguese',
        locale: 'pt-BR',
        catalog: { menu: { file: 'Arquivo Orca' } }
      }
    ])
    await setRendererUiLanguage(id)
    expect(document.documentElement.lang).toBe('pt-BR')
  })
})
