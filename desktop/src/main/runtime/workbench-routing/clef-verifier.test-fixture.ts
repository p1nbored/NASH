// FIXTURE_ONLY: in-memory harness for Clef verifier tests; production code never imports this.
// The transport is a scripted fake and the profile store records writes in memory: no network, no
// real credentials and no file system.

import { vi, type Mock } from 'vitest'
import type { RoutingStatus } from '../../../shared/clef/clef-route-contract'
import { CLEF_SCHEMA_PINS } from '../../clef/clef-schema-pins'
import {
  clefVerifiedProfileHash,
  type ClefVerifiedProfile,
  type ClefVerifiedProfileRecord
} from '../../clef/clef-verified-profile'
import { createClefVerifier, type ClefVerifier } from './clef-verifier'
import {
  createRuntimeHarness,
  type RuntimeHarness,
  type RuntimeHarnessOptions
} from './workbench-runtime.test-fixture'

export type VerifierHarness = {
  readonly harness: RuntimeHarness
  readonly verifier: ClefVerifier
  /** Every profile the verifier wrote, in order. */
  readonly writes: ClefVerifiedProfile[]
  readonly writeProfile: Mock<(profile: ClefVerifiedProfile) => ClefVerifiedProfileRecord>
  readonly failures: unknown[]
  setRoutingStatus(status: RoutingStatus): void
  close(): void
}

export function createVerifierHarness(options: RuntimeHarnessOptions = {}): VerifierHarness {
  const harness = createRuntimeHarness(options)
  const writes: ClefVerifiedProfile[] = []
  const failures: unknown[] = []
  let routingStatus: RoutingStatus = 'ready'
  const writeProfile = vi.fn((profile: ClefVerifiedProfile): ClefVerifiedProfileRecord => {
    writes.push(profile)
    return { profile, profileHash: clefVerifiedProfileHash(profile) }
  })
  const verifier = createClefVerifier({
    credentials: harness.credentials,
    ledger: harness.ledger,
    spend: harness.routes.spend,
    transport: harness.transport,
    aborts: harness.aborts,
    clock: { now: () => harness.clock.ms },
    profileStore: { write: writeProfile },
    schemaPins: CLEF_SCHEMA_PINS,
    routingStatus: () => routingStatus,
    onFailure: (error) => failures.push(error)
  })
  return {
    harness,
    verifier,
    writes,
    writeProfile,
    failures,
    setRoutingStatus: (status) => {
      routingStatus = status
    },
    close: () => harness.close()
  }
}
