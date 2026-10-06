import type { WorkbenchDotIngressSettingsResult } from '../../../../shared/rpc-contract/workbench-dot-ingress-params'

// FIXTURE_ONLY dot settings answers for tests and the design harness. Workspace ids match the
// harness worktrees; every reference is synthetic.

export type DotWorkspaceFixture = WorkbenchDotIngressSettingsResult['workspaces'][number]

export const FIXTURE_DOT_REFS = {
  evidence: 'dws_0123456789abcdef01234567',
  receipt: 'dws_89abcdef0123456789abcdef',
  notes: 'dws_fedcba9876543210fedcba98'
} as const

export const FIXTURE_DOT_WORKSPACE_IDS = {
  evidence: 'fixture-repo-autopilot::C:/fixtures/autopilot/feature-evidence-contracts',
  receipt: 'fixture-repo-autopilot::C:/fixtures/autopilot/fix-receipt-parser',
  notes: 'fixture-repo-field-notes::C:/fixtures/field-notes/main'
} as const

export function fixtureDotWorkspace(
  overrides: Partial<DotWorkspaceFixture> = {}
): DotWorkspaceFixture {
  return {
    workspaceRef: FIXTURE_DOT_REFS.evidence,
    workspaceId: FIXTURE_DOT_WORKSPACE_IDS.evidence,
    label: 'autopilot: feature-evidence-contracts',
    enabled: true,
    maxAccess: 'read_only',
    ...overrides
  }
}

/**
 * One read-only, one workspace-write and one turned-off workspace. The off one keeps its stored
 * workspace_write ceiling, as the store does on disable, so a re-enable must lower it.
 */
export function fixtureMixedDotWorkspaces(): DotWorkspaceFixture[] {
  return [
    fixtureDotWorkspace(),
    fixtureDotWorkspace({
      workspaceRef: FIXTURE_DOT_REFS.receipt,
      workspaceId: FIXTURE_DOT_WORKSPACE_IDS.receipt,
      label: 'autopilot: fix-receipt-parser',
      maxAccess: 'workspace_write'
    }),
    fixtureDotWorkspace({
      workspaceRef: FIXTURE_DOT_REFS.notes,
      workspaceId: FIXTURE_DOT_WORKSPACE_IDS.notes,
      label: 'field-notes: main',
      enabled: false,
      maxAccess: 'workspace_write'
    })
  ]
}

/** The interface is off, with the default caps and no workspace, unless overridden. */
export function fixtureDotSettings(
  overrides: Partial<WorkbenchDotIngressSettingsResult> = {}
): WorkbenchDotIngressSettingsResult {
  return {
    enabled: false,
    connection: 'not_connected',
    listening: false,
    failure: null,
    rateLimits: { ratePerMinute: 6, ratePerUtcDay: 100 },
    updatedAt: null,
    workspaces: [],
    ...overrides
  }
}

export function fixtureListeningDotSettings(
  overrides: Partial<WorkbenchDotIngressSettingsResult> = {}
): WorkbenchDotIngressSettingsResult {
  return fixtureDotSettings({
    enabled: true,
    listening: true,
    updatedAt: '2026-10-05T09:30:00.000Z',
    workspaces: [fixtureDotWorkspace()],
    ...overrides
  })
}
