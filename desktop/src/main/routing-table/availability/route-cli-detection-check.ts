import { isTuiAgent } from '../../../shared/tui-agent-config'
import { filterEnabledTuiAgents } from '../../../shared/tui-agent-selection'
import type { CheckOutcome, RouteProvider } from './route-availability-types'

/** Orca's agent ids for the three CLIs; agy is detected as `antigravity` (detectCmd `agy`). */
const PROVIDER_AGENT_IDS: Readonly<Record<RouteProvider, string>> = {
  claude: 'claude',
  codex: 'codex',
  agy: 'antigravity'
}

export type AgentDetectionReading =
  | {
      readonly ok: true
      readonly installed: ReadonlySet<string>
      /** Installed and not turned off by the user. */
      readonly enabled: ReadonlySet<string>
    }
  | { readonly ok: false }

export type AgentDetectionSources = {
  /** Orca's agent detection (detectInstalledAgentsWithShellPathHydration). */
  detectInstalled(): Promise<readonly string[]>
  /** The user's disabled agents setting; throws when it cannot be read. */
  disabled(): Iterable<unknown> | null | undefined
}

/**
 * Detection plus the disabled-agents setting. Either failing makes the reading unobserved, because an
 * unreadable setting must not offer an agent the user may have turned off (the old eligibility rule).
 */
export async function readAgentDetection(
  sources: AgentDetectionSources
): Promise<AgentDetectionReading> {
  let disabled: Iterable<unknown> | null | undefined
  try {
    disabled = sources.disabled()
  } catch {
    return { ok: false }
  }
  try {
    const installed = (await sources.detectInstalled()).filter(isTuiAgent)
    return {
      ok: true,
      installed: new Set(installed),
      enabled: new Set(filterEnabledTuiAgents(installed, disabled))
    }
  } catch {
    return { ok: false }
  }
}

export function cliCheckOf(reading: AgentDetectionReading, provider: RouteProvider): CheckOutcome {
  if (!reading.ok) {
    return { check: 'cli', result: 'unobserved', reason: 'cli_unobserved' }
  }
  const agent = PROVIDER_AGENT_IDS[provider]
  const evidence = { agent }
  if (!reading.installed.has(agent)) {
    return { check: 'cli', result: 'fail', reason: 'cli_missing', evidence }
  }
  return reading.enabled.has(agent)
    ? { check: 'cli', result: 'pass', evidence }
    : { check: 'cli', result: 'fail', reason: 'cli_disabled', evidence }
}
