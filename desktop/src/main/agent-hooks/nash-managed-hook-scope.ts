import type { AgentHookTarget } from '../../shared/agent-hook-types'

/**
 * The CLIs NASH installs its managed status hooks into. User decision of 2026-10-06, asked "Which
 * CLIs may NASH install its status hooks into (written to each CLI's global config at startup)?",
 * answered "Claude Code only": NASH needs Claude's hooks to know when Claude is busy, idle or
 * waiting on a permission prompt; Codex, agy, Gemini, Cursor and the rest get no hooks, on this
 * machine, SSH hosts and WSL distros alike. Not a user setting. Removal stays available for every
 * agent, so a config an earlier build wrote can still be cleaned.
 */
export const NASH_MANAGED_HOOK_AGENTS: readonly AgentHookTarget[] = ['claude']

export const NASH_MANAGED_HOOK_SCOPE_DETAIL =
  'NASH installs managed status hooks only for Claude Code.'

export function isNashManagedHookAgent(agent: string): boolean {
  return NASH_MANAGED_HOOK_AGENTS.some((allowed) => allowed === agent)
}
