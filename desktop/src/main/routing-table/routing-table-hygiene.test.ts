import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The table is a configuration asset: routing code never reads benchmark evidence, the folder
// comes from an injected port, and nothing here reaches the network or the Electron runtime.
const SRC_ROOT = join(import.meta.dirname, '..', '..')
const SCOPE_DIRS = ['main/routing-table', 'shared/routing-table']
const TEST_PATH = /(?:\.test\.ts$|\.test-fixture\.ts$)/
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g
const LINE_COMMENT = /(^|\s)\/\/[^\n]*/g
// Why: only these two files define the informational fields, so no other module can read them.
const INFORMATIONAL_OWNERS = new Set([
  'shared/routing-table/routing-table-schema.ts',
  'shared/routing-table/routing-table-proposal-schema.ts'
])

function productionFiles(): string[] {
  const files = SCOPE_DIRS.flatMap((dir) =>
    readdirSync(join(SRC_ROOT, dir)).map((name) => `${dir}/${name}`)
  )
  return [...files, 'shared/english-text.ts'].filter(
    (path) => path.endsWith('.ts') && !TEST_PATH.test(path)
  )
}

function codeOf(path: string): string {
  return readFileSync(join(SRC_ROOT, path), 'utf8')
    .replace(BLOCK_COMMENT, '')
    .replace(LINE_COMMENT, '$1')
}

describe('routing table source hygiene', () => {
  const files = productionFiles()

  it('scans the modules this package owns', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'main/routing-table/routing-table-activation.ts',
        'main/routing-table/routing-table-bundle.ts',
        'main/routing-table/routing-table-file-store.ts',
        'main/routing-table/routing-table-proposals.ts',
        'shared/routing-table/routing-table-schema.ts',
        'shared/routing-table/model-pin-policy.ts'
      ])
    )
  })

  it('never reads benchmark evidence or notes in routing logic', () => {
    const readers = files
      .filter((path) => !INFORMATIONAL_OWNERS.has(path))
      .filter((path) =>
        /benchmark_(?:sources|snapshot_date)|\.notes\b|\bnotes\s*:/.test(codeOf(path))
      )
    expect(readers).toEqual([])
  })

  it('names no application or upstream folder: the user data path comes from the injected port', () => {
    const named = files.filter((path) => /\b(?:orca|nash)\b/i.test(codeOf(path)))
    expect(named).toEqual([])
    expect(
      readFileSync(join(SRC_ROOT, 'main/routing-table/default-routing-table.json'), 'utf8')
    ).not.toMatch(/\b(?:orca|nash)\b/i)
  })

  it('does not import Electron, spawn processes or open the network', () => {
    const offenders = files.filter((path) =>
      /from\s+['"](?:electron|node:child_process|node:http|node:https|node:net|child_process)['"]|\bfetch\s*\(|\bapp\.getPath\b/.test(
        codeOf(path)
      )
    )
    expect(offenders).toEqual([])
  })

  it('keeps the model pin policy and English check as the only copies', () => {
    const copies = files.filter((path) => /MODEL_ID_SYNTAX|ENGLISH_TEXT\s*=/.test(codeOf(path)))
    expect(copies.sort()).toEqual([
      'shared/english-text.ts',
      'shared/routing-table/model-pin-policy.ts'
    ])
  })
})
