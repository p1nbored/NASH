import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from './orchestration-db'
import { ensureDotIngressSchema } from './dot-ingress-schema'
import { getDotIngressSettingsStore } from './dot-ingress-settings-store'
import {
  DOT_WORKSPACE_ACCESS_DEFINITION,
  readDotWorkspaceMaxAccess
} from './dot-ingress-workspace-access'
import {
  FIXTURE_BINDING,
  FIXTURE_WORKSPACE_ID,
  errorCodeOf,
  fixtureTime
} from './dot-ingress.test-fixture'

// The per-workspace access ceiling (default read_only, set when the user enables a workspace for dot).
// Absent means read_only, so the table is created only once a user raises a ceiling.

function tableExists(owner: OrchestrationDb): boolean {
  return (
    owner.db
      .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get('dot_ingress_workspace_access') !== undefined
  )
}

describe('dot ingress workspace access ceiling', () => {
  let owner: OrchestrationDb
  beforeEach(() => {
    owner = new OrchestrationDb(':memory:')
  })
  afterEach(() => owner.close())

  function enable(overrides: Record<string, unknown> = {}, at = 0) {
    return getDotIngressSettingsStore(owner).enableWorkspace({
      workspaceId: FIXTURE_WORKSPACE_ID,
      workspaceBinding: FIXTURE_BINDING,
      label: 'fixture-repo',
      timestamp: fixtureTime(at),
      ...overrides
    })
  }

  it('defaults to read_only and creates nothing for a default ceiling', () => {
    const { workspace } = enable()
    expect(getDotIngressSettingsStore(owner).getWorkspaceMaxAccess(workspace.workspaceRef)).toBe(
      'read_only'
    )
    expect(tableExists(owner)).toBe(false)
  })

  it('reads read_only for a workspace reference it never saw', () => {
    ensureDotIngressSchema(owner.db)
    expect(readDotWorkspaceMaxAccess(owner.db, `dws_${'0'.repeat(24)}`)).toBe('read_only')
  })

  it('stores a raised ceiling with the enable, in the exact layout', () => {
    const { workspace, changed } = enable({ maxAccess: 'workspace_write' })
    expect(changed).toBe(true)
    expect(getDotIngressSettingsStore(owner).getWorkspaceMaxAccess(workspace.workspaceRef)).toBe(
      'workspace_write'
    )
    const stored = owner.db
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'dot_ingress_workspace_access'")
      .get()
    expect(String(stored?.sql).replace(/\s+/g, ' ').trim()).toBe(
      DOT_WORKSPACE_ACCESS_DEFINITION.replace(/\s+/g, ' ').trim()
    )
  })

  it('sets the ceiling again on every enable: omitting it lowers it back to read_only', () => {
    const { workspace } = enable({ maxAccess: 'workspace_write' })
    const again = enable({}, 5)
    expect(again.changed).toBe(true)
    expect(again.workspace.workspaceRef).toBe(workspace.workspaceRef)
    expect(getDotIngressSettingsStore(owner).getWorkspaceMaxAccess(workspace.workspaceRef)).toBe(
      'read_only'
    )
    const kinds = getDotIngressSettingsStore(owner)
      .listEvents({ limit: 10 })
      .map((event) => event.kind)
    expect(kinds.filter((kind) => kind === 'workspace_enabled')).toHaveLength(2)
  })

  it('reports no change when the same workspace is enabled again with the same ceiling', () => {
    enable({ maxAccess: 'workspace_write' })
    expect(enable({ maxAccess: 'workspace_write' }, 5).changed).toBe(false)
    expect(enable({}, 6).changed).toBe(true)
    expect(enable({}, 7).changed).toBe(false)
  })

  it('keeps the ceiling while a workspace is disabled, and re-enabling sets it anew', () => {
    const { workspace } = enable({ maxAccess: 'workspace_write' })
    const store = getDotIngressSettingsStore(owner)
    store.disableWorkspace({ workspaceRef: workspace.workspaceRef, timestamp: fixtureTime(3) })
    expect(store.getWorkspaceMaxAccess(workspace.workspaceRef)).toBe('workspace_write')
    enable({ maxAccess: 'read_only' }, 4)
    expect(store.getWorkspaceMaxAccess(workspace.workspaceRef)).toBe('read_only')
  })

  it('refuses an unknown ceiling value and changes nothing', () => {
    expect(errorCodeOf(() => enable({ maxAccess: 'admin' }))).toBe('dot_invalid_input')
    expect(getDotIngressSettingsStore(owner).listWorkspaces()).toEqual([])
  })

  it('fails closed on a drifted ceiling table, for reads and for enables', () => {
    const { workspace } = enable({ maxAccess: 'workspace_write' })
    owner.db.exec('DROP TABLE dot_ingress_workspace_access')
    owner.db.exec('CREATE TABLE dot_ingress_workspace_access (workspace_ref TEXT, max_access TEXT)')
    const store = getDotIngressSettingsStore(owner)
    expect(errorCodeOf(() => store.getWorkspaceMaxAccess(workspace.workspaceRef))).toBe(
      'dot_recovery_required'
    )
    expect(errorCodeOf(() => enable({ maxAccess: 'workspace_write' }, 9))).toBe(
      'dot_recovery_required'
    )
  })

  it('rolls the enable back when the ceiling cannot be stored', () => {
    owner.db.exec('CREATE TABLE dot_ingress_workspace_access (workspace_ref TEXT)')
    expect(errorCodeOf(() => enable({ maxAccess: 'workspace_write' }))).toBe(
      'dot_recovery_required'
    )
    expect(getDotIngressSettingsStore(owner).listWorkspaces()).toEqual([])
  })

  it('refuses a malformed reference on read', () => {
    expect(
      errorCodeOf(() => getDotIngressSettingsStore(owner).getWorkspaceMaxAccess('../etc'))
    ).toBe('dot_invalid_input')
  })
})
