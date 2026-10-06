import type { WorkbenchDotIngressSettingsResult } from '../../../src/shared/rpc-contract/workbench-dot-ingress-params'
import {
  fixtureDotSettings,
  fixtureDotWorkspace,
  fixtureListeningDotSettings,
  fixtureMixedDotWorkspaces
} from '../../../src/renderer/src/components/settings/dot-ingress-settings.test-fixture'
import type { SettingsFixtureReply } from './scenario-settings-routing-table'

// FIXTURE_ONLY dot settings answers (`?dot=`). The workbench.dotIngress methods are not registered
// in the app until package E1; this state lives in the page and is lost on reload.
export const DOT_FIXTURE_VARIANTS = [
  'off',
  'listening',
  'listenFailed',
  'metadataInvalid',
  'metadataWriteFailed',
  'metadataNotSecured',
  'noWorkspaces',
  'mixedAccess',
  'refusals',
  'notConnected'
] as const
export type DotFixtureVariant = (typeof DOT_FIXTURE_VARIANTS)[number]

type Settings = WorkbenchDotIngressSettingsResult
type Failure = NonNullable<Settings['failure']>

const FAILURE_BY_VARIANT: Partial<Record<DotFixtureVariant, Failure>> = {
  listenFailed: 'listen_failed',
  metadataInvalid: 'metadata_invalid',
  metadataWriteFailed: 'metadata_write_failed',
  metadataNotSecured: 'metadata_not_secured'
}

export function readDotFixtureVariant(search: string): DotFixtureVariant {
  const value = new URLSearchParams(search).get('dot')
  return DOT_FIXTURE_VARIANTS.find((variant) => variant === value) ?? 'off'
}

function initialSettings(variant: DotFixtureVariant): Settings {
  switch (variant) {
    case 'off':
      return fixtureDotSettings({ workspaces: [fixtureDotWorkspace()] })
    case 'listenFailed':
    case 'metadataInvalid':
    case 'metadataWriteFailed':
    case 'metadataNotSecured':
      return fixtureListeningDotSettings({
        listening: false,
        failure: FAILURE_BY_VARIANT[variant] ?? null
      })
    case 'noWorkspaces':
      return fixtureListeningDotSettings({ workspaces: [] })
    case 'mixedAccess':
      return fixtureListeningDotSettings({
        rateLimits: { ratePerMinute: 10, ratePerUtcDay: 250 },
        workspaces: fixtureMixedDotWorkspaces()
      })
    case 'refusals':
      // Why off: the switch refusal means no endpoint control exists, so nothing can be listening.
      return fixtureDotSettings({ workspaces: fixtureMixedDotWorkspaces() })
    case 'listening':
    case 'notConnected':
      return fixtureListeningDotSettings()
  }
}

function refused(code: string): SettingsFixtureReply {
  return { ok: false, code, message: `FIXTURE_ONLY ${code}` }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {}
}

/** A synthetic reference per workspace id, shaped like the store's `dws_` + 24 hex. */
function fixtureRef(workspaceId: string): string {
  let hash = 0
  for (const character of workspaceId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }
  return `dws_${hash.toString(16).padStart(8, '0').repeat(3)}`
}

function withWorkspace(settings: Settings, params: Record<string, unknown>): Settings {
  const workspaceId = String(params.workspaceId)
  const entry = {
    workspaceRef:
      settings.workspaces.find((item) => item.workspaceId === workspaceId)?.workspaceRef ??
      fixtureRef(workspaceId),
    workspaceId,
    label: String(params.label),
    enabled: true,
    maxAccess:
      params.maxAccess === 'workspace_write' ? ('workspace_write' as const) : ('read_only' as const)
  }
  const exists = settings.workspaces.some((item) => item.workspaceId === workspaceId)
  return {
    ...settings,
    workspaces: exists
      ? settings.workspaces.map((item) => (item.workspaceId === workspaceId ? entry : item))
      : [...settings.workspaces, entry]
  }
}

function switched(variant: DotFixtureVariant, settings: Settings, enabled: boolean): Settings {
  const failure = enabled ? (FAILURE_BY_VARIANT[variant] ?? null) : null
  return { ...settings, enabled, listening: enabled && failure === null, failure }
}

export function createDotFixture(
  variant: DotFixtureVariant
): (method: string, params: unknown) => SettingsFixtureReply | null {
  let settings = initialSettings(variant)
  const ok = (): SettingsFixtureReply => ({ ok: true, result: settings })
  return (method, params) => {
    if (!method.startsWith('workbench.dotIngress.')) {
      return null
    }
    if (variant === 'notConnected') {
      return refused('method_not_found')
    }
    const input = record(params)
    switch (method) {
      case 'workbench.dotIngress.settings.get':
        return ok()
      case 'workbench.dotIngress.settings.setEnabled':
        if (variant === 'refusals') {
          // Why: the real handler saves the switch before the endpoint refuses to start.
          settings = { ...settings, enabled: input.enabled === true, listening: false }
          return refused('workbench_dot_ingress_unavailable')
        }
        settings = switched(variant, settings, input.enabled === true)
        return ok()
      case 'workbench.dotIngress.settings.setRateLimits':
        if (variant === 'refusals') {
          return refused('dot_transaction_unavailable')
        }
        settings = {
          ...settings,
          rateLimits: {
            ratePerMinute: Number(input.ratePerMinute),
            ratePerUtcDay: Number(input.ratePerUtcDay)
          }
        }
        return ok()
      case 'workbench.dotIngress.workspaces.enable':
        if (variant === 'refusals') {
          return refused('unsupported_host')
        }
        settings = withWorkspace(settings, input)
        return ok()
      case 'workbench.dotIngress.workspaces.disable':
        if (variant === 'refusals') {
          return refused('dot_workspace_unknown')
        }
        settings = {
          ...settings,
          workspaces: settings.workspaces.map((item) =>
            item.workspaceRef === input.workspaceRef ? { ...item, enabled: false } : item
          )
        }
        return ok()
      default:
        return refused('method_not_found')
    }
  }
}
