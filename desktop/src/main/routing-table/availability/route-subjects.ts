import type {
  Coordinator,
  Route,
  ValidationReviewer
} from '../../../shared/routing-table/routing-table-schema'
import { INHERIT } from '../../../shared/routing-table/routing-table-taxonomy'
import type { RouteSubject } from './route-availability-types'

/**
 * A table row as the concrete thing to check: `inherit` becomes the coordinator's value, and the row
 * says whether both fields were inherited (a workflow then sends nothing; the session already runs it).
 */
export function subjectForRoute(route: Route, coordinator: Coordinator): RouteSubject {
  const inheritsModel = route.model === INHERIT
  const inheritsLevel = route.reasoning_level === INHERIT
  return {
    target: route.execution_target,
    model: inheritsModel ? coordinator.model : route.model,
    reasoningLevel:
      route.reasoning_level === INHERIT ? coordinator.reasoning_level : route.reasoning_level,
    requirement: route.reasoning_requirement,
    inheritsCoordinator: inheritsModel && inheritsLevel
  }
}

/** The primary session's own launch configuration, which `inherit` rows resolve to. */
export function subjectForCoordinator(coordinator: Coordinator): RouteSubject {
  return {
    target: 'claude_primary',
    model: coordinator.model,
    reasoningLevel: coordinator.reasoning_level,
    requirement: 'required',
    inheritsCoordinator: false
  }
}

/** A validation reviewer (D-017) is a required route: a codex run, or a headless `claude -p` run. */
export function subjectForReviewer(reviewer: ValidationReviewer): RouteSubject {
  return {
    target: reviewer.target,
    model: reviewer.model,
    reasoningLevel: reviewer.reasoning_level,
    requirement: 'required',
    inheritsCoordinator: false
  }
}
