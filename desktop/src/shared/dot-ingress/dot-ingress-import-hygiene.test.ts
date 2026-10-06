import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SHARED_DIR = __dirname
const DB_DIR = join(SHARED_DIR, '../../main/runtime/orchestration/db')

function sourceFiles(directory: string, prefix: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.ts'))
    .filter((name) => !name.endsWith('.test.ts') && !name.endsWith('.test-fixture.ts'))
    .sort()
    .map((name) => join(directory, name))
}

function importSpecifiers(file: string): string[] {
  const text = readFileSync(file, 'utf8')
  return [...text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/g)].map(
    (match) => match[1] ?? ''
  )
}

const SHARED_FILES = sourceFiles(SHARED_DIR, 'dot-ingress-')
const DB_FILES = sourceFiles(DB_DIR, 'dot-ingress-')

// The structural "dot cannot reach paid calls, the desktop caller or Orca internals" guarantee.
const FORBIDDEN_IN_DB = [
  'electron',
  'clef-transport',
  'clef-sealed-credential-store',
  'workbench-route-store',
  'workbench-request-router',
  'workbench-routing',
  'http-client',
  'child-process',
  'workbench-caller'
]

describe('dot ingress contract imports', () => {
  it('finds the files it is meant to police', () => {
    expect(SHARED_FILES.length).toBeGreaterThanOrEqual(8)
    expect(DB_FILES.length).toBeGreaterThanOrEqual(9)
    expect(SHARED_FILES.some((file) => file.endsWith('dot-ingress-params.ts'))).toBe(true)
    expect(DB_FILES.some((file) => file.endsWith('dot-ingress-store.ts'))).toBe(true)
  })

  it.each(SHARED_FILES.map((file) => [file.slice(SHARED_DIR.length + 1), file]))(
    '%s imports only zod, node:path, the shared language modules and its siblings',
    (_name, file) => {
      for (const specifier of importSpecifiers(file)) {
        const allowed =
          specifier === 'zod' ||
          specifier === 'node:path' ||
          specifier === '../workbench-request' ||
          specifier === '../verbatim-spans' ||
          specifier === '../deliverable-language' ||
          /^\.\/dot-ingress-[a-z0-9-]+$/.test(specifier)
        expect(allowed, `${file} imports ${specifier}`).toBe(true)
      }
    }
  )

  it('keeps node:path out of every shared dot-ingress file except the discovery-file path', () => {
    for (const file of SHARED_FILES) {
      const usesNodePath = importSpecifiers(file).includes('node:path')
      expect(usesNodePath, file).toBe(file.endsWith('dot-ingress-metadata.ts'))
    }
  })

  it.each(DB_FILES.map((file) => [file.slice(DB_DIR.length + 1), file]))(
    '%s imports no transport, credential, router, Workbench caller or electron module',
    (_name, file) => {
      for (const specifier of importSpecifiers(file)) {
        for (const forbidden of FORBIDDEN_IN_DB) {
          expect(specifier.includes(forbidden), `${file} imports ${specifier}`).toBe(false)
        }
      }
    }
  )

  it('does not write the Orca, Workbench or autopilot tables: the db files name no foreign table in a write', () => {
    const foreignTables = [
      'workbench_requests',
      'workbench_clef_spend',
      'workflow_runs',
      'primary_sessions',
      'permission_decisions',
      'runs',
      'tasks',
      'messages'
    ]
    for (const file of DB_FILES) {
      const text = readFileSync(file, 'utf8')
      for (const table of foreignTables) {
        const writes = new RegExp(`(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`, 'i')
        expect(writes.test(text), `${file} writes ${table}`).toBe(false)
      }
    }
  })

  it('has no electron import anywhere in the dot ingress files', () => {
    for (const file of [...SHARED_FILES, ...DB_FILES]) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/from ['"]electron['"]/)
    }
  })

  it('has no confirmation vocabulary left in the contract or the stores', () => {
    for (const file of [...SHARED_FILES, ...DB_FILES]) {
      const text = readFileSync(file, 'utf8')
      // The only mentions allowed are the explicit "no confirmation" statements.
      const lines = text
        .split(/\r?\n/)
        .filter((line) =>
          /awaiting_confirmation|beginConfirmation|completeConfirmation|confirming/.test(line)
        )
      expect(lines, file).toEqual([])
    }
  })
})
