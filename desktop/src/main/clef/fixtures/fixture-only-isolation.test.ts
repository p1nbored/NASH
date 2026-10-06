import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

// Spec section 15: FIXTURE_ONLY fakes live in test paths and no shipped module may import them.
const SRC_ROOT = join(import.meta.dirname, '..', '..', '..')
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts)$/
// Why: same test-path conventions as the child-process import ratchet.
const TEST_PATH =
  /(?:\.(?:test|spec)\.tsx?$|test-harness|test-utils|test-setup|test-fixture|repro|\/__tests__\/|\/__fixtures__\/)/
const TEST_FILE = /\.(?:test|spec)\.tsx?$/
const FIXTURE_FILE_NAME = /\.test-fixture\.tsx?$/
const CLEF_FIXTURE_DIR = 'main/clef/fixtures/'
const FIXTURE_LABEL = /\bFIXTURE_ONLY\b/
const FIXTURE_IDENTIFIER = /\bFIXTURE_ONLY_[A-Z0-9_]+/
const LEADING_COMMENTS = /^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))+/
const IMPORT_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"\n]+)['"]/g
const HEADER_BYTES = 4096

function sourceFiles(): string[] {
  return readdirSync(SRC_ROOT, { recursive: true, encoding: 'utf8' })
    .map((path) => path.split(sep).join('/'))
    .filter((path) => SOURCE_FILE.test(path) && !path.includes('node_modules/'))
}

function read(path: string): string {
  return readFileSync(join(SRC_ROOT, path), 'utf8')
}

/** A module labelled FIXTURE_ONLY in its leading comment block, as the spec requires of every fake. */
function isLabelledFixtureOnly(source: string): boolean {
  const header = LEADING_COMMENTS.exec(source.slice(0, HEADER_BYTES))?.[0] ?? ''
  return FIXTURE_LABEL.test(header)
}

function isFixtureModule(path: string, source: string): boolean {
  return (
    FIXTURE_FILE_NAME.test(path) ||
    path.startsWith(CLEF_FIXTURE_DIR) ||
    isLabelledFixtureOnly(source)
  )
}

function productionSources(files: readonly string[]): string[] {
  return files.filter((path) => !TEST_PATH.test(path) && !path.startsWith(CLEF_FIXTURE_DIR))
}

/** Last path segment without its extension, so an alias or a relative path is judged the same way. */
function moduleStem(specifierOrPath: string): string {
  return basename(specifierOrPath).replace(/\.(?:ts|tsx|mts|cts|js|mjs)$/, '')
}

/** Import specifiers in `source` that name one of the fixture modules (matched by module name). */
function fixtureImportsIn(source: string, fixtureStems: ReadonlySet<string>): string[] {
  return [...source.matchAll(IMPORT_SPECIFIER)]
    .map((match) => match[1] ?? '')
    .filter((specifier) => fixtureStems.has(moduleStem(specifier)))
}

describe('fixture import detection', () => {
  const stems = new Set([
    'clef-spend-memory-store.test-fixture',
    'synthetic-clef-responses.test-fixture'
  ])

  it.each([
    ["import { x } from './clef-spend-memory-store.test-fixture'", 1],
    ['import { x } from "../clef/clef-spend-memory-store.test-fixture.ts"', 1],
    ["export * from './fixtures/synthetic-clef-responses.test-fixture'", 1],
    ["const lazy = await import('./clef-spend-memory-store.test-fixture')", 1],
    ["const old = require('./clef-spend-memory-store.test-fixture')", 1],
    ["import '@/main/clef/clef-spend-memory-store.test-fixture'", 1],
    ["import { x } from './clef-spend-ledger'", 0],
    ["import { x } from './clef-spend-memory-store'", 0]
  ])('finds the fixture imports in %s', (source, count) => {
    expect(fixtureImportsIn(source, stems)).toHaveLength(count)
  })
})

describe('FIXTURE_ONLY modules', () => {
  const files = sourceFiles()
  const fixtureModules = files.filter((path) => isFixtureModule(path, read(path)))
  const fixtureStems = new Set(fixtureModules.map(moduleStem))

  it('include every Clef fake, so the scans below have something to find', () => {
    for (const expected of [
      'main/clef/clef-spend-memory-store.test-fixture.ts',
      'main/clef/clef-transport.test-fixture.ts',
      'main/clef/fixtures/synthetic-clef-responses.test-fixture.ts'
    ]) {
      expect(fixtureModules).toContain(expected)
    }
    expect(fixtureModules).not.toContain('main/clef/clef-spend-ledger.ts')
  })

  it('carry the FIXTURE_ONLY label in their leading comment', () => {
    const unlabelled = fixtureModules.filter(
      (path) =>
        path.startsWith('main/clef/') && !TEST_FILE.test(path) && !isLabelledFixtureOnly(read(path))
    )
    expect(unlabelled).toEqual([])
  })

  it('no longer leaves the in-memory spend store in a production path', () => {
    expect(existsSync(join(SRC_ROOT, 'main/clef/clef-spend-memory-store.ts'))).toBe(false)
  })

  it('are never imported or referenced by production code', () => {
    const production = productionSources(files)
    expect(production).toContain('main/clef/clef-response-validation.ts')
    expect(production).toContain('main/clef/clef-spend-ledger.ts')
    expect(production).not.toContain('main/clef/clef-response-validation.test.ts')
    expect(production).not.toContain('main/clef/clef-spend-memory-store.test-fixture.ts')
    const offenders = production.flatMap((path) => {
      const text = read(path)
      const imported = fixtureImportsIn(text, fixtureStems)
      const referenced = FIXTURE_IDENTIFIER.test(text) ? ['FIXTURE_ONLY identifier'] : []
      return [...imported, ...referenced].map((what) => `${path}: ${what}`)
    })
    expect(offenders).toEqual([])
  })
})
