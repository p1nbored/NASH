import type { RoutingTableContext } from '../../routing-table/routing-table-context'
import type { OrcaRuntimeService } from '../orca-runtime'
import { OrchestrationError } from '../orchestration/orchestration-error'
import type { RoutingTableAvailabilitySource } from './routing-table-availability-view'

type Registration = {
  readonly ctx: RoutingTableContext
  readonly availability: RoutingTableAvailabilitySource | null
}

const registrationByRuntime = new WeakMap<OrcaRuntimeService, Registration>()

/**
 * Startup wiring (package E1) registers the same routing-table context the resolver reads, and the
 * resolver whose availability the Settings screen shows; returns the unregister. A second context for
 * one runtime is a wiring bug.
 */
export function registerRoutingTableContext(
  runtime: OrcaRuntimeService,
  ctx: RoutingTableContext,
  availability?: RoutingTableAvailabilitySource
): () => void {
  if (registrationByRuntime.has(runtime)) {
    throw new Error('A routing table context is already registered for this runtime.')
  }
  const registration: Registration = { ctx, availability: availability ?? null }
  registrationByRuntime.set(runtime, registration)
  return () => {
    if (registrationByRuntime.get(runtime) === registration) {
      registrationByRuntime.delete(runtime)
    }
  }
}

/** Until the table is installed, every desktop table method refuses; nothing falls back to a default. */
export function requireRoutingTableContext(runtime: OrcaRuntimeService): RoutingTableContext {
  const registration = registrationByRuntime.get(runtime)
  if (!registration) {
    throw new OrchestrationError(
      'workbench_routing_table_unavailable',
      'The routing table is not available in this session.'
    )
  }
  return registration.ctx
}

/** The route availability source, or null when none was installed with the table. */
export function routingTableAvailabilityOf(
  runtime: OrcaRuntimeService
): RoutingTableAvailabilitySource | null {
  return registrationByRuntime.get(runtime)?.availability ?? null
}

/** "Check now" needs the availability checks; without them it refuses instead of guessing. */
export function requireRoutingTableAvailability(
  runtime: OrcaRuntimeService
): RoutingTableAvailabilitySource {
  const availability = routingTableAvailabilityOf(runtime)
  if (availability === null) {
    throw new OrchestrationError(
      'workbench_route_availability_unavailable',
      'Route availability checks are not available in this session.'
    )
  }
  return availability
}
