import type { RoutingStatus } from '../../../shared/clef/clef-route-contract'
import { getClefCallCircuit } from '../../clef/clef-call-circuit-owner'
import type { ClefCredentialGeneration } from '../../clef/clef-credential-generation'
import { evaluateClefConfiguration, type RouteConfigurationDeps } from './route-configuration-gate'

export type RoutingStatusDeps = RouteConfigurationDeps & {
  readonly credentials: RouteConfigurationDeps['credentials'] & {
    generation(): ClefCredentialGeneration
  }
}

/**
 * The fail-closed routing status from local state only: the G0 configuration first, then the
 * latches, the circuit and the last outcome. Never a network call, so status keeps working in an outage.
 */
export function readRoutingStatus(deps: RoutingStatusDeps): RoutingStatus {
  const configured = evaluateClefConfiguration(deps, deps.verifiedProfile.read())
  if (!configured.passed) {
    return configured.routingStatus
  }
  const circuit = getClefCallCircuit().snapshot(deps.credentials.generation())
  if (circuit.authFailed) {
    return 'auth_failed'
  }
  if (circuit.quotaLatchedUntil !== null) {
    return 'quota_latched'
  }
  if (circuit.circuit === 'open') {
    return 'circuit_open'
  }
  return circuit.consecutiveTransient > 0 ? 'unreachable' : 'ready'
}
