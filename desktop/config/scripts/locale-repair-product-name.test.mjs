import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectStringLeaves, repairCatalog } from './locale-translation-policy.mjs'

// Why: the repair pipeline re-applies curated overrides; one still written for the old product name
// would quietly turn the renamed catalogs back into "Orca" on the next repair run (D-017).
const LOCALES_DIR = path.join(
  import.meta.dirname,
  '..',
  '..',
  'src',
  'renderer',
  'src',
  'i18n',
  'locales'
)

function readCatalog(locale) {
  return JSON.parse(readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf8'))
}

function leafValues(catalog) {
  return new Map(collectStringLeaves(catalog).map(({ key, value }) => [key, value]))
}

function occurrences(text, pattern) {
  return (text.match(pattern) ?? []).length
}

function revertsToOrca(previous, next) {
  return (
    occurrences(next, /NASH/g) < occurrences(previous, /NASH/g) &&
    occurrences(next, /\bOrca\b/g) > occurrences(previous, /\bOrca\b/g)
  )
}

describe('catalog repair keeps the NASH product name', () => {
  it.each(['ko', 'zh', 'ja', 'es'])('%s: never turns NASH back into Orca', (locale) => {
    const catalog = readCatalog(locale)
    const before = leafValues(catalog)

    repairCatalog(readCatalog('en'), catalog, locale)

    const reverted = [...leafValues(catalog)]
      .filter(([key, value]) => revertsToOrca(before.get(key) ?? '', value))
      .map(([key, value]) => `${key}: ${value}`)
    expect(reverted).toEqual([])
  })
})
