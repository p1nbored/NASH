import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// Why: English in the main process is the translateMain() fallback, not en.json (main-i18n.ts),
// so a fallback that drifts from the catalog shows English users different words than the docs,
// the renderer and every other locale; the product rename (D-017) left 16 such fallbacks behind.

const MAIN_ROOT = join(process.cwd(), 'src', 'main')
const EN_CATALOG = join(process.cwd(), 'src', 'renderer', 'src', 'i18n', 'locales', 'en.json')
const QUOTED = String.raw`'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"`
const LITERAL_CHAIN = `(?:${QUOTED})(?:\\s*\\+\\s*(?:${QUOTED}))*`
const CALL_FALLBACK = new RegExp(
  String.raw`translateMain\(\s*['"]([\w.-]+)['"]\s*,\s*(${LITERAL_CHAIN})`,
  'g'
)
const TABLE_FALLBACK = new RegExp(
  String.raw`key:\s*['"]([\w.-]+)['"]\s*,\s*fallback:\s*(${LITERAL_CHAIN})`,
  'g'
)

type Fallback = { file: string; key: string; text: string }

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) {
      return productionSources(full)
    }
    return entry.name.endsWith('.ts') && !/\.test\.|test-fixture/.test(entry.name) ? [full] : []
  })
}

function literalText(chain: string): string {
  return [...chain.matchAll(new RegExp(QUOTED, 'g'))]
    .map(([quoted]) => JSON.parse(quoted.startsWith("'") ? toDoubleQuoted(quoted) : quoted))
    .join('')
}

function toDoubleQuoted(single: string): string {
  return `"${single.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"`
}

function literalFallbacks(): Fallback[] {
  return productionSources(MAIN_ROOT).flatMap((path) => {
    const source = readFileSync(path, 'utf8')
    if (!source.includes('translateMain(')) {
      return []
    }
    const file = relative(process.cwd(), path).split('\\').join('/')
    return [...source.matchAll(CALL_FALLBACK), ...source.matchAll(TABLE_FALLBACK)].map(
      ([, key, chain]) => ({ file, key, text: literalText(chain) })
    )
  })
}

function catalogValue(catalog: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    return node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
  }, catalog)
}

describe('main-process English fallbacks', () => {
  const fallbacks = literalFallbacks()
  const catalog: unknown = JSON.parse(readFileSync(EN_CATALOG, 'utf8'))

  it('finds the menu, tray, window and startup-failure fallbacks', () => {
    const keys = new Set(fallbacks.map((fallback) => fallback.key))
    for (const key of [
      'menu.exploreOrca',
      'rendererRecovery.title',
      'runtimeRpc.startupFailure.detail',
      'runtimeRpc.startupFailure.guidance.unknown',
      'tray.openOrca',
      'tray.minimizeNotice.body'
    ]) {
      expect(keys).toContain(key)
    }
    expect(fallbacks.length).toBeGreaterThan(40)
  })

  it('say exactly what the English catalog says', () => {
    const drift = fallbacks
      .filter((fallback) => {
        const value = catalogValue(catalog, fallback.key)
        return typeof value === 'string' && value !== fallback.text
      })
      .map((fallback) => `${fallback.file} ${fallback.key}: ${JSON.stringify(fallback.text)}`)
    expect(drift).toEqual([])
  })

  it('name NASH, not Orca, except the Orca Mobile phone app', () => {
    const orca = fallbacks
      .filter((fallback) => /\bOrca\b/.test(fallback.text.replace(/Orca Mobile/g, '')))
      .map((fallback) => `${fallback.file} ${fallback.key}`)
    expect(orca).toEqual([])
  })
})
