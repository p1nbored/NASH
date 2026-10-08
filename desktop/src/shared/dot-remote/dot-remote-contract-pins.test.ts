import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DOT_INGRESS_CONTRACT_V3_GOLDEN_FILE,
  DOT_INGRESS_CONTRACT_V3_GOLDEN_SHA256
} from './dot-remote-contract-pins'

const CONTRACT_DIR = join(__dirname, '../dot-ingress')

function fileSha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function importSpecifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  return [...text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/g)].map(
    (match) => match[1] ?? ''
  )
}

describe('the v3 golden the remote contract is generated against', () => {
  it('pins the v3 golden by path and hash', () => {
    expect(DOT_INGRESS_CONTRACT_V3_GOLDEN_FILE).toBe(
      'src/shared/dot-ingress/dot-ingress-contract-v3.schema.json'
    )
    expect(fileSha256(join(CONTRACT_DIR, 'dot-ingress-contract-v3.schema.json'))).toBe(
      DOT_INGRESS_CONTRACT_V3_GOLDEN_SHA256
    )
  })
})

describe('dot remote contract imports', () => {
  const sources = readdirSync(__dirname)
    .filter(
      (name) =>
        name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.test-fixture.ts')
    )
    .sort()

  it('finds the files it is meant to police', () => {
    expect(sources).toContain('dot-remote-inbox.ts')
    expect(sources).toContain('dot-remote-manifest.ts')
    expect(sources.length).toBeGreaterThanOrEqual(12)
  })

  it.each(sources)(
    '%s imports only zod, node:crypto, the dot ingress contract and its siblings',
    (name) => {
      for (const specifier of importSpecifiers(join(__dirname, name))) {
        const allowed =
          specifier === 'zod' ||
          specifier === 'node:crypto' ||
          specifier === '../canonical-json' ||
          specifier === '../english-text' ||
          specifier === '../workbench-request' ||
          /^\.\.\/dot-ingress\/dot-ingress-[a-z0-9-]+$/.test(specifier) ||
          /^\.\/dot-remote-[a-z-]+$/.test(specifier)
        expect(allowed, `${name} imports ${specifier}`).toBe(true)
      }
    }
  )
})
