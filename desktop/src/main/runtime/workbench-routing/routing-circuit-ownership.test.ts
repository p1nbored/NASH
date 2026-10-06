import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The Clef call circuit has one owner (`getClefCallCircuit()`), so the credential-change listener
// lifts the same auth latch the verifier and the status view gate on.
const RUNTIME_ROOT = join(import.meta.dirname, '..')
const PRIVATE_CIRCUIT = /\bcreateClefCallCircuit\s*\(/
const TEST_FILE = /\.(?:test|test-fixture)\.ts$/

function routingSources(): string[] {
  const routing = readdirSync(join(RUNTIME_ROOT, 'workbench-routing'))
    .filter((name) => name.endsWith('.ts') && !TEST_FILE.test(name))
    .map((name) => join('workbench-routing', name))
  return [...routing, 'workbench-intake-submit.ts']
}

describe('Clef call circuit ownership', () => {
  it('never creates a private circuit in the routing modules or the intake door', () => {
    const offenders = routingSources().filter((path) =>
      PRIVATE_CIRCUIT.test(readFileSync(join(RUNTIME_ROOT, path), 'utf8'))
    )
    expect(offenders).toEqual([])
  })

  it('reads the circuit from its owner in the modules that gate, record and report status', () => {
    for (const path of [
      'workbench-routing/clef-verifier.ts',
      'workbench-routing/clef-verifier-refusals.ts',
      'workbench-routing/routing-status-reader.ts'
    ]) {
      expect(readFileSync(join(RUNTIME_ROOT, path), 'utf8')).toContain('getClefCallCircuit()')
    }
  })
})
