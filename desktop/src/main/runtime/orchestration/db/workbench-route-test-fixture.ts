import { randomUUID } from 'node:crypto'
import type { WorkbenchLocalWorkspace } from '../../workbench-local-workspace'

// FIXTURE_ONLY: synthetic Workbench scope for persistence tests; no real account or credential.
export const routeFixtureWorkspace: WorkbenchLocalWorkspace = {
  workspaceId: 'folder:fixture-route',
  projectId: 'fixture-group',
  projectKind: 'folder-group',
  hostId: 'local',
  path: '/fixture/route'
}
export const routeFixturePrincipal = 'fixture-ui'

export function routeFixtureSubmitInput(objective = 'Route this fixture request.') {
  return { workspaceId: routeFixtureWorkspace.workspaceId, objective, idempotencyKey: randomUUID() }
}
