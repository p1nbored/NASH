import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClefCallCircuit } from './clef-call-circuit'
import {
  getClefCallCircuit,
  liftClefAuthLatchForCurrentCredentials,
  setClefCallCircuit
} from './clef-call-circuit-owner'
import { ClefCredentialGeneration } from './clef-credential-generation'
import { setClefCredentialSource, type ClefCredentialSource } from './clef-credential-port'

const T0 = Date.parse('2026-10-04T12:00:00.000Z')

function sourceWithGeneration(read: () => ClefCredentialGeneration): ClefCredentialSource {
  return {
    status: () => ({ tokenPresent: true, accountPresent: true, protection: 'sealed' }),
    read: () => null,
    generation: read
  }
}

describe('clef call circuit owner', () => {
  afterEach(() => {
    setClefCallCircuit(null)
    setClefCredentialSource(null)
  })

  it('hands every caller the same circuit', () => {
    expect(getClefCallCircuit()).toBe(getClefCallCircuit())
  })

  it('serves an installed circuit and creates a fresh one after a reset', () => {
    const installed = createClefCallCircuit({ now: () => T0 })
    setClefCallCircuit(installed)
    expect(getClefCallCircuit()).toBe(installed)

    setClefCallCircuit(null)
    expect(getClefCallCircuit()).not.toBe(installed)
  })

  it('lifts an auth latch once the credential source reports a new generation', () => {
    const circuit = createClefCallCircuit({ now: () => T0 })
    setClefCallCircuit(circuit)
    const failed = ClefCredentialGeneration.mint()
    let current = failed
    setClefCredentialSource(sourceWithGeneration(() => current))
    circuit.record('auth_failed', failed)

    liftClefAuthLatchForCurrentCredentials()
    expect(circuit.snapshot(failed).authFailed).toBe(true)

    current = ClefCredentialGeneration.mint()
    liftClefAuthLatchForCurrentCredentials()
    expect(circuit.snapshot(failed).authFailed).toBe(false)
  })

  it('reads the generation at call time, not when the listener was created', () => {
    const liftAuthLatch = vi.fn()
    setClefCallCircuit({ ...createClefCallCircuit({ now: () => T0 }), liftAuthLatch })
    const later = ClefCredentialGeneration.mint()
    setClefCredentialSource(sourceWithGeneration(() => later))

    liftClefAuthLatchForCurrentCredentials()

    expect(liftAuthLatch).toHaveBeenCalledWith(later)
  })
})
