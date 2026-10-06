import type { GlobalSettings } from '../../shared/global-settings-types'
import { nativeChatShellEnvironmentPolicy } from '../../shared/native-chat-shell-environment'
import { resolveTuiAgentLaunchEnv } from '../../shared/tui-agent-launch-defaults'
import type { LaunchTarget } from '../agent-exec-shared/launch-target'
import { resolveAgyExecutable, type AgyExecutable } from '../agy-exec/agy-exec-executable'
import { claudeStructuredAuthPolicy } from '../claude-accounts/claude-structured-auth-policy'
import {
  createClaudeModelCatalogProbe,
  type ClaudeModelCatalogProbeDeps
} from '../claude/claude-model-catalog-probe'
import {
  createCodexModelCatalogProbe,
  type CodexModelCatalogProbeDeps
} from '../codex/codex-model-catalog-probe'
import { resolveCodexExecutable, type CodexExecutable } from '../codex-exec/codex-exec-executable'
import { detectInstalledAgentsWithShellPathHydration } from '../preflight/agent-detection'
import {
  modelListingPortFromDiscovery,
  modelListingPortFromProbe,
  type CatalogProbeSuccess
} from '../routing-table/availability/model-listing'
import type { RateLimitHeadroomState } from '../routing-table/availability/route-provider-headroom'
import { USAGE_METER_SOURCE } from '../rate-limits/usage-meters-policy'
import {
  createStructuredAgentEnvironmentResolvers,
  type StructuredAgentEnvironmentSources
} from '../runtime/structured-agent-shell-environment'
import { discoverCommitMessageModelsLocal } from '../text-generation/commit-message-text-generation'
import type { DiscoverCommitMessageModelsResult } from '../text-generation/source-control-text-generation-types'
import type { AutopilotHostPorts } from './autopilot-runtime-builders'
import { resolveClaudeLaunchTarget } from './autopilot-claude-launch-target'

// The running app's services as the routing table and the executors see them. Every port is lazy:
// the login-shell snapshot, the catalog probes and the executable lookups run only when a route is
// checked or a task starts, never at startup (D-016 E1: nothing live at startup).

type EnvironmentResolvers = ReturnType<typeof createStructuredAgentEnvironmentResolvers>
type ProbeOf<Deps> = (deps: Deps) => (accountHomePath: string) => Promise<CatalogProbeSuccess>

/** The producers, replaceable in tests; production binds Orca's own. */
export type AutopilotHostSeams = {
  readonly detectInstalled: () => Promise<readonly string[]>
  readonly createEnvironmentResolvers: (
    sources: StructuredAgentEnvironmentSources
  ) => EnvironmentResolvers
  readonly createClaudeProbe: ProbeOf<ClaudeModelCatalogProbeDeps>
  readonly createCodexProbe: ProbeOf<CodexModelCatalogProbeDeps>
  readonly discoverModels: (env: NodeJS.ProcessEnv) => Promise<DiscoverCommitMessageModelsResult>
  readonly resolveCodexExecutable: () => CodexExecutable
  readonly resolveAgyExecutable: () => AgyExecutable
  readonly resolveClaudeLaunchTarget: () => LaunchTarget | null
}

const PRODUCTION_SEAMS: AutopilotHostSeams = {
  detectInstalled: () => detectInstalledAgentsWithShellPathHydration(),
  createEnvironmentResolvers: createStructuredAgentEnvironmentResolvers,
  createClaudeProbe: createClaudeModelCatalogProbe,
  createCodexProbe: createCodexModelCatalogProbe,
  discoverModels: (env) => discoverCommitMessageModelsLocal('antigravity', env),
  // Why installed: the vendor launcher is what `codex` runs in a shell (D-023).
  resolveCodexExecutable: () => resolveCodexExecutable({ kind: 'installed' }),
  resolveAgyExecutable: () => resolveAgyExecutable({}),
  resolveClaudeLaunchTarget: () => resolveClaudeLaunchTarget()
}

