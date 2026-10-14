/** CLIs with a native model launch adapter; route IDs retain the existing AGY spelling. */
export const ROUTING_AGENTS = [
  'claude',
  'codex',
  'antigravity',
  'gemini',
  'cursor',
  'codebuddy',
  'grok',
  'muse',
  'omp',
  'opencode'
] as const
export type RoutingAgent = (typeof ROUTING_AGENTS)[number]

export const ROUTING_CLI_TARGETS = [
  'claude_cli',
  'codex_cli',
  'agy_cli',
  'gemini_cli',
  'cursor_cli',
  'codebuddy_cli',
  'grok_cli',
  'muse_cli',
  'omp_cli',
  'opencode_cli'
] as const
export type RoutingCliTarget = (typeof ROUTING_CLI_TARGETS)[number]

type RoutingTarget =
  | RoutingCliTarget
  | 'claude_primary'
  | 'claude_subagent'
  | 'claude_workflow'
  | 'claude_headless'
const TARGET_AGENTS: Record<RoutingTarget, RoutingAgent> = {
  claude_primary: 'claude',
  claude_subagent: 'claude',
  claude_workflow: 'claude',
  claude_headless: 'claude',
  claude_cli: 'claude',
  codex_cli: 'codex',
  agy_cli: 'antigravity',
  gemini_cli: 'gemini',
  cursor_cli: 'cursor',
  codebuddy_cli: 'codebuddy',
  grok_cli: 'grok',
  muse_cli: 'muse',
  omp_cli: 'omp',
  opencode_cli: 'opencode'
}

export function isRoutingAgent(value: unknown): value is RoutingAgent {
  return ROUTING_AGENTS.some((agent) => agent === value)
}

export function isRoutingCliTarget(value: unknown): value is RoutingCliTarget {
  return ROUTING_CLI_TARGETS.some((target) => target === value)
}

export function routingAgentForTarget(target: RoutingTarget): RoutingAgent {
  return TARGET_AGENTS[target]
}
