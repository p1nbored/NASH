/**
 * Where usage readings come from (D-023 correction; user instruction 2026-10-06: "Use the `/status`
 * command to retrieve quota information, including Claude, Codex, and agy, so that usage
 * information can be obtained."). Deliberately not a user setting.
 *
 * 'cli-native' (NASH): each routed CLI reports its own usage; NASH reads no CLI credential and calls
 * no vendor usage endpoint.
 * - Claude: the `rate_limits` Claude Code passes to the status line of a session NASH launched,
 *   relayed to the local hook server; passive, nothing starts to read it. The hidden `/usage` PTY
 *   stays off: it starts an interactive `claude` that runs the user's SessionStart hooks, plugins
 *   and MCP servers, answers the folder-trust prompt itself, and on Windows goes through cmd.exe.
 * - Codex: `codex app-server` answering `account/rateLimits/read` (or an `account/rateLimits/updated`
 *   it pushes meanwhile), in the Codex home NASH launches Codex with.
 * - agy: `agy -p /usage --output-format json`, behind Orca's version gate.
 * Codex and agy run on Orca's triggers: the deferred start, window focus (5-minute debounce), the
 * 15-minute focused poll, a manual refresh and a Codex account switch. Every other provider is off.
 *
 * 'orca-inherited' is Orca's own meter code (stored credentials, vendor usage endpoints, every
 * provider); it stays in the tree only so its tests keep running.
 */
export type UsageMeterSource = 'cli-native' | 'orca-inherited'

export const USAGE_METER_SOURCE: UsageMeterSource = 'cli-native'