export type AutopilotHostSettings = Pick<
  GlobalSettings,
  | 'disabledTuiAgents'
  | 'agentDefaultEnv'
  | 'nativeChatInheritShellEnvironment'
  | 'nativeChatShellEnvironmentVariables'
>

/** Orca's rate-limit service as the routing table sees it. */
export type AutopilotRateLimitSource = {
  getState(): RateLimitHeadroomState
  refresh(): Promise<unknown>
  /** The selected Claude or Codex account changed; returns the unsubscribe. */
  onAccountChange(listener: (provider: 'claude' | 'codex') => void): () => void
}

export type AutopilotHostSources = {
  /** `runtime.resolveStructuredAgentAccountHome`: the home a structured launch would pin now. */
  readonly runtime: {
    resolveStructuredAgentAccountHome(agent: 'claude' | 'codex'): Promise<{ path: string }>
  }
  /** The persisted settings, re-read on every use. */
  readonly settings: () => AutopilotHostSettings
  /** The rate-limit service, or null while none is running. */
  readonly rateLimits: () => AutopilotRateLimitSource | null
  readonly now?: () => number
  readonly seams?: Partial<AutopilotHostSeams>
}

/** Memoizes a factory on first use, so nothing it starts runs before a route is checked. */
function onFirstUse<T>(create: () => T): () => T {
  let value: { readonly current: T } | null = null
  return () => {
    value ??= { current: create() }
    return value.current
  }
}

export function createAutopilotHostPorts(sources: AutopilotHostSources): AutopilotHostPorts {
  const seams = { ...PRODUCTION_SEAMS, ...sources.seams }
  const now = sources.now ?? Date.now
  const settings = sources.settings
  // Why lazy: taking the login-shell snapshot spawns the user's shell.
  const environment = onFirstUse(() =>
    seams.createEnvironmentResolvers({
      resolveShellEnvironmentPolicy: () => nativeChatShellEnvironmentPolicy(settings()),
      resolveLaunchEnvOverlay: () => resolveTuiAgentLaunchEnv('codex', settings().agentDefaultEnv)
    })
  )
  const claudeProbe = onFirstUse(() =>
    seams.createClaudeProbe({
      resolveInheritedEnv: () => environment().resolveClaudeInheritedEnv(),
      resolveAuthPolicy: () => claudeStructuredAuthPolicy(),
      resolveEnv: () => resolveTuiAgentLaunchEnv('claude', settings().agentDefaultEnv)
    })
  )
  const codexProbe = onFirstUse(() =>
    seams.createCodexProbe({ resolveEnvironment: () => environment().resolveCodexEnvironment() })
  )
  const homeOf = async (agent: 'claude' | 'codex'): Promise<string> =>
    (await sources.runtime.resolveStructuredAgentAccountHome(agent)).path
  return {
    agents: {
      detectInstalled: () => seams.detectInstalled(),
      disabled: () => settings().disabledTuiAgents
    },
    models: {
      claude: modelListingPortFromProbe({
        probe: (home) => claudeProbe()(home),
        resolveAccountHome: () => homeOf('claude'),
        now
      }),
      codex: modelListingPortFromProbe({
        probe: (home) => codexProbe()(home),
        resolveAccountHome: () => homeOf('codex'),
        now
      }),
      agy: modelListingPortFromDiscovery({
        discover: async () => seams.discoverModels(await environment().resolveClaudeInheritedEnv()),
        now
      })
    },
    rateLimits: {
      read: () => sources.rateLimits()?.getState() ?? null,
      refresh: async () => (await sources.rateLimits()?.refresh()) ?? null,
      // Why: NASH reads usage only through the CLIs; latches still block.
      usageSource: USAGE_METER_SOURCE
    },
    codex: { resolveExecutable: () => seams.resolveCodexExecutable() },
    agy: { resolveExecutable: () => seams.resolveAgyExecutable() },
    claude: { resolveExecutable: () => seams.resolveClaudeLaunchTarget() }
  }
}
